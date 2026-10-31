---
name: architecture
description: "Selects the minimal effective architecture per product kind (static, node, engine), defines data flows, isolation boundaries and the dependency-aware task DAG."
version: 0.1.0
license: MIT
capabilities: [architecture, task-graph, technical-planning]
cost: free
---

# Architecture skill

Rules: smallest effective stack; one control plane; no speculative abstraction; engines stay outside the TS build graph; every milestone has a verifiable deliverable. Produce the family choice (static/node/engine), stack list and the task graph via the task-planner package.