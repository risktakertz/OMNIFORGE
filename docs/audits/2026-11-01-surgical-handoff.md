# Surgical integration — measured handoff

Date: 2026-11-01. Base: `f2fd9b6af988bf844d63faf95f411eba14c4c27a`.
Final code revision: `dcaaeac3944b1d6b425996189926a771ca3d9596`.
Subsequent documentation commit does not alter executable sources.

## Result and limits

The missing canonical-goal, model-budget, coding-DAG, structural-analysis,
scoped-modification/repair and delivery-status bridges are implemented and
internally verified. This is not a claim of arbitrary universal implementation,
live model quality, arbitrary reverse engineering or production deployment.
Live-model/container smoke remains **BLOCKED** on this host. Composite work
without dependency contracts and unsupported analysis methods return explicit
blockers rather than incomplete substitutes.

The real-writing backend test enters the exported CLI `main(argv, services)`,
receives a model-enriched novel goal, writes a non-template source manifest,
measures its new file, actually runs an independent acceptance script, verifies
the original criteria and exports the artifact. A subsequent scoped modification
preserves the original test and source bytes. This uses an injected backend;
neither its output nor the separate injected container test is a live-model claim.

## Validation

Environment: Windows, PowerShell, Node v24.15.0, pnpm 9.15.9; lockfile preserved
except one new workspace dependency edge (three lockfile lines, no upgrades).

- `pnpm install --frozen-lockfile`: PASS.
- `pnpm verify`: PASS — lint, typecheck (33 build/typecheck tasks), build (17 tasks),
  **254 tests in 30 files**, CLI E2E and real Chromium DOM interactions.
- After the final linked-entrypoint correction: `pnpm lint`, CLI typecheck and
  `pnpm build`: PASS; `pnpm exec vitest run tests/integration/cli.test.ts tests/orchestration/surgical.test.ts`:
  **26/26 PASS**, including the added linked-entrypoint test. The final CI suite
  contains that additional test; do not misreport the earlier full local count.
- Final thrown-outcome/lease closure: lint, full typecheck and build PASS;
  affected CLI/orchestration/resume suites **37/37 PASS**. After rebuilding the
  final resume guard, source and compiled cross-process resume suites **11/11 PASS**.
- After the first PR CI incident: lint/build PASS and affected acceptance plus
  surgical suites **22/22 PASS under Node 22.23.4** locally. The generated runner
  binds Node commands to `process.execPath`, including with an empty PATH.
- `OF_E2E_REQUIRED=1 node tests/e2e/browser.e2e.mjs`: PASS — page, brand, anchors,
  contact form, mobile viewport and screenshot observed on actual Chromium.
- Required browser mode with an explicitly empty `PLAYWRIGHT_BROWSERS_PATH`:
  expected BLOCKED/nonzero observed; the wrapper asserted nonzero. No false green.
- `git diff --check`: PASS. Supplied-token prefix absent from tracked content.

The earlier broad local failures were retained in working logs while corrected:
missing initial build, Windows path separators, stale dashboard artifact name,
the newly enforced arbitrary-fixture refusal and a transient OneDrive rename
lock. No test was deleted or relaxed to conceal these defects. The arbitrary
fixture refusal test still checks numeric-archetype mismatch using a repo-owned
fixture, and also asserts refusal of arbitrary host imports.

## I01–I16 acceptance ledger

PASS below means the exact internal assertion, including a required blocker when
specified; it never means a live model/toolchain or unsupported product is verified.

| ID | Result | Reproducible evidence |
| --- | --- | --- |
| I01 | PASS | Existing bakery/salon acceptance, CLI creation/tests/export; built CLI E2E and Chromium |
| I02 | PASS | Existing commerce, booking, dashboard and racing/game suites; U-series retained; dashboard contract names the actual tested module |
| I03 | PASS | `surgical.test.ts`: real CLI main → enriched goal → file-writing fake → measured source diff → actual acceptance execution → verified export |
| I04 | PASS | Same orbital-manifest request through CLI subprocess without backend: E_NEEDS_MODEL, exit 2, no DONE/PASSED |
| I05 | PASS | Injected interpretation changes effective platform/requirements; original policy/identity retained; blueprint/DAG use those fields |
| I06 | PASS | Model policy HTTP spy, custom-hook gate and exported-agent child test prove key/zero approval causes zero HTTP/model-hook calls |
| I07 | PASS | Explicit fake free provider makes one bounded mocked HTTP call; second call is refused; in-process coding remains zero cost |
| I08 | PASS | Repo-owned fixture structural inventory → rights/provenance/hash report → work-blueprint verification → export; no dist/website |
| I09 | PASS | Missing rights and circumvention denial before inspecting a nonexistent target; arbitrary host fixture import refused |
| I10 | PASS | Shared staged modification engine verifies original B1/B2/security guard plus new B3; unrelated original source and acceptance harness byte-identical |
| I11 | PASS | Out-of-scope real-writing fake rejected before application; original preserved; failed orchestrator reports failure with no delivered artifact |
| I12 | PASS | Forged workspace provenance + injected absent runtime cannot execute sentinel script; trusted fixture/template suites still execute |
| I13 | PASS | Existing cross-process resume test; durable task ledger, recovered evidence, exclusive run lock and shared budget reservations; failed retry does not reinvoke exhausted backend |
| I14 | PASS | Real required-mode Chromium PASS; explicitly absent browser returns nonzero BLOCKED; critical non-runs remain non-passing |
| I15 | PASS (blocker contract) | Composite interpreted API + website returns per-deliverable E_DELIVERABLE_UNSUPPORTED prerequisites before implementation; dependency execution is not claimed |
| I16 | PASS | JSON/human subprocess failures return typed nonzero outcomes without success wording; early DAG failure writes a final failed report |

Tests: `tests/orchestration/surgical.test.ts`, `packages/model-router/src/policy.test.ts`,
`packages/agent-runtime/src/container.test.ts`, gateway/verification suites and
the retained acceptance/U-series/CLI/resume suites.

## CI evidence and resource discipline

Latest base code CI: [41203874904](https://github.com/risktakertz/OMNIFORGE/actions/runs/41203874904),
**success**, SHA `9608efc027d3decd668bbfde267bfed9d11eff17`. Fresh base HEAD is its
docs-only successor. Runs `41203190435` and `41202234818` are historical failures,
already corrected; neither was rerun. The original quoted YAML browser step and
required Chromium gate are retained. The PR's Checks and final task response
record the new revision's matching CI result; base CI is not represented as
proof for the new code. No heavy integration/security workflows were dispatched.

First PR-head run [41298995303](https://github.com/risktakertz/OMNIFORGE/actions/runs/41298995303)
at `998bf9450067517dacfb99472cc7e91785b2e723` failed one generated agent-MVP
acceptance case: **254 passed / 1 failed**, with install/lint/typecheck/build
passing. It was not blindly rerun. The local Windows Node 22 reproduction passed;
the generated command runner was hardened against Linux/clean-environment Node
lookup differences and given an explicit empty-PATH assertion. Failure reporting
now carries actual suite stdout and task details rather than only dag-failures.
The follow-up source revision is the code SHA above; its matching Linux CI
conclusion must be retrieved before claiming the incident resolved.

## Remaining prerequisites and setup

1. Install and start Docker/Podman; preload `node:22-bookworm-slim` for independent
   generated-code tests. The runner refuses implicit image pulls, uses no network,
   a non-root user, resource limits, dropped capabilities and named-container
   cleanup on timeout.
2. Supply a preloaded image bundling OpenCode and authorized **local** inference.
   Construct `createContainerOpenCodeBackend(gateway, { image, model, authorizeModelCall, env })`.
   This concrete driver has no network egress and forwards only explicitly supplied
   runtime configuration. A remote paid endpoint cannot silently become its fallback.
3. Supply an auditable ModelCallPolicy with exact provider/model/endpoint, verified
   cost classification, run/task budgets and invocation reservation limits. Zero
   approved spend forbids paid calls. Use `reserveModelCall` outside generated mounts.
4. Run backend health: version probe means only configured. Run its authorized
   `smoke()` and independently verify the real edit/test before using verified health.
   Installations, model names, environment variables and injected tests are not proof.
5. Supply CodingExecution through `main(argv, services)` or `createRun`, with bounded
   paths, expected outputs and original acceptance. Supply `interpreterPolicy`
   alongside any custom model interpreter. General modification uses the same
   service through CLI main or `modifyWithBackend`.
6. Composite dependency execution and additional analytical methods need their own
   explicit typed contracts/executable probes; current precise blockers are intentional.

No live model/API request, paid charge, hosting/payment action, deployment,
history rewrite, force push, fork or unrelated-repository modification occurred.
The GitHub credential was used only for authentication and was never written to
repository files, commits, PR text or workflow configuration. Code publication
is limited to the authorized work branch and PR; no merge is performed.

## Residual risks

The concrete container route is contract-tested with an injected runtime, but
its real image/model/cancellation/resource behavior is unverified on this host.
Cooperative cancellation is not advertised by that adapter; wall-clock timeout
and named-container cleanup are enforced by the runner. A stale model-budget
reservation lock deliberately blocks until its prior reservation is reconciled.
Detached temporary authority records may be cleaned by the OS; absence causes a
safe sandbox requirement, not automatic trust restoration. The exported agent
MVP remains a documented prototype, not a production multi-user sandbox/service.
