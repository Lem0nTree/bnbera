# Historical release evidence

These JSON, screenshot and PostgreSQL-smoke artifacts remain at their original paths because scripts and tests consume them. They describe their recorded dates and environments, not the current release status. Older narrative handoffs have been archived.

Run `pnpm evidence:release-check` to validate artifact structure/integrity. A passing validator does not mean the MVP gates passed. In particular, `erc8004-e2e.json` records an incomplete historical pipeline run; preserve it accurately.

Current scope and tasks are in [the master plan](../MVP-MASTER-PLAN.md) and [task list](../MVP-TASKS.md). T3 creates `docs/MVP-STATUS.md` with new current-SHA gate results; later tasks update it and add their own timestamped evidence. No credential, raw session or private input belongs in evidence.
