---
name: reverse-engineering
description: "Authorized-only behavior analysis of software the user owns or is licensed to analyze: authorization recorded first, observations converted into clean specifications and original code. Never copies proprietary code or bypasses protections."
version: 0.1.0
license: MIT
capabilities: [rea, authorization-gate, clean-room-spec]
requirements: ["explicit written authorization recorded in the run evidence"]
cost: free
---

# Reverse engineering (REA) skill — authorization first

1. Record target identity, authorization basis, scope and evidence retention BEFORE any tooling.
2. Refuse: credential bypass, DRM circumvention, piracy, hidden-data extraction, secrets theft.
3. Use bounded, authorized operations; record observed vs inferred.
4. Convert observations into clean specifications; implement originally. No proprietary code or assets in deliverables.
Without recorded authorization the router treats this capability as blocked.