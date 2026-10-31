# CAPABILITY_MATRIX — product categories, honest status today

Statuses use the shared vocabulary (`verified | configured | unavailable |
blocked | untested`) per `skills/omniforge/references/capabilities.md`:
templates shipped with passing tests are verified. "Verified" always means
smoke-tested in this repository; nothing is simulated.

| Product category | Template | Status today | What works now | Honestly blocked and why |
| --- | --- | --- | --- | --- |
| Website (standard) | `static-business` | verified (template tests + browser E2E) | Generation, render to `dist/`, dependency-free tests, export, **real chromium interactions (render, nav anchors, contact form, mobile viewport)** | — (browser E2E green where chromium exists; honestly BLOCKED elsewhere) |
| Website (content-heavy) | `astro-business` | configured | Template + structure tests; astro ^5.2.5 pinned | Install/build proven only via the on-demand dispatch integration workflow |
| Web app | `next-web` | configured | Template + structure tests; next ^15.1.6 / react ^19.0.0 | Same on-demand build model; hosting terms rechecked at deploy time |
| Commerce storefront | `commerce-lite` | verified (template tests) | Catalog, search, cart, mock checkout, order history | Real payments: `APPROVED_SPEND=0`, no credentials; Medusa path untested |
| Booking | `booking-lite` | verified (template tests) | Services, slot logic, WhatsApp deep-link, demo mode | Reminders/payments need the approved automation adapter |
| Dashboard | `dashboard-lite` | verified (template tests) | Generation, render step, dashboard logic tests | Deeper analytics is later scope, not claimed |
| 2D browser game | `phaser-2d` | verified logic tests | Pure game-logic modules pass node tests; Phaser CDN 3.80.1 pinned | Browser loop not e2e-verified without a browser; CDN is runtime-external |
| 3D native game | `godot-native` | blocked | Real Godot project structure + structure tests | Godot binary absent; engine stays outside the pnpm/turbo graph |
| Mobile | `expo-mobile` | blocked | Real Expo scaffold + structure tests (expo ~53.0.0, react-native 0.79.1) | Builds need Android SDK locally or paid EAS; iOS needs Mac + certificates |
| Desktop | `tauri-desktop` | blocked | Real Tauri 2 scaffold + structure tests | Rust toolchain required; signing is a separate approved milestone |
| API / automation | `api` (+ automation adapter) | verified (template tests); automation configured | Zero-dependency Node HTTP API: `/health`, validated CRUD, node:test suite | Real deploy/automation needs approved credentials; Coolify blocked (no free server) |
| SaaS (multi-tenant) | `saas` composition guide, base `next-web` | blocked | White-label foundation with honest roadmap note | Auth, tenant isolation (RLS), billing not implemented yet |
| AI coding agent (cloud-ready MVP) | `generator:agent-mvp` | verified (composed + self-tested + exported) | One-sentence request composes an ORIGINAL agent: CLI loop (plan→edit→test→diff→checkpoint), pluggable model adapter (honest MOCK offline), exactly-once journal, credential-gated GitHub adapter, allowlist sandbox, scoped approvals, own passing suite | Live AI behavior needs an authorized model credential; hosted multi-user service is a separate approved milestone |

Cross-cutting (autonomy mission): the task plan GOVERNS execution
(`executeDag` + durable `dag-state.json`, idempotent resume); repair is
evidence-driven and bounded (deterministic fixers, typed blockers
E_REPAIR_NONIMPROVING / E_MODEL_UNAVAILABLE); verification contract v2 —
original acceptance criteria are persisted per workspace and critical
skipped/blocked/not-run checks can never produce a PASS; selected skills with
executable entrypoints really run through the gateway; execution isolation
probes docker/podman and refuses untrusted host execution without a container
(E_SANDBOX_UNAVAILABLE); approvals are action-, target- and run-specific.
Browser E2E is a real Playwright suite (`tests/e2e/browser.e2e.mjs`) that runs
where chromium exists and reports BLOCKED honestly where it does not.
