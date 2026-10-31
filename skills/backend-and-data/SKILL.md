---
name: backend-and-data
description: "Typed APIs, validation boundaries and data-layer selection (none / local / Postgres-Supabase when approved) with migrations and isolation tests."
version: 0.1.0
license: MIT
capabilities: [api, databases, auth-boundaries]
cost: free
---

# Backend & data skill

Start with no backend when possible. Typed contracts, validation on every input, structured errors, bounded request bodies. Supabase/Postgres only when justified and approved; RLS + isolation tests before any multi-tenant claim. See templates/api.