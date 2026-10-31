# Integration adapters

Each adapter directory documents a real integration path with an honest status.
Nothing here is "installed" by writing documentation — a capability becomes
verified only after its smoke test passes (see `docs/TESTING_AND_EVIDENCE.md`).

| Adapter | Mode | Status | Smoke test |
| --- | --- | --- | --- |
| `openspec/` | CLI | untested | `openspec` spec lifecycle round-trip on a sample change |
| `gstack/` | methodology | configured | host discovery + one advisory review pass |
| `superpowers/` | methodology | configured | TDD workflow applied to a sample bugfix |
| `rea/` | MCP/CLI | blocked | authorization record -> bounded analysis run |
| `opencode/` | CLI | blocked | `opencode --version` + one real task |
| `openhands/` | Python server + API | untested | agent server boot + one task via HTTP |
| `playwright-mcp/` | MCP | untested | tool discovery + one harmless page inspection |
| `repomix/` | CLI | untested | selective packing of this repository |
| `context7/` | hosted API | blocked | version-specific docs fetch with credentials |
| `local-models/` | local service | untested | Ollama `/api/tags` probe + one completion |
| `commerce/` | template/library | configured | commerce-lite suite (passing); Medusa path documented |
| `automation/` | mock-first | configured | automation flows in sandbox mode |
| `deployment/` | dry-run adapter | configured | `omniforge deploy --dry-run` report |
