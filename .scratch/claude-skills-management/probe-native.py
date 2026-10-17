"""Isolated Claude initialization probes. No user messages or model requests."""
import json
import os
from pathlib import Path
import selectors
import subprocess
import tempfile
import time


def initialize(config, cwd, extra=()):
    env = {
        "PATH": os.environ["PATH"],
        "CLAUDE_CONFIG_DIR": str(config),
        "ANTHROPIC_API_KEY": "isolated-probe",
        "ANTHROPIC_BASE_URL": "http://127.0.0.1:1",
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
        "DISABLE_AUTOUPDATER": "1",
    }
    process = subprocess.Popen(
        ["claude", "--print", "--input-format", "stream-json",
         "--output-format", "stream-json", "--verbose", "--no-session-persistence",
         "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
         "--setting-sources", "user,project,local", "--settings", '{"disableAllHooks":true}', *extra],
        cwd=cwd, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True,
    )
    process.stdin.write(json.dumps({"type": "control_request", "request_id": "probe",
                                   "request": {"subtype": "initialize"}}) + "\n")
    process.stdin.flush()
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    deadline = time.monotonic() + 15
    try:
        while time.monotonic() < deadline:
            if selector.select(timeout=1):
                line = process.stdout.readline()
                if not line:
                    break
                response = json.loads(line)
                if response.get("type") == "control_response":
                    assert response["response"]["subtype"] == "success", response
                    return response["response"]["response"]["commands"]
        raise RuntimeError("No initialization response")
    finally:
        selector.close()
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        process.stdin.close()
        process.stdout.close()
        process.stderr.close()


def main():
    results = []
    with tempfile.TemporaryDirectory(prefix="claude-skills-native-") as temporary:
        root = Path(temporary)
        config, cwd = root / "config", root / "project"
        cwd.mkdir()
        skill = config / "skills" / "probe-original"
        skill.mkdir(parents=True)
        command = config / "commands" / "frontend" / "probe-command.md"
        command.parent.mkdir(parents=True)
        command.write_text("---\ndescription: isolated legacy definition\n---\nDo not execute.\n")
        for declaration in ["", "disable-model-invocation: true\n", "user-invocable: false\n"]:
            (skill / "SKILL.md").write_text(
                "---\nname: probe-alias\ndescription: isolated skill definition\n"
                + declaration + "---\nDo not execute.\n"
            )
            for key in ["probe-original", "probe-alias"]:
                for mode in [None, "on", "name-only", "user-invocable-only", "off"]:
                    (config / "settings.json").write_text(json.dumps({
                        "disableAllHooks": True,
                        "skillOverrides": {} if mode is None else {key: mode},
                    }))
                    commands = initialize(config, cwd)
                    selected = [c for c in commands if "probe" in c["name"]]
                    results.append({"declaration": declaration.strip(), "key": key,
                                    "mode": mode, "commands": selected})
        (config / "settings.json").write_text(json.dumps({
            "skillOverrides": {"frontend:probe-command": "off"}}))
        selected = [c for c in initialize(config, cwd) if "probe" in c["name"]]
        results.append({"legacy_off": selected})
        project_settings = cwd / ".claude" / "settings.local.json"
        project_settings.parent.mkdir()
        project_settings.write_text(json.dumps({
            "skillOverrides": {"frontend:probe-command": "on"}}))
        selected = [c for c in initialize(config, cwd) if "probe" in c["name"]]
        results.append({"project_overrides_user": selected})
    output = Path(__file__).with_name("native-probe-results.json")
    output.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n")
    for result in results:
        print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
