# Deferred — 725-lifecycle-gate-feature-dir

- MEDIUM (code-reviewer) `.claude/hooks/pr-lifecycle-gate.mjs` `featureDir` — a second feature resolver beside `.claude/scripts/lib/feature.mjs` `activeFeature`: only this one has the zero-padded fallback, so `red-first-gate` and the other `activeFeature` callers still resolve branch `83-x` differently. Move the zero-pad lookup into `activeFeature` and have the hook call it with its branch.
