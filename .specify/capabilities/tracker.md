---
capability: tracker
updated: 2026-10-09
features:
---

# Capability: Tracker

How tasks, epics and their stages are tracked next to the code: a user-owned GitHub Project of george-hutanu linked to the private george-hutanu/motor-fix-specs (where every issue, label and milestone lives) and to motor-fix (pull requests only), with the fields the Notion tracker had (Status, Priority, Work type, Epic, the lifecycle dates, Story points, Sprint; readiness is the query Status To do and not blocked, `status:"To do" -is:blocked`, not a field), its views, issue forms per type, labels and milestones, epics as parent issues with their stories as sub-issues, Blocked by as issue dependencies, and the one-way import that brought every Notion story and epic over whole (every property, the page body, comments and files, with no link back to Notion). The requirements arrive with ST-1017 (`1017-github-project-tracker`, slice 1) at its archive; the adapter that writes every lifecycle event there and the switch-off of the Notion writes are its later slices.

## Requirements

## Retired
