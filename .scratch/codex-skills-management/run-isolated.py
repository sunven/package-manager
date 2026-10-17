"""Run opt-in native/Git tests without user skill access or network.
Build first: cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run
Usage: python3 .scratch/codex-skills-management/run-isolated.py [test name]
"""
import os
from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(tempfile.mkdtemp(prefix="codex-skills-verify-")).resolve()
profile = root / "sandbox.sb"
user = Path.home()
profile.write_text(
    '(version 1)\n(allow default)\n(deny network*)\n(deny file-write*)\n'
    f'(allow file-write* (subpath "{root}") (literal "/dev/null"))\n'
    '(deny file-read* ' + ' '.join(f'(subpath "{user / name}")' for name in [".codex", ".agents", ".claude"]) + ')\n'
)
git_config = root / "gitconfig"
git_config.write_text(f'[url "file://{root}/repository"]\n\tinsteadOf = https://github.com/skills-test/fixture.git\n')
env = {**os.environ, "CODEX_SKILLS_TEST_ROOT": str(root), "TMPDIR": str(root),
       "GIT_CONFIG_GLOBAL": str(git_config), "GIT_CONFIG_NOSYSTEM": "1"}
binaries = [p for p in Path("src-tauri/target/debug/deps").glob("package_manager_control_center_lib-*") if p.is_file() and os.access(p, os.X_OK) and not p.suffix]
binary = max(binaries, key=lambda p: p.stat().st_mtime).resolve()
name = sys.argv[1] if len(sys.argv) > 1 else "real_codex_local_skill_lifecycle"
print(f"Isolated root: {root}\nBinary: {binary}", flush=True)
result = subprocess.run(["sandbox-exec", "-f", str(profile), str(binary), f"codex_skills::tests::{name}", "--ignored", "--exact", "--nocapture", "--test-threads=1"], env=env)
raise SystemExit(result.returncode)
