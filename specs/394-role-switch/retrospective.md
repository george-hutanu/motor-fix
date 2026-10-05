---
feature: 394-role-switch
date: 2026-10-05
verdict: accepted
---

# Retrospective: 394-role-switch

## Verdict

Accepted, against the spec's 9 functional requirements and ST-128's SC-003.
PR #70 merged as `e69f6c0` after QA lap 5 passed with no blocking finding
(`pr-review/lap5/report.md`). Lap 4 found one high: the switch minted tokens
from an access token alone, so a session survived sign-out; the switch moved to
`POST /auth/roles/switch` on the refresh cookie (T015, `auto-run.md`).

## Evidence

From `node .claude/scripts/retro-evidence.mjs specs/394-role-switch`:

- **Tasks:** 15 done, 0 open.
- **Requirements:** 9 declared, 0 retired.
- **Spec Delta:** `accounts` +9.
- **Commits:** 9, from `63c3444` to `d6cd10e` (the lap 4 fix is `1a01e1b`).
- **Deferred:** 7 findings, each filed as a Notion task (`notion-sync.md`, debt lines).

## What accumulated across the feature

- Token renewal raced the switch three times (`0ba3aa4`, `3c0852e`, `46ee4dc`)
  before the lap 4 redesign. Session renewal is the part of the web client
  most features touch, and each new caller adds a race.

## Where the implementation diverged from the spec

- The endpoint moved from `/me/roles/switch` to `/auth/roles/switch`; the spec
  moved with it (`1a01e1b`).

## Carried in

- None.

## Action items

- [x] File the deferred findings in Notion (done, `notion-sync.md`).
