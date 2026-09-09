#!/usr/bin/env python3
"""Restricted SSH deployment of the current, CI-approved main commit."""
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import shutil
import subprocess
import sys
import time
import urllib.request

REPO = "Lem0nTree/bnbera"
SERVICE = "bnbera-marketplace.service"


def run(args, **kwargs):
    process = subprocess.Popen(args, start_new_session=True, **kwargs)
    try:
        stdout, stderr = process.communicate(timeout=1800)
    except BaseException:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
        raise
    if process.returncode:
        raise subprocess.CalledProcessError(process.returncode, args)
    return subprocess.CompletedProcess(args, process.returncode, stdout, stderr)


def api(path):
    return json.loads(run(["gh", "api", f"repos/{REPO}/{path}"],
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL).stdout)


def approved(sha, branch, runs):
    if branch.get("object", {}).get("sha") != sha or not runs:
        return False
    latest = max(runs, key=lambda r: (r.get("id", 0), r.get("run_attempt", 0)))
    return (latest.get("head_sha") == sha and latest.get("head_branch") == "main"
            and latest.get("event") == "push" and latest.get("status") == "completed"
            and latest.get("conclusion") == "success"
            and latest.get("head_repository", {}).get("full_name") == REPO)


def require_approved(sha):
    branch = api("git/ref/heads/main")
    runs = api(f"actions/workflows/ci.yml/runs?branch=main&event=push&head_sha={sha}&per_page=10")
    if not approved(sha, branch, runs.get("workflow_runs", [])):
        raise RuntimeError("CURRENT_MAIN_CI_NOT_GREEN")


