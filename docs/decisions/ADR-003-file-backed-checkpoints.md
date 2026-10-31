# ADR-003 — File-backed checkpoints for durable LangGraph runs

**Status:** Accepted (bootstrap, 2026-10-31)

## Context

LangGraph.js requires a checkpointer for durable, resumable runs. The natural
production choices (SQLite, Postgres) rely on native modules: SQLite bindings
mean a build step (node-gyp toolchain) that breaks the zero-native-dependency,
runs-anywhere property of the sandbox and CI, and Postgres implies a server
OMNIFORGE does not assume. Yet `omniforge resume` needs real durability —
state restored from a store, not from memory — and that property must be
proven by tests.

## Decision

`packages/orchestration` ships `FileCheckpointSaver`, a JSON + base64 file
checkpointer implementing the LangGraph `BaseCheckpointSaver` contract from
`@langchain/langgraph-checkpoint` (~0.0.18):

- `put()` serializes the checkpoint via the LangGraph serde (`dumpsTyped`) and
  writes `{ type, bytes, metadata, checkpointId }` as
  `checkpoint-latest.json` under a per-thread directory (thread ids sanitized
  to safe characters).
- `getTuple()`/`list()` reload and parse it back through `loadsTyped`.
- `putWrites()` appends pending writes to `writes.jsonl`; `deleteThread()`
  truncates the checkpoint file.
- `createRun()` uses the saver by default; `resumeRun()` replays the same
  thread id from the checkpoint store. Resume after an injected failure is
  verified in `tests/orchestration`.

## When to swap

The file saver stores only the latest checkpoint per thread (its `list()`
yields one tuple) and assumes a single writer per workspace. Swap to
`@langchain/langgraph-checkpoint-sqlite` (already on the continuation plan,
with a benchmark against the file saver) or a Postgres checkpointer when any
of the following hold: multi-process or multi-host execution, high-frequency
checkpoint writes, long retention with full history/time-travel, or
concurrent `omniforge` runs sharing one store. Because the saver implements
the standard `BaseCheckpointSaver` interface, the swap changes construction
only — the graph, nodes, and resume semantics stay untouched.
