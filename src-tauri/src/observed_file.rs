use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};

#[derive(Debug)]
pub(crate) enum ReadError {
    NotRegularFile,
    TooLarge,
    Metadata(io::Error),
    Utf8,
}

#[derive(Debug)]
pub(crate) enum WriteError {
    NoParent,
    Prepare(io::Error),
    Io(io::Error),
    Conflict,
    Persist(io::Error),
}

// A text file observation used to reject writes after content, identity, or permissions change.
#[derive(Clone)]
pub(crate) struct ObservedFile {
    pub path: PathBuf,
    pub text: Option<String>,
    permissions: Option<fs::Permissions>,
    identity: Option<(u64, u64)>,
}

impl ObservedFile {
    pub fn read(path: &Path) -> Result<Self, ReadError> {
        let metadata = match fs::symlink_metadata(path) {
            Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() => Some(meta),
            Ok(_) => return Err(ReadError::NotRegularFile),
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Err(error) => return Err(ReadError::Metadata(error)),
        };
        if metadata
            .as_ref()
            .is_some_and(|meta| meta.len() > 4 * 1024 * 1024)
        {
            return Err(ReadError::TooLarge);
        }
        let text = metadata
            .as_ref()
            .map(|_| fs::read_to_string(path).map_err(|_| ReadError::Utf8))
            .transpose()?;
        Ok(Self {
            path: path.into(),
            text,
            identity: metadata.as_ref().map(identity),
            permissions: metadata.map(|meta| meta.permissions()),
        })
    }

    pub fn unchanged(&self) -> bool {
        Self::read(&self.path).is_ok_and(|next| {
            next.text == self.text
                && next.identity == self.identity
                && next.permissions == self.permissions
        })
    }

    // The parent directory must exist. Success returns the observation for subsequent writes.
    pub fn write(&self, text: &str) -> Result<Self, WriteError> {
        let parent = self.path.parent().ok_or(WriteError::NoParent)?;
        let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(WriteError::Prepare)?;
        if let Some(permissions) = &self.permissions {
            temp.as_file()
                .set_permissions(permissions.clone())
                .map_err(WriteError::Io)?;
        }
        temp.write_all(text.as_bytes())
            .and_then(|_| temp.as_file().sync_all())
            .map_err(WriteError::Io)?;
        let metadata = temp.as_file().metadata().map_err(WriteError::Io)?;
        if !self.unchanged() {
            return Err(WriteError::Conflict);
        }
        if self.text.is_none() {
            temp.persist_noclobber(&self.path)
        } else {
            temp.persist(&self.path)
        }
        .map_err(|error| WriteError::Persist(error.error))?;
        // Construct the saved observation without a fallible reread after replacement.
        Ok(Self {
            path: self.path.clone(),
            text: Some(text.into()),
            permissions: Some(metadata.permissions()),
            identity: Some(identity(&metadata)),
        })
    }
}

fn identity(metadata: &fs::Metadata) -> (u64, u64) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        (metadata.dev(), metadata.ino())
    }
    #[cfg(not(unix))]
    {
        (metadata.len(), 0)
    }
}

#[cfg(test)]
mod tests {
    use super::{ObservedFile, ReadError, WriteError};
    use std::fs;

    #[test]
    fn saving_returns_the_observation_needed_for_the_next_write() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("hooks.json");
        let missing = ObservedFile::read(&path).unwrap();
        assert_eq!(missing.text, None);
        assert!(missing.unchanged());

        let first = missing.write("first definition").unwrap();
        assert_eq!(first.text.as_deref(), Some("first definition"));
        assert!(first.unchanged());
        assert!(!missing.unchanged());
        assert_eq!(
            ObservedFile::read(&path).unwrap().text.as_deref(),
            Some("first definition")
        );

