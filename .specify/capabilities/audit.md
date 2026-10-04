---
capability: audit
updated: 2026-10-04
features: []
---

# Capability: Audit history

The audit history (ACTIVITY_LOG): one append-only entry per change, written by every module through one writer inside the change's own transaction, with the actor, the scope ids and the key-change and internal flags.

## Requirements
