---
feature: 766-cloud-rest-fallback
date: 2026-10-06
verdict: accepted-with-open-items
---

# Retrospective: 766-cloud-rest-fallback

## Verdict

Accepted with open items, judged against SC-001–SC-003 and US1/US2's acceptance
scenarios. Each FR has cloud cases next to its laptop twin, and they went red
before the change (auto-run.md, phases 9–10). The harness passes (1839/1839),
harness-eval is 82/82 at a pass rate of 1, and doctor shows 0 failures. SC-003
held live in this cloud session: `gh.mjs pr view` returned #160. The open items
are the two deferred findings. The PR-QA run is also still outstanding: it
cannot start from the cloud and is out of scope by the owner's instruction.

## Evidence

- Commits: 4 on the branch (`e236266`, `7f5112f`, `32e2435` and the harden commit).
- Diff: 21 files, +1295 −32 before harden.
- Tasks: 11 of 11.
- Spec Delta: platform +5 ~0 −0, which merges cleanly.
- Deferred: 2 open, both filed in Notion.
- Carryover: 10 items, none of them in this feature's scope.

## What accumulated across the feature

- The REST layer reproduces gh's shapes one field at a time
  (`.claude/scripts/lib/gh-rest.mjs` FIELDS). Each new `--json` field a caller
  asks for needs an entry there; an unknown field prints `null`. Today's callers
  are covered (`gh-rest.spec.mjs`), but the map grows with each caller.
- Two real cloud-setup runs found defects that the stubbed spec could not:
  - the Node search order picked `/usr/bin`;
  - Docker Hub returned 429 (auto-run.md, phase 11).

## Where the implementation diverged from the spec

- None in behaviour.
- plan.md now says the marked PATH line goes first in `~/.bashrc`. That is
  because the cloud `.bashrc` returns early for non-interactive shells
  (`[ -z "$PS1" ] && return`).

## Carried in

- ST-749's deferred items, resolved here (their Notion tasks remain To do):
  - "cloud-setup.sh unverified": now run on a real VM.
  - "handoff --restore reads only 100 comments": comments are now read across
    every page in the cloud path.

## Action items

- [ ] Close ST-749's two resolved debt tasks in Notion after this merges (unassigned)
