# apps/worker — planned (M5)

Durable job runner, separated from any web process. Today, execution happens in
the orchestration graph with durable file checkpoints and the run journal; a
long-running worker process for schedules/cron-style automation arrives with
the automation factory milestone.

Design constraint: the worker will consume the same task planner output and
tool-gateway policy as the CLI — no second policy implementation.
