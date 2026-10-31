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

## Model-assisted goal interpretation (v0.2)

The orchestration graph accepts an optional `modelInterpreter` hook. The CLI
wires it automatically when `OPENAI_API_KEY` is present (OpenAI-compatible;
honor `OPENAI_BASE_URL` / `OPENAI_MODEL` for compatible providers):

- **No credential** → novel/unmatched goals return the honest typed blocker
  `E_INTENT_NOVEL` / `E_NEEDS_MODEL` with setup instructions. Nothing is
  fabricated and no silent template mapping happens.
- **Credential present** → the interpreter requests structured JSON
  (temperature 0.1, response_format json_object) describing the goal. The
  result is merged by `mergeModelGoalSpec`, which can fill understanding
  fields (objective, requirements, deliverables, risks) but can NEVER change
  policy fields: constraints, privacy, licensing and budget always come from
  the deterministic side. Requests are truncated to 4000 chars; calls time out
  at 30s; key values are never logged.

Status vocabulary applies here too: a provider with a key present is
`configured`, not `verified` — the first successful structured interpretation
is the verification event, and quality evaluation remains the operator's
authorized responsibility.