        let second = first.write("updated definition").unwrap();
        assert_eq!(second.text.as_deref(), Some("updated definition"));
        assert!(second.unchanged());
        assert!(!first.unchanged());
        assert_eq!(
            ObservedFile::read(&path).unwrap().text.as_deref(),
            Some("updated definition")
        );
    }

    #[cfg(unix)]
    #[test]
    fn saving_preserves_existing_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("hooks.json");
        fs::write(&path, "original").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();

        let saved = ObservedFile::read(&path).unwrap().write("updated").unwrap();

        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o640
        );
        assert!(saved.unchanged());
        assert_eq!(
            ObservedFile::read(&path).unwrap().text.as_deref(),
            Some("updated")
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlink_replacement_is_rejected_without_touching_its_target() {
        use std::os::unix::fs::symlink;
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("hooks.json");
        fs::write(&path, "original").unwrap();
        let observed = ObservedFile::read(&path).unwrap();
        let target = directory.path().join("target.json");
        fs::write(&target, "external").unwrap();
        fs::remove_file(&path).unwrap();
        symlink(&target, &path).unwrap();

        assert!(matches!(
            ObservedFile::read(&path),
            Err(ReadError::NotRegularFile)
        ));
        assert!(!observed.unchanged());
        assert!(matches!(
            observed.write("updated"),
            Err(WriteError::Conflict)
        ));
        assert_eq!(fs::read_link(&path).unwrap(), target);
        assert_eq!(
            ObservedFile::read(&target).unwrap().text.as_deref(),
            Some("external")
        );
    }

    #[test]
    fn external_edits_invalidate_observation_and_are_preserved() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("hooks.json");
        fs::write(&path, "original").unwrap();
        let observed = ObservedFile::read(&path).unwrap();
        fs::write(&path, "external").unwrap();

        assert!(!observed.unchanged());
        assert!(matches!(
            observed.write("updated"),
            Err(WriteError::Conflict)
        ));
        assert_eq!(
            ObservedFile::read(&path).unwrap().text.as_deref(),
            Some("external")
        );
    }

    #[cfg(unix)]
    #[test]
    fn same_content_replacement_invalidates_observation() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("hooks.json");
        fs::write(&path, "original").unwrap();
        let observed = ObservedFile::read(&path).unwrap();
        let replacement = directory.path().join("replacement.json");
        fs::write(&replacement, "original").unwrap();
        fs::set_permissions(&replacement, fs::metadata(&path).unwrap().permissions()).unwrap();
        fs::rename(&replacement, &path).unwrap();

        assert!(!observed.unchanged());
        assert!(matches!(
            observed.write("updated"),
            Err(WriteError::Conflict)
        ));
        assert_eq!(
            ObservedFile::read(&path).unwrap().text.as_deref(),
            Some("original")
        );
    }

    #[cfg(unix)]
    #[test]
    fn permission_changes_invalidate_observation_and_are_preserved() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("hooks.json");
        fs::write(&path, "original").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        let observed = ObservedFile::read(&path).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();

        assert!(!observed.unchanged());
        assert!(matches!(
            observed.write("updated"),
            Err(WriteError::Conflict)
        ));
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o640
        );
        assert_eq!(
            ObservedFile::read(&path).unwrap().text.as_deref(),
            Some("original")
        );
    }

    #[test]
    fn file_created_after_a_missing_observation_is_not_overwritten() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("hooks.json");
        let missing = ObservedFile::read(&path).unwrap();
        fs::write(&path, "external").unwrap();

        assert!(!missing.unchanged());
        assert!(matches!(
            missing.write("updated"),
            Err(WriteError::Conflict)
        ));
        assert_eq!(
            ObservedFile::read(&path).unwrap().text.as_deref(),
            Some("external")
        );
    }

    #[test]
    fn directory_replacement_is_rejected_and_preserved() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("hooks.json");
        fs::write(&path, "original").unwrap();
        let observed = ObservedFile::read(&path).unwrap();
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();

        assert!(matches!(
            ObservedFile::read(&path),
            Err(ReadError::NotRegularFile)
        ));
        assert!(!observed.unchanged());
        assert!(matches!(
            observed.write("updated"),
            Err(WriteError::Conflict)
        ));
        assert!(path.is_dir());
    }

    #[test]
    fn files_larger_than_four_mib_are_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("hooks.json");
        let mut text = "x".repeat(4 * 1024 * 1024);
        fs::write(&path, &text).unwrap();
        let observed = ObservedFile::read(&path).unwrap();
        assert_eq!(observed.text.as_deref(), Some(text.as_str()));

        text.push('x');
        fs::write(&path, &text).unwrap();
        assert!(matches!(
            ObservedFile::read(&path),
            Err(ReadError::TooLarge)
        ));
        assert!(!observed.unchanged());
        assert!(matches!(
            observed.write("updated"),
            Err(WriteError::Conflict)
        ));
        assert_eq!(fs::read_to_string(&path).unwrap(), text);
    }

    #[test]
    fn invalid_utf8_is_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("hooks.json");
        fs::write(&path, [0xff]).unwrap();

        assert!(matches!(ObservedFile::read(&path), Err(ReadError::Utf8)));
    }

    #[test]
    fn saving_does_not_create_a_missing_parent_directory() {
        let directory = tempfile::tempdir().unwrap();
        let parent = directory.path().join("missing");
        let path = parent.join("hooks.json");
        let observed = ObservedFile::read(&path).unwrap();

        assert!(matches!(
            observed.write("first"),
            Err(WriteError::Prepare(_))
        ));
        assert!(!parent.exists());
        assert!(observed.unchanged());
        assert_eq!(ObservedFile::read(&path).unwrap().text, None);
    }
}
