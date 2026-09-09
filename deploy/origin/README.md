# Production deployment

`Deploy production` runs after successful **push CI on main** and can be
started manually from GitHub Actions. It checks the current main SHA, then
sends only that SHA over SSH. The origin independently repeats the exact
main/CI check before building and before switching. PRs, forks, failed CI,
and obsolete commits cannot deploy. GitHub concurrency plus an origin lock
serialize deployments.

The existing topology remains: Cloudflare Worker → Access-protected tunnel →
`bnbera-marketplace.service` on port 3022. A temporary candidate uses localhost
3023. No GitHub runner, timer, new DNS record or public database is installed.

## Installed origin

- Controller: `~/.local/bin/bnbera-deploy.py` (installed copy of `deploy.py`).
- Non-secret configuration: `~/.config/bnbera/deploy.json`.
- Releases, private build logs, lock, rollback journal and `current.json`:
  `~/.local/state/bnbera-deploy/`.
- Production override: `~/.config/systemd/user/bnbera-marketplace.service.d/zzzz-autodeploy.conf`.
- Existing runtime dotenv files stay outside the releases and GitHub. Build
  and runtime load the same files, including public browser configuration.

The JSON configuration contains absolute `release_root`, `dropin`,
`repo_env_file`, and `runtime_env_file` paths. Paths may contain letters,
numbers, slash, dot, underscore and hyphen. The origin needs Python 3, Git,
Node 22, pnpm 10.15.1 and `gh` authenticated for repository/Actions reads.
The SSH login is the existing `ubuntu` service owner.

GitHub repository secrets:

- `BNBERA_DEPLOY_HOST`: origin IPv4/hostname.
- `BNBERA_DEPLOY_SSH_KEY`: dedicated deployment key.
- `BNBERA_DEPLOY_KNOWN_HOSTS`: host key obtained on the origin, not an unverified
  network scan. SSH requires this exact host key.

The corresponding authorized key uses `restrict` and a forced command:
`command="/usr/bin/python3 /home/ubuntu/.local/bin/bnbera-deploy.py"`.
It cannot run an arbitrary shell command, forward ports or allocate a PTY.
Its only accepted input is a full lowercase 40-character commit SHA, which
must independently pass the current-main/CI checks.

To update the controller, review and install the accepted `deploy.py` copy
at the fixed path above. Runtime releases do not overwrite this SSH boundary.

## Deploy and recover

```sh
gh workflow run deploy.yml --ref main
gh run list --workflow deploy.yml --limit 5
cat ~/.local/state/bnbera-deploy/current.json
systemctl --user status bnbera-marketplace.service
```

The script builds a separate exact-commit release, checks the retained DB's
migration hashes through the existing read-only readiness command, and starts
a candidate. It checks live API, HTML and that release's build-specific asset,
then switches the service and repeats health checks. A failed switch restores
the previous override and restarts the previous application. A durable journal
recovers interrupted promotions on the next invocation. Confirmed builds are
reused on retry, and deploying the active SHA performs a health check without
restarting it. Old managed releases are pruned after success, preserving the
current/previous releases and the three most recent candidates.

Database migrations require their existing backed-up migration procedure;
this workflow never migrates, resets data, starts signing workers or changes
payment flags. A missing migration blocks deployment before the service switch.
A restart can briefly interrupt requests; this is not a zero-downtime router.

To pause deployment, disable `Deploy production` in GitHub Actions or run
`gh workflow disable deploy.yml`. To restore the pre-autodeployment service,
disable the workflow, move only `zzzz-autodeploy.conf` outside the drop-in
directory, run `systemctl --user daemon-reload`, then restart the marketplace
service. Retained DB data and older service configuration stay intact.

A changed origin IP/host key or expired origin GitHub credential must be
updated explicitly. Inspect workflow output and the owner-only SHA log for
failures; do not publish raw logs or dotenv contents.