def atomic(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(text)
    temporary.replace(path)


def restore(dropin, previous):
    if previous is None:
        dropin.unlink(missing_ok=True)
    else:
        atomic(dropin, previous)
    run(["systemctl", "--user", "daemon-reload"])
    run(["systemctl", "--user", "restart", SERVICE])


def health(port, build_id, process=None):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        if process is not None and process.poll() is not None:
            raise RuntimeError("CANDIDATE_EXITED")
        try:
            base = f"http://127.0.0.1:{port}"
            with urllib.request.urlopen(base + "/api/marketplace?limit=1", timeout=10) as r:
                data = json.load(r)
            if (data.get("mode") != "live" or data.get("status") not in ["ready", "degraded"]
                    or data.get("contractVersion") != "bnbera.marketplace-read/v0.1"):
                raise RuntimeError("API_NOT_READY")
            with urllib.request.urlopen(base + "/", timeout=10) as r:
                if b"BNBEra" not in r.read():
                    raise RuntimeError("HTML_NOT_READY")
            with urllib.request.urlopen(base + f"/_next/static/{build_id}/_buildManifest.js", timeout=10) as r:
                if r.status != 200:
                    raise RuntimeError("WRONG_BUILD")
            return
        except (OSError, ValueError, RuntimeError):
            time.sleep(2)
    raise RuntimeError("HEALTH_CHECK_FAILED")


def promote(dropin, content, pending, verify):
    # Durable rollback journal also covers a disconnected SSH session or reboot.
    previous = dropin.read_text() if dropin.exists() else None
    atomic(pending, json.dumps({"previous": previous}))
    try:
        atomic(dropin, content)
        run(["systemctl", "--user", "daemon-reload"])
        run(["systemctl", "--user", "restart", SERVICE])
        verify()
    except BaseException:
        restore(dropin, previous)
        pending.unlink()
        raise
    pending.unlink()


def deploy(sha, config):
    root = Path(config["release_root"])
    root.mkdir(parents=True, exist_ok=True)
    dropin = Path(config["dropin"])
    pending = root / "pending.json"
    if pending.exists():
        restore(dropin, json.loads(pending.read_text())["previous"])
        pending.unlink()
        print("RECOVERED_PREVIOUS_RELEASE", flush=True)
    require_approved(sha)
    current_file = root / "current.json"
    previous_sha = None
    if current_file.exists():
        current = json.loads(current_file.read_text())
        previous_sha = current["sha"]
        if current["sha"] == sha:
            health(3022, current["build_id"])
            print(f"ALREADY_DEPLOYED {sha}", flush=True)
            return
    release = root / "releases" / sha
    release.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "BNBERA_ENV_FILE": config["repo_env_file"],
           "BNBERA_NEXT_DIST_DIR": ".next", "NEXT_TELEMETRY_DISABLED": "1"}
    wrapper = ["/usr/bin/node", "--env-file=" + config["runtime_env_file"],
               str(release / "scripts/run-with-repo-env.mjs"), "--"]
    log_path = root / (sha + ".log")
    with log_path.open("ab") as log:
        cache = root / "repository.git"
        if not cache.exists():
            run(["git", "clone", "--bare", f"https://github.com/{REPO}.git", str(cache)], stdout=log, stderr=log)
        run(["git", "--git-dir", str(cache), "fetch", "origin", "main"], stdout=log, stderr=log)
        fetched = run(["git", "--git-dir", str(cache), "rev-parse", "FETCH_HEAD"], stdout=subprocess.PIPE, stderr=log).stdout.decode().strip()
        if fetched != sha:
            raise RuntimeError("MAIN_ADVANCED")
        if not (release / ".deploy-built").exists():
            print(f"BUILDING {sha}", flush=True)
            archive = root / (sha + ".tar")
            run(["git", "--git-dir", str(cache), "archive", "--format=tar", "--output=" + str(archive), sha], stdout=log, stderr=log)
            run(["tar", "-xf", str(archive), "-C", str(release)], stdout=log, stderr=log)
            archive.unlink()
            run(["pnpm", "install", "--frozen-lockfile", "--prod=false"], cwd=release, stdout=log, stderr=log)
            run(wrapper + ["pnpm", "build"], cwd=release, env=env, stdout=log, stderr=log)
            (release / ".deploy-built").touch()
        # Existing read-only check includes exact migration journal hashes. No migrations run here.
        run(wrapper + ["pnpm", "exec", "tsx", "scripts/marketplace-readiness.ts", "--database-only"],
            cwd=release, env=env, stdout=log, stderr=log)
        build_id = (release / "apps/web/.next/BUILD_ID").read_text().strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]+", build_id):
            raise RuntimeError("INVALID_BUILD_ID")
        candidate = subprocess.Popen(wrapper + ["pnpm", "--filter", "@bnbera/web", "start", "--port", "3023", "--hostname", "127.0.0.1"],
                                     cwd=release, env=env, stdout=log, stderr=log, start_new_session=True)
        try:
            health(3023, build_id, candidate)
        finally:
            try:
                os.killpg(candidate.pid, signal.SIGTERM)
                candidate.wait(timeout=15)
            except ProcessLookupError:
                pass
            except subprocess.TimeoutExpired:
                os.killpg(candidate.pid, signal.SIGKILL)
                candidate.wait()
    # Never promote a commit overtaken during the build, or a now-failed CI rerun.
    require_approved(sha)
    command = wrapper + ["/usr/bin/pnpm", "--filter", "@bnbera/web", "start", "--port", "3022", "--hostname", "127.0.0.1"]
    # Config paths are operator-owned and validated below; systemd expands % specifiers.
    content = (f"[Service]\nWorkingDirectory={release}\nEnvironment=BNBERA_NEXT_DIST_DIR=.next\n"
               f"Environment=BNBERA_ENV_FILE={config['repo_env_file']}\nExecStart=\nExecStart={' '.join(command)}\n")
    promote(dropin, content, pending, lambda: health(3022, build_id))
    atomic(current_file, json.dumps({"sha": sha, "build_id": build_id, "release": str(release), "deployed_at": int(time.time())}) + "\n")
    print(f"DEPLOYED {sha} build={build_id}", flush=True)
    # Only this controller's SHA-named releases; retain current, previous and
    # the newest other release. Existing developer checkouts are never touched.
    releases = sorted((p for p in (root / "releases").iterdir()
                       if p.is_dir() and not p.is_symlink() and re.fullmatch(r"[a-f0-9]{40}", p.name)),
                      key=lambda p: p.stat().st_mtime, reverse=True)
    keep = {sha, previous_sha}
    keep.update(p.name for p in releases[:3])
    for old in releases:
        if old.name not in keep:
            shutil.rmtree(old)


def main():
    os.umask(0o077)
    def interrupted(_signal, _frame):
        raise RuntimeError("DEPLOY_INTERRUPTED")
    for sig in (signal.SIGHUP, signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, interrupted)
    sha = os.environ.get("SSH_ORIGINAL_COMMAND") or (sys.argv[1] if len(sys.argv) == 2 else "")
    if not re.fullmatch(r"[a-f0-9]{40}", sha):
        raise RuntimeError("EXPECTED_EXACT_COMMIT_SHA")
    config = json.loads((Path.home() / ".config/bnbera/deploy.json").read_text())
    for key in ["release_root", "dropin", "repo_env_file", "runtime_env_file"]:
        if not re.fullmatch(r"/[A-Za-z0-9_./-]+", config[key]):
            raise RuntimeError("INVALID_CONFIG_PATH")
    root = Path(config["release_root"])
    root.mkdir(parents=True, exist_ok=True)
    with (root / "deploy.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        deploy(sha, config)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Subprocess output stays in owner-only logs; never echo commands/env/error bodies.
        print(f"DEPLOY_FAILED {type(error).__name__}", file=sys.stderr)
        sys.exit(1)
