---
feature: <NNN-slug>
date: <YYYY-MM-DD>
verdict: <accepted | accepted-with-open-items | rejected>
---

# Retrospective: <feature>

## Verdict

<One paragraph. What was accepted, and against what. A verdict with no stated
criterion is an opinion.>

## Evidence

<`node .claude/scripts/retro-evidence.mjs <feature>` — commits, diff, tasks,
requirements, the Spec Delta, deferred findings, carryover. Paste the counts,
not the whole dump.>

## What accumulated across the feature

<Patterns no single story review could see: an abstraction that grew a caller at
a time, a convention that drifted, a test that got weaker with each edit. Every
finding carries a source — `path:line`, a commit hash, a log line. A finding
with no source is a recollection.>

## Where the implementation diverged from the spec

<Requirements delivered differently than written, and whether the spec or the
code is now wrong. This is the input to a `## Spec Delta` correction before
`/speckit-archive`.>

## Carried in

<Open items from earlier retrospectives that this feature was expected to
address. Say whether each was addressed.>

## Action items

<Open checkboxes are carried into the NEXT feature's retrospective by
`.claude/scripts/retro-evidence.mjs`. Leave one open only if it is genuinely still
owed.>

- [ ] <action> (<owner or "unassigned">)
