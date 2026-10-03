---
capability: <slug>
updated: <YYYY-MM-DD>
features:
---

# Capability: <one short name>

<One paragraph: what this capability is, stated in the present tense. Not what
any feature proposed — what the system does today.>

## Requirements

<Each requirement is a heading, feature-qualified because FR numbering restarts
per feature. `node .claude/scripts/capabilities.mjs merge <feature> --apply` writes
these; you rarely write one by hand.>

### NNN-FR-XXX — <the requirement, present tense>

_From <NNN-feature-slug>._

## Retired

<Tombstones. A requirement leaves this capability only through a feature's
`## Spec Delta` — `Removes` retires it, `Modifies` supersedes it — and the line
that records it is what `.claude/scripts/trace-matrix.mjs` reads so a retired
requirement is not reported as an untested one.>

- `NNN-FR-XXX` — removed by <feature> (<date>): <why>
