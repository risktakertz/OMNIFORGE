# MODEL_ROUTING — registry from environment, zero-model is a valid state

`packages/model-router` maintains a registry of authorized providers built
strictly from the environment. No provider is assumed; no key is ever read
beyond presence detection. The deterministic core never requires a model.

## Registry and availability states

`buildRegistry()` scans for `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`. When a
key is present, its models register as `configured` with the note "key
present; capability untested until first authorized call" — presence is not
proof. Missing keys register as `unavailable` with the reason in notes. The
current model list is gpt-4o, gpt-4o-mini (openai), claude-sonnet-4-5,
claude-haiku-4-5 (anthropic), and ollama/llama3.2. Local Ollama starts as
`untested` and is promoted only by `probeOllama()`, which calls `GET /api/tags`
(default 800 ms timeout) and returns `verified` with the installed model list
or `unavailable` — never an assumption.

## Profile ordering

Routing consults per-profile preference orders:

- `cheap-summarization`: gpt-4o-mini → claude-haiku-4-5 → ollama:llama3.2 →
  gpt-4o → claude-sonnet-4-5
- `code-generation`: claude-sonnet-4-5 → gpt-4o → ollama:llama3.1 →
  gpt-4o-mini → claude-haiku-4-5
- `architecture`: claude-sonnet-4-5 → gpt-4o → ollama:llama3.1
- `security-review`: claude-sonnet-4-5 → gpt-4o

## Refusal for high-risk profiles

With `requireVerified: true`, a `configured`-but-unproven model is not
acceptable: the route returns status `blocked` with the reason "high-risk
profile requires a verified model; refusing silent degradation". Only
`verified` availability satisfies the flag. Without the flag, a configured
model may serve low-risk profiles, and the decision reason states that its
quality is unverified.

## Deterministic-core fallback

Every `RouteDecision` carries a mode: `model-assisted` or
`deterministic-core`. When no authorized model exists (status `no-model`), the
system continues on the deterministic core — intent parsing, blueprints,
routing, planning, execution, verification, and export all work with zero
models. Missing backends surface as typed gaps (for example, the hosted docs
provider raises `E_BACKEND_UNAVAILABLE`), never as silent quality loss.

## Untrusted output

Model output is untrusted input. Anything a model produces is validated before
it influences a run, is never auto-executed, and is subject to the same
sanitization rules as any other external content. `registrySnapshot()` and the
`omniforge models` command expose the current registry honestly.

---

## Explicit model authorization (2026-11-01)

Credential presence registers availability only. The CLI does not activate an
interpreter from a key. Embedders call buildModelInterpreter(env, policy, ledger)
with an operator-approved ModelCallPolicy, then inject that interpreter and its
interpreterPolicy through
the CLI main(argv, services) or createRun(request, services).

Every approved route binds approvalId, provider, model, exact endpoint, verified
cost class, approvedSpend, taskBudget, conservative reservedPerCall and maxCalls.
Unknown cost is refused. APPROVED_SPEND defaults to zero and caps the policy.
Paid calls need positive run/task budgets and a positive reservation. Failed
attempts retain reservations; coding-task reservations persist in model-budget.json
before execution. Interpretation hooks and coding tasks share the orchestrator's
durable reservation ledger; even a custom hook is gated before invocation.
Standalone interpreter users must persist and restore their supplied ledger
across process restarts. There is no automatic paid fallback.

The operator must verify provider cost/origin before classifying a route as
verified-free; a label, credential or compatible URL is not evidence. The tests
use explicitly injected in-process/fake providers and make no live model claim.

Requests are bounded to 4000 input characters, 1500 output tokens and 30 seconds;
redirects are refused. Structured output is schema-validated, then resolved into
the effective intent without changing intake identity, operation or permissions.

The exported agent MVP uses the same pure policy decision function. Live planning
and editing both require MODEL_APPROVAL_FILE and MODEL_LEDGER_FILE, with the ledger
outside the writable target; its exclusive lock and conservative reservations
cover failures and restarts. Missing approval blocks before HTTP, even with a key.

## Coding backend setup and limits

Use a CodingExecution service with backend, policy, bounded scope,
acceptanceCriteria, expectedOutputs and an optional trusted acceptanceFiles harness.
Inject it through createRun or the exported CLI main(argv, services). Deterministic
templates remain preferred when their scope fits. General modifications use the
same service via modifyWithBackend or CLI main's modify command.

A backend must report verified health, real model capability, executeTask and an
enforced executionBoundary. The OpenCode adapter accepts an isolatedExecution
driver plus an authorizeModelCall reservation callback; the host CLI alone is
blocked. createContainerOpenCodeBackend supplies a concrete Docker/Podman driver
using a preloaded image, no network, no implicit image pulls and no inherited
host environment. That image must bundle OpenCode and authorized local inference.
The version probe reports configured; only a real edit/test smoke earns verified.
The driver is covered with an injected runtime, not a claimed live-model smoke.
Before enabling a real route, install the backend and
model in a constrained runtime, enforce writable mounts/egress/resources and
cancellation, run its real smoke and independently verify its tests. Installing
the binary or setting a key alone is insufficient. No such live route was
verified during this integration.

Generated code without repo-owned provenance needs Docker/Podman and a preloaded
node:22-bookworm-slim image for independent tests. The runner never pulls images
implicitly. Workspace trust records live outside generated mounts under the OS
temporary omniforge-trust directory; exported manifests alone never grant host
execution. Exported projects remain runnable independently, but importing them
back does not confer host trust.
