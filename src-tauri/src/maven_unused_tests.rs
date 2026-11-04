use super::*;
use std::io::Write;
use tempfile::TempDir;

fn pom(artifact: &str, content: &str) -> String {
    format!("<project><groupId>org.example</groupId><artifactId>{artifact}</artifactId><version>1</version>{content}</project>")
}

fn write(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

fn artifact(repository: &Path, name: &str, version: &str, content: &str, remote: bool) -> PathBuf {
    let path = repository.join(format!("org/example/{name}/{version}"));
    let file = format!("{name}-{version}.pom");
    write(&path.join(&file), &pom(name, content));
    write(
        &path.join("_remote.repositories"),
        &format!("{file}>{}=\n", if remote { "central" } else { "" }),
    );
    path
}

fn fixture() -> (TempDir, PathBuf, PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let repository = temp.path().join("repository");
    let project = temp.path().join("project");
    fs::create_dir_all(&repository).unwrap();
    write(&project.join("pom.xml"), &pom("app", ""));
    (temp, repository, project)
}

#[test]
fn repository_metadata_does_not_consume_the_pom_model_budget() {
    let (_temp, repository, project) = fixture();
    // This is below the 10,000-POM budget, but observations include a POM and
    // origin record for every version. Counting both rejected normal repos.
    for number in 0..5_001 {
        artifact(&repository, &format!("local-{number}"), "1", "", false);
    }
    let analysis = analyze(&repository, &[project]).expect("metadata is not another POM model");
    assert!(analysis.blockers.is_empty(), "{:?}", analysis.blockers);
    assert_eq!(analysis.versions, 5_001);
    assert_eq!(analysis.excluded_versions, 5_001);
    assert!(analysis.candidates.is_empty());
}

#[test]
fn model_budget_reports_count_and_time_limits_separately() {
    let mut budget = ModelBudget {
        started: Instant::now(),
        models: 0,
        max_models: 2,
    };
    budget.before_read("模型分析").unwrap();
    budget.before_read("模型分析").unwrap();
    let error = budget.before_read("模型分析").unwrap_err();
    assert!(error.contains("已读取 2 个 POM") && error.contains("达到 2 个上限"));
    assert!(!error.contains("耗时"));
    budget.started = Instant::now() - MAX_SCAN_TIME - Duration::from_secs(1);
    let error = budget.before_read("模型分析").unwrap_err();
    assert!(error.contains("超过 30 秒上限") && error.contains("已读取 2 个 POM"));
}

#[test]
fn profile_coordinate_alternatives_protect_every_declared_artifact() {
    let (_temp, repository, project) = fixture();
    write(&project.join("pom.xml"), &pom("app", "<profiles><profile><properties><library.artifact>one</library.artifact></properties></profile><profile><properties><library.artifact>two</library.artifact></properties></profile></profiles><dependencies><dependency><groupId>org.example</groupId><artifactId>${library.artifact}</artifactId></dependency></dependencies>"));
    for name in ["one", "two", "unused"] {
        artifact(&repository, name, "1", "", true);
    }
    let analysis = analyze(&repository, &[project]).unwrap();
    assert!(analysis.blockers.is_empty(), "{:?}", analysis.blockers);
    assert_eq!(analysis.protected_versions, 2);
    assert_eq!(analysis.candidates.len(), 1);
    assert_eq!(analysis.candidates[0].coordinate, "org.example:unused");
}

#[test]
fn parent_directory_paths_and_parent_coordinate_aliases_are_read() {
    let (temp, repository, project) = fixture();
    write(&temp.path().join("parent/pom.xml"), &pom("parent", ""));
    write(&project.join("pom.xml"), &pom("app", "<parent><groupId>org.example</groupId><artifactId>parent</artifactId><version>1</version><relativePath>../parent</relativePath></parent><dependencies><dependency><groupId>${project.parent.groupId}</groupId><artifactId>used</artifactId></dependency></dependencies>"));
    artifact(&repository, "used", "1", "", true);
    artifact(&repository, "unused", "1", "", true);
    let analysis = analyze(&repository, &[project]).unwrap();
    assert!(analysis.blockers.is_empty(), "{:?}", analysis.blockers);
    assert_eq!(analysis.candidates.len(), 1);
    assert_eq!(analysis.candidates[0].coordinate, "org.example:unused");
}

#[test]
fn relative_parent_resolves_ci_revision_before_parent_version_matching() {
    let (temp, repository, project) = fixture();
    write(
        &temp.path().join("parent/pom.xml"),
        &pom(
            "parent",
            "<properties><revision>1</revision><library>used</library></properties>",
        ),
    );
    write(&project.join("pom.xml"), &pom("app", "<parent><groupId>org.example</groupId><artifactId>parent</artifactId><version>${revision}</version><relativePath>../parent</relativePath></parent><dependencies><dependency><groupId>org.example</groupId><artifactId>${library}</artifactId></dependency></dependencies>"));
    for name in ["used", "unused"] {
        artifact(&repository, name, "1", "", true);
    }
    let analysis = analyze(&repository, &[project]).unwrap();
    assert!(analysis.blockers.is_empty(), "{:?}", analysis.blockers);
    assert_eq!(analysis.candidates.len(), 1);
    assert_eq!(analysis.candidates[0].coordinate, "org.example:unused");
}

#[test]
fn inherited_properties_and_child_overrides_protect_the_full_declared_closure() {
    let (_temp, repository, project) = fixture();
    artifact(&repository, "parent", "1", "<packaging>pom</packaging><properties><library>one</library></properties><dependencies><dependency><groupId>org.example</groupId><artifactId>${library}</artifactId></dependency></dependencies>", true);
    write(&project.join("pom.xml"), &pom("app", "<parent><groupId>org.example</groupId><artifactId>parent</artifactId><version>1</version><relativePath/></parent><properties><library>two</library></properties>"));
    for name in ["one", "two", "unused"] {
        artifact(&repository, name, "1", "", true);
    }
    let analysis = analyze(&repository, &[project]).unwrap();
    assert!(analysis.blockers.is_empty(), "{:?}", analysis.blockers);
    assert_eq!(analysis.candidates.len(), 1);
    assert_eq!(analysis.candidates[0].coordinate, "org.example:unused");
}

#[test]
fn plugin_configuration_node_names_are_not_maven_model_references() {
    let (_temp, repository, project) = fixture();
    write(&project.join("pom.xml"), &pom("app", "<build><plugins><plugin><artifactId>maven-test-plugin</artifactId><configuration><parent>expand</parent><compilerPlugins><plugin>spring</plugin></compilerPlugins><dependenciesToScan><dependency>org.example:dynamic</dependency></dependenciesToScan></configuration><dependencies><dependency><groupId>org.example</groupId><artifactId>used</artifactId></dependency></dependencies></plugin></plugins></build>"));
    let plugin = repository.join("org/apache/maven/plugins/maven-test-plugin/1");
    write(&plugin.join("maven-test-plugin-1.pom"), "<project><groupId>org.apache.maven.plugins</groupId><artifactId>maven-test-plugin</artifactId><version>1</version><packaging>maven-plugin</packaging></project>");
    for name in ["used", "unused"] {
        artifact(&repository, name, "1", "", true);
    }
    let analysis = analyze(&repository, &[project]).unwrap();
    assert!(analysis.blockers.is_empty(), "{:?}", analysis.blockers);
    assert_eq!(analysis.candidates.len(), 1);
    assert_eq!(analysis.candidates[0].coordinate, "org.example:unused");
}

#[test]
fn available_mode_is_frozen_for_execution_and_missing_scope_changes_require_rescan() {
    for change_scope in [false, true] {
        let (_temp, repository, project) = fixture();
        let content = "<dependencies><dependency><groupId>org.example</groupId><artifactId>not-downloaded</artifactId></dependency></dependencies>";
        write(&project.join("pom.xml"), &pom("app", content));
        artifact(&repository, "unused", "1", "", true);
        let analysis = analyze_with_mode(
            &repository,
            std::slice::from_ref(&project),
            ReferenceMode::Available,
        )
        .unwrap();
        assert!(analysis.blockers.is_empty());
        let id = analysis.candidates[0].id.clone();
        let state = MavenUnusedState(Arc::new(Mutex::new(Some(Session {
            id: "available".into(),
            analysis,
        }))));
        if change_scope {
            write(
                &project.join("pom.xml"),
                &pom(
                    "app",
                    &content.replace("not-downloaded", "different-missing"),
                ),
            );
        }
        let mut moves = 0;
        let outcome = state.remove_with(
            "available",
            &[id],
            &repository,
            &mut |path| {
                moves += 1;
                fs::remove_dir_all(path).unwrap();
                Ok(())
            },
            &|_| Ok(false),
        );
        if change_scope {
            assert!(outcome.err().unwrap().contains("缺失模型范围已变化"));
            assert_eq!(moves, 0);
        } else {
            assert_eq!(outcome.unwrap().moved, 1);
            assert_eq!(moves, 1);
        }
    }
}

#[test]
fn missing_remote_models_require_an_explicit_available_mode() {
    let (_temp, repository, project) = fixture();
    write(&project.join("pom.xml"), &pom("app", "<dependencies><dependency><groupId>org.example</groupId><artifactId>not-downloaded</artifactId></dependency></dependencies>"));
    artifact(&repository, "unused", "1", "", true);
    let strict = analyze(&repository, std::slice::from_ref(&project)).unwrap();
    assert!(!strict.blockers.is_empty() && strict.candidates.is_empty());
    let available = analyze_with_mode(
        &repository,
        std::slice::from_ref(&project),
        ReferenceMode::Available,
    )
    .unwrap();
    assert!(available.blockers.is_empty(), "{:?}", available.blockers);
    assert_eq!(available.missing_models, ["org.example:not-downloaded"]);
    assert_eq!(available.candidates.len(), 1);
    write(&project.join("pom.xml"), &pom("app", "<dependencies><dependency><groupId>${unknown}</groupId><artifactId>library</artifactId></dependency></dependencies>"));
    let unresolved = analyze_with_mode(&repository, &[project], ReferenceMode::Available).unwrap();
    assert!(!unresolved.blockers.is_empty() && unresolved.candidates.is_empty());
}

fn embedded_artifact(repository: &Path, content: &str) -> PathBuf {
    let path = repository.join("org/apache/maven/plugins/maven-test-plugin/1");
    fs::create_dir_all(&path).unwrap();
    let file = fs::File::create(path.join("maven-test-plugin-1.jar")).unwrap();
    let mut archive = zip::ZipWriter::new(file);
    archive
        .start_file(
            "META-INF/maven/org.apache.maven.plugins/maven-test-plugin/pom.xml",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
    archive.write_all(content.as_bytes()).unwrap();
    archive.finish().unwrap();
    write(
        &path.join("_remote.repositories"),
        "maven-test-plugin-1.jar>central=\n",
    );
    path
}

#[test]
fn embedded_plugin_models_protect_dependencies_and_are_revalidated_during_cleanup() {
    let (_temp, repository, project) = fixture();
    let content = "<project><groupId>org.apache.maven.plugins</groupId><artifactId>maven-test-plugin</artifactId><version>1</version><packaging>maven-plugin</packaging><dependencies><dependency><groupId>org.example</groupId><artifactId>used</artifactId></dependency></dependencies></project>";
    let plugin = embedded_artifact(&repository, content);
    for name in ["used", "a", "b"] {
        artifact(&repository, name, "1", "", true);
    }
    let analysis = analyze(&repository, std::slice::from_ref(&project)).unwrap();
    assert!(analysis.blockers.is_empty(), "{:?}", analysis.blockers);
    assert_eq!(analysis.candidates.len(), 2);
    assert!(analysis
        .candidates
        .iter()
        .all(|candidate| candidate.coordinate != "org.example:used"));
    let ids: Vec<_> = analysis
        .candidates
        .iter()
        .map(|candidate| candidate.id.clone())
        .collect();
    let state = MavenUnusedState(Arc::new(Mutex::new(Some(Session {
        id: "embedded".into(),
        analysis,
    }))));
    let mut moved = 0;
    let outcome = state
        .remove_with(
            "embedded",
            &ids,
            &repository,
            &mut |path| {
                fs::remove_dir_all(path).unwrap();
                moved += 1;
                // A retained plugin model changes after the first move.
                write(&plugin.join("maven-test-plugin-1.jar"), "changed archive");
                Ok(())
            },
            &|_| Ok(false),
        )
        .unwrap();
    assert_eq!(moved, 1);
    assert_eq!((outcome.moved, outcome.skipped), (1, 1));
}

#[test]
fn maven_latin1_metadata_entities_are_read_without_external_dtds() {
    let (_temp, repository, project) = fixture();
    write(
        &project.join("pom.xml"),
        &pom(
            "app",
            "<developers><developer><name>Laugst&oslash;l</name></developer></developers>",
        ),
    );
    artifact(&repository, "unused", "1", "", true);
    let analysis = analyze(&repository, std::slice::from_ref(&project)).unwrap();
    assert!(analysis.blockers.is_empty(), "{:?}", analysis.blockers);
    assert_eq!(analysis.candidates.len(), 1);
    write(&project.join("pom.xml"), "<!DOCTYPE project SYSTEM 'file:///not-read'><project><groupId>org.example</groupId><artifactId>app</artifactId><version>1</version></project>");
    let analysis = analyze(&repository, &[project]).unwrap();
    assert!(!analysis.blockers.is_empty() && analysis.candidates.is_empty());
}

#[cfg(unix)]
#[test]
fn agent_skill_links_do_not_block_maven_project_reference_discovery() {
    let (_temp, repository, project) = fixture();
    let skill = project.join(".agents/skills/bmad-tea-test-design");
    write(
        &skill.join("pom.xml"),
        "agent skill example, not a Maven project",
    );
    let skills = project.join(".claude/skills");
    fs::create_dir_all(&skills).unwrap();
    std::os::unix::fs::symlink(
        "../../.agents/skills/bmad-tea-test-design",
        skills.join("bmad-tea-test-design"),
    )
    .unwrap();
    for name in [".codex", ".grok", ".opencode", ".workbuddy", ".superpowers"] {
        let tools = project.join(name);
        fs::create_dir_all(&tools).unwrap();
        std::os::unix::fs::symlink("../missing-skill", tools.join("linked-skill")).unwrap();
    }
    write(&project.join("backend/pom.xml"), &pom("backend", "<dependencies><dependency><groupId>org.example</groupId><artifactId>used</artifactId></dependency></dependencies>"));
    artifact(&repository, "used", "1", "", true);
    artifact(&repository, "unused", "1", "", true);

    let analysis = analyze(&repository, &[project])
        .expect("agent skill symlinks must not make project discovery incomplete");
    assert!(analysis.blockers.is_empty(), "{:?}", analysis.blockers);
    assert_eq!(analysis.projects, 2);
    assert_eq!(analysis.protected_versions, 1);
    assert_eq!(analysis.candidates.len(), 1);
    assert_eq!(analysis.candidates[0].coordinate, "org.example:unused");
}

#[test]
fn explicitly_declared_modules_inside_agent_directories_are_still_checked() {
    let (_temp, repository, project) = fixture();
    write(
        &project.join("pom.xml"),
        &pom(
            "app",
            "<modules><module>.agents/real-module</module></modules>",
        ),
    );
    let module = project.join(".agents/real-module/pom.xml");
    write(&module, &pom("real-module", "<dependencies><dependency><groupId>org.example</groupId><artifactId>used</artifactId></dependency></dependencies>"));
    artifact(&repository, "used", "1", "", true);
    artifact(&repository, "unused", "1", "", true);
    let analysis = analyze(&repository, std::slice::from_ref(&project)).unwrap();
    assert!(analysis.blockers.is_empty(), "{:?}", analysis.blockers);
    assert_eq!(analysis.protected_versions, 1);
    assert_eq!(analysis.candidates.len(), 1);
    assert_eq!(analysis.candidates[0].coordinate, "org.example:unused");

    fs::remove_file(&module).unwrap();
    let analysis = analyze(&repository, &[project]).unwrap();
    assert!(!analysis.blockers.is_empty());
    assert!(analysis.candidates.is_empty());
}

#[cfg(unix)]
#[test]
fn flutter_sdk_and_generated_plugin_links_are_outside_maven_discovery() {
    let (_temp, repository, project) = fixture();
    artifact(&repository, "unused", "1", "", true);
    for relative in [
        "app/.fvm/flutter_sdk",
        "app/.dart_tool/linked-package",
        "app/ios/.symlinks/plugins/mobile_scanner",
    ] {
        let link = project.join(relative);
        fs::create_dir_all(link.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink("/missing-flutter-dependency", link).unwrap();
    }
    let analysis = analyze(&repository, &[project]).unwrap();
    assert!(analysis.blockers.is_empty(), "{:?}", analysis.blockers);
    assert_eq!(analysis.candidates.len(), 1);
}

#[cfg(unix)]
#[test]
fn project_and_pom_symlinks_outside_agent_directories_still_block_cleanup() {
    let (temp, repository, project) = fixture();
    artifact(&repository, "unused", "1", "", true);
    let linked_project = project.join("linked-project");
    std::os::unix::fs::symlink(temp.path().join("outside"), &linked_project).unwrap();
    let error = match analyze(&repository, std::slice::from_ref(&project)) {
        Ok(_) => panic!("a potential linked project must block discovery"),
        Err(error) => error,
    };
    assert!(error.contains("linked-project") && error.contains("符号链接"));
    fs::remove_file(&linked_project).unwrap();

    let outside_pom = temp.path().join("outside-pom.xml");
    write(&outside_pom, &pom("app", ""));
    fs::remove_file(project.join("pom.xml")).unwrap();
    std::os::unix::fs::symlink(&outside_pom, project.join("pom.xml")).unwrap();
    assert!(analyze(&repository, &[project]).is_err());
}

#[test]
fn retains_direct_transitive_and_all_versions_but_finds_unreferenced_artifacts() {
    let (_temp, repository, project) = fixture();
    write(&project.join("pom.xml"), &pom("app", "<dependencies><dependency><groupId>org.example</groupId><artifactId>direct</artifactId><version>1</version></dependency></dependencies>"));
    artifact(&repository, "direct", "1", "<dependencies><dependency><groupId>org.example</groupId><artifactId>transitive</artifactId></dependency></dependencies>", true);
    artifact(&repository, "direct", "2", "", true);
    artifact(&repository, "transitive", "1", "", true);
    artifact(&repository, "unused", "1", "", true);
    let analysis = analyze(&repository, &[project]).unwrap();
    assert!(analysis.blockers.is_empty(), "{:?}", analysis.blockers);
    assert_eq!(analysis.protected_versions, 3);
    assert_eq!(analysis.candidates.len(), 1);
    assert_eq!(analysis.candidates[0].coordinate, "org.example:unused");
}

#[test]
fn protects_inactive_profiles_local_installations_and_implicit_plugin_dependencies() {
    let (_temp, repository, project) = fixture();
    write(&project.join("pom.xml"), &pom("app", "<profiles><profile><id>optional</id><dependencies><dependency><groupId>org.example</groupId><artifactId>profile</artifactId></dependency></dependencies></profile></profiles>"));
    artifact(&repository, "profile", "1", "", true);
    artifact(&repository, "local", "1", "<dependencies><dependency><groupId>org.example</groupId><artifactId>local-dependency</artifactId></dependency></dependencies>", false);
    artifact(&repository, "local-dependency", "1", "", true);
    artifact(&repository, "plugin", "1", "<packaging>maven-plugin</packaging><dependencies><dependency><groupId>org.example</groupId><artifactId>plugin-dependency</artifactId></dependency></dependencies>", true);
    artifact(&repository, "plugin-dependency", "1", "", true);
    artifact(&repository, "unused", "1", "", true);
    let analysis = analyze(&repository, &[project]).unwrap();
    assert!(analysis.blockers.is_empty(), "{:?}", analysis.blockers);
    assert_eq!(analysis.candidates.len(), 1);
    assert_eq!(analysis.excluded_versions, 1);
}

#[test]
fn missing_or_ambiguous_models_never_authorize_cleanup() {
    let (_temp, repository, project) = fixture();
    artifact(&repository, "unused", "1", "", true);
    write(&project.join("pom.xml"), &pom("app", "<dependencies><dependency><groupId>${unknown}</groupId><artifactId>library</artifactId></dependency></dependencies>"));
    let analysis = analyze(&repository, std::slice::from_ref(&project)).unwrap();
    assert!(!analysis.blockers.is_empty());
    assert!(analysis.candidates.is_empty());
    write(&project.join("pom.xml"), &pom("app", "<dependencies><dependency><groupId>org.example</groupId><artifactId>missing</artifactId></dependency></dependencies>"));
    let analysis = analyze(&repository, &[project]).unwrap();
    assert!(!analysis.blockers.is_empty());
    assert!(analysis.candidates.is_empty());
}

#[test]
fn local_and_incomplete_origin_records_are_never_download_proof() {
    let (_temp, repository, _project) = fixture();
    let path = artifact(&repository, "library", "1", "", true);
    assert!(remote_only(&path).unwrap());
    write(&path.join("library-1.jar"), "binary");
    assert!(!remote_only(&path).unwrap());
    write(
        &path.join("_remote.repositories"),
        "library-1.pom>central=\nlibrary-1.jar>central=\nlibrary-1.jar>=\n",
    );
    assert!(!remote_only(&path).unwrap());
    fs::remove_file(path.join("_remote.repositories")).unwrap();
    assert!(!remote_only(&path).unwrap());
}

#[test]
fn reanalysis_skips_a_candidate_that_became_referenced() {
    let (_temp, repository, project) = fixture();
    artifact(&repository, "unused", "1", "", true);
    let state = MavenUnusedState::default();
    let analysis = analyze(&repository, std::slice::from_ref(&project)).unwrap();
    let ids = vec![analysis.candidates[0].id.clone()];
    *state.0.lock().unwrap() = Some(Session {
        id: "scan".into(),
        analysis,
    });
    write(&project.join("pom.xml"), &pom("app", "<dependencies><dependency><groupId>org.example</groupId><artifactId>unused</artifactId></dependency></dependencies>"));
    let outcome = state
        .remove_with(
            "scan",
            &ids,
            &repository,
            &mut |_| panic!("referenced artifact must not move"),
            &|_| Ok(false),
        )
        .unwrap();
    assert_eq!(outcome.skipped, 1);
    assert!(state.0.lock().unwrap().is_none());
}

#[test]
fn batch_moves_only_selected_versions_and_keeps_authorization_single_use() {
    let (temp, repository, project) = fixture();
    let a = artifact(&repository, "a", "1", "", true);
    let b = artifact(&repository, "b", "1", "", true);
    let unselected = artifact(&repository, "c", "1", "", true);
    let state = MavenUnusedState::default();
    let analysis = analyze(&repository, &[project]).unwrap();
    let ids = analysis
        .candidates
        .iter()
        .filter(|candidate| candidate.coordinate != "org.example:c")
        .map(|candidate| candidate.id.clone())
        .collect::<Vec<_>>();
    *state.0.lock().unwrap() = Some(Session {
        id: "scan".into(),
        analysis,
    });
    let mut count = 0;
    let outcome = state
        .remove_with(
            "scan",
            &ids,
            &repository,
            &mut |path| {
                count += 1;
                fs::rename(path, temp.path().join(format!("trash-{count}")))
                    .map_err(|error| error.to_string())
            },
            &|_| Ok(false),
        )
        .unwrap();
    assert_eq!(outcome.moved, 2);
    assert_eq!(outcome.skipped, 0);
    assert!(!a.exists() && !b.exists() && unselected.exists());
    assert!(state
        .remove_with("scan", &ids, &repository, &mut |_| Ok(()), &|_| Ok(false))
        .is_err());
}

#[test]
fn directory_and_origin_changes_during_a_batch_skip_later_items() {
    for change in ["project", "repository", "origin", "recreated", "parent"] {
        let (temp, repository, project) = fixture();
        let a = artifact(&repository, "a", "1", "", true);
        let b = artifact(&repository, "b", "1", "", true);
        let c = artifact(&repository, "c", "1", "<dependencies><dependency><groupId>org.example</groupId><artifactId>b</artifactId></dependency></dependencies>", true);
        if change == "parent" {
            write(&project.join("pom.xml"), &pom("app", "<parent><groupId>org.example</groupId><artifactId>parent</artifactId><version>1</version><relativePath>../new-parent.xml</relativePath></parent>"));
            artifact(&repository, "parent", "1", "", true);
        }
        let analysis = analyze(&repository, std::slice::from_ref(&project)).unwrap();
        assert!(analysis.blockers.is_empty());
        let ids = ["org.example:a", "org.example:b"].map(|ga| {
            analysis
                .candidates
                .iter()
                .find(|candidate| candidate.coordinate == ga)
                .unwrap()
                .id
                .clone()
        });
        let state = MavenUnusedState::default();
        *state.0.lock().unwrap() = Some(Session {
            id: "scan".into(),
            analysis,
        });
        let outcome = state.remove_with("scan", &ids, &repository, &mut |path| {
            fs::rename(path, temp.path().join("trash")).unwrap();
            match change {
                "project" => write(&project.join("new-module/pom.xml"), &pom("new-module", "<dependencies><dependency><groupId>org.example</groupId><artifactId>b</artifactId></dependency></dependencies>")),
                "repository" => { artifact(&repository, "new-local", "1", "<dependencies><dependency><groupId>org.example</groupId><artifactId>b</artifactId></dependency></dependencies>", false); },
                "origin" => write(&c.join("_remote.repositories"), "c-1.pom>=\n"),
                "recreated" => { artifact(&repository, "a", "1", "<dependencies><dependency><groupId>org.example</groupId><artifactId>b</artifactId></dependency></dependencies>", false); },
                "parent" => write(&temp.path().join("new-parent.xml"), &pom("parent", "<dependencies><dependency><groupId>org.example</groupId><artifactId>b</artifactId></dependency></dependencies>")),
                _ => unreachable!(),
            }
            Ok(())
        }, &|_| Ok(false)).unwrap();
        // Recreated source is an uncertain move, so it fails verification.
        assert_eq!(outcome.moved + outcome.failed, 1, "{change}");
        assert_eq!(outcome.skipped, 1, "{change}");
        assert!(b.exists(), "{change}");
        assert_eq!(a.exists(), change == "recreated");
    }
}

#[test]
fn moving_two_versions_under_the_same_artifact_keeps_remaining_checks_valid() {
    let (temp, repository, project) = fixture();
    artifact(&repository, "unused", "1", "", true);
    artifact(&repository, "unused", "2", "", true);
    let analysis = analyze(&repository, &[project]).unwrap();
    let ids = analysis
        .candidates
        .iter()
        .map(|candidate| candidate.id.clone())
        .collect::<Vec<_>>();
    let state = MavenUnusedState::default();
    *state.0.lock().unwrap() = Some(Session {
        id: "scan".into(),
        analysis,
    });
    let outcome = state
        .remove_with(
            "scan",
            &ids,
            &repository,
            &mut |path| {
                fs::rename(path, temp.path().join(path.file_name().unwrap()))
                    .map_err(|error| error.to_string())
            },
            &|_| Ok(false),
        )
        .unwrap();
    assert_eq!(outcome.moved, 2);
    assert_eq!(outcome.skipped, 0);
}

#[test]
fn source_changes_forged_ids_and_in_use_files_cannot_move() {
    let (_temp, repository, project) = fixture();
    artifact(&repository, "unused", "1", "", true);
    let state = MavenUnusedState::default();
    let analysis = analyze(&repository, &[project]).unwrap();
    let id = analysis.candidates[0].id.clone();
    *state.0.lock().unwrap() = Some(Session {
        id: "scan".into(),
        analysis,
    });
    let refuse = &mut |_: &Path| panic!("must not move");
    assert!(state
        .remove_with(
            "scan",
            &["../../other".into()],
            &repository,
            refuse,
            &|_| Ok(false)
        )
        .is_err());
    assert!(state
        .remove_with(
            "scan",
            &[id.clone()],
            &repository.join("other"),
            refuse,
            &|_| Ok(false)
        )
        .is_err());
    let outcome = state
        .remove_with("scan", &[id], &repository, refuse, &|_| Ok(true))
        .unwrap();
    assert_eq!(outcome.skipped, 1);
}

#[test]
fn open_file_probe_requires_a_clean_no_match_result() {
    let mut run = crate::types::CommandRun {
        envelope: crate::command::envelope("lsof", &["-Fn"], 5000),
        stdout: String::new(),
        stderr: String::new(),
        exit_code: Some(1),
        duration_ms: 1,
    };
    assert!(!open_file_probe_result(&run).unwrap());
    run.stderr = "lsof: cannot stat directory".into();
    assert!(open_file_probe_result(&run).is_err());
    run.stderr.clear();
    run.exit_code = Some(0);
    run.stdout = "p123\nn/repository/a/1/a-1.jar\n".into();
    assert!(open_file_probe_result(&run).unwrap());
    run.exit_code = Some(2);
    assert!(open_file_probe_result(&run).is_err());
}

#[cfg(unix)]
#[test]
fn symlinked_versions_prevent_a_complete_analysis() {
    let (temp, repository, project) = fixture();
    let path = artifact(&repository, "unused", "1", "", true);
    std::os::unix::fs::symlink(temp.path(), path.join("linked")).unwrap();
    let analysis = analyze(&repository, &[project]).unwrap();
    assert!(!analysis.blockers.is_empty());
    assert!(analysis.candidates.is_empty());
}

#[test]
fn parent_bom_report_and_extension_references_are_retained() {
    let (_temp, repository, project) = fixture();
    write(&project.join("pom.xml"), &pom("app", "<parent><groupId>org.example</groupId><artifactId>parent</artifactId><version>1</version><relativePath/></parent><dependencyManagement><dependencies><dependency><groupId>org.example</groupId><artifactId>bom</artifactId><type>pom</type><scope>import</scope></dependency></dependencies></dependencyManagement><reporting><plugins><plugin><groupId>org.example</groupId><artifactId>report</artifactId></plugin></plugins></reporting>"));
    write(&project.join(".mvn/extensions.xml"), "<extensions><extension><groupId>org.example</groupId><artifactId>extension</artifactId><version>1</version></extension></extensions>");
    for name in ["parent", "bom", "report", "extension", "unused"] {
        artifact(&repository, name, "1", "", true);
    }
    let analysis = analyze(&repository, &[project]).unwrap();
    assert!(analysis.blockers.is_empty(), "{:?}", analysis.blockers);
    assert_eq!(analysis.candidates.len(), 1);
    assert_eq!(analysis.candidates[0].coordinate, "org.example:unused");
}

#[test]
fn missing_explicit_modules_and_mismatched_repository_layout_block_cleanup() {
    let (_temp, repository, project) = fixture();
    let path = artifact(&repository, "unused", "1", "", true);
    write(
        &project.join("pom.xml"),
        &pom("app", "<modules><module>missing</module></modules>"),
    );
    let analysis = analyze(&repository, std::slice::from_ref(&project)).unwrap();
    assert!(!analysis.blockers.is_empty() && analysis.candidates.is_empty());
    write(&project.join("pom.xml"), &pom("app", ""));
    write(&path.join("unused-1.pom"), &pom("different", ""));
    let analysis = analyze(&repository, &[project]).unwrap();
    assert!(!analysis.blockers.is_empty() && analysis.candidates.is_empty());
}

#[test]
fn maintenance_history_freezes_scope_and_streams_item_results() {
    use crate::maintenance_history::{
        MaintenanceDetail, MaintenanceHistoryState, MaintenanceOperation,
    };
    let (temp, repository, project) = fixture();
    artifact(&repository, "unused", "1", "", true);
    let analysis = analyze(&repository, &[project]).unwrap();
    let history = MaintenanceHistoryState::new(temp.path().join("history"));
    let id = analysis.candidates[0].id.clone();
    let receipt = crate::maintenance_adapters::remove_maven_artifacts(
        &history,
        "confirmed scope".into(),
        &analysis.candidates,
        |report| {
            let item = RemovalItem {
                id,
                status: "Skipped",
                message: Some("in use".into()),
            };
            report(&item);
            Ok(Outcome {
                moved: 0,
                skipped: 1,
                failed: 0,
                items: vec![item],
            })
        },
    )
    .unwrap();
    let record = history.get(receipt.history_id.as_deref().unwrap()).unwrap();
    assert_eq!(record.operation, MaintenanceOperation::CleanMavenArtifacts);
    let MaintenanceDetail::Manager(detail) = record.detail else {
        panic!("manager history required");
    };
    assert_eq!(detail.target.as_deref(), Some("confirmed scope"));
    let steps = detail.steps.unwrap();
    assert_eq!(steps.len(), 1);
    assert!(steps[0].label.contains("org.example:unused:1"));
    assert_eq!(steps[0].state, "skipped");
    assert_eq!(steps[0].failure_message.as_deref(), Some("in use"));
}
