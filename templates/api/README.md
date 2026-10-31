# api template

Typed HTTP API starter with a **zero-dependency runtime** (Node's `http`) and
strict TypeScript: `/health`, validated `/items` CRUD, structured error shape,
bounded request bodies.

```bash
npm install       # dev-only: typescript
npm test          # builds, then node:test suite
npm start         # serves on :8787 (PORT overridable)
```

Design notes: validation is explicit and hand-rolled to keep the supply chain
minimal; swap in Zod when the contract surface grows (routing pack). Database,
auth and rate limiting are later, separately-tested milestones — not faked here.
