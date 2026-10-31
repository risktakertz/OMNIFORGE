# REA_AUTHORIZATION_POLICY — reverse engineering is optional and gated

The `rea` adapter (`integrations/adapters/rea/`) provides authorized
reverse-engineering support for software the user owns or is licensed to
analyze. It is an optional capability: catalog status is `blocked`, the
license is `review-required`, and the cost is conditional. No analysis
occurs — ever — without a recorded authorization basis.

## Mandatory preconditions

Before any REA tooling runs, the run must record:

1. **Target identity** — what software, version, and artifact is being
   analyzed.
2. **Authorization basis** — the legal ground: ownership, an explicit license
   to analyze, or written permission from the rights holder.
3. **Scope** — permitted methods, depth, data handling, and retention.

The adapter never runs merely because a product name was mentioned in a
request. Absent an authorization record, the capability stays blocked and is
reported as blocked — never simulated.

## Refusals (non-negotiable)

REA is refused outright for:

- credential or authentication bypass,
- DRM or copy-protection circumvention,
- piracy or assisting unlicensed distribution,
- extraction of secrets (keys, tokens, credentials) from any target.

These refusals align with the repository-wide untrusted-content and
gateway policies; attempting them through other tools is equally out of
bounds.

## SKILL.md installs nothing

A skill file's presence does not install any REA tool. Enabling the capability
requires the recorded authorization basis plus the official REA setup with a
confirmed live MCP registration. Native analysis engines may carry separate
license requirements; licenses are never acquired silently.

## Method and evidence

When authorized, work proceeds in one direction only: raw **observations** are
converted into clean, independent **specs**, and the deliverable is an
**original implementation** written in this repository — consistent with the
no-forks rule and the ban on copying upstream source trees. The adapter's
smoke test encodes this: authorization record → one bounded, authorized
analysis operation → evidence split into observed versus inferred facts. Until
that smoke test runs under a recorded authorization, the integration remains
honestly blocked in `integrations/catalog.yaml`.
