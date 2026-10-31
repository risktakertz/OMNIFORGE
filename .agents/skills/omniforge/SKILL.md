---
name: omniforge
description: Host-discovery shim that points to the real OMNIFORGE skill. Use for any software-creation request; the authoritative SKILL.md lives at skills/omniforge/SKILL.md.
version: 0.1.0
license: MIT
---

# omniforge (host shim)

This file exists so hosts that scan `.agents/skills/` can discover OMNIFORGE.
The authoritative skill, references and CLI entry points live at
`skills/omniforge/SKILL.md` (repository root). Do not edit this shim for
behavior changes — regenerate via `node scripts/gen-skills.mjs`.
