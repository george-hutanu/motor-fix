# Deferred: 440-pr-title-edited

- LOW (code-reviewer): two Conventional Commit rules disagree. `scripts/pr-body-check.ts` (`TITLE`, any lower-case type, scope required) and `.github/workflows/pr-title.yml` (fixed type list, scope optional), so `feat: x` passes one and fails the other. Pre-existing; this change deliberately kept today's workflow pattern. Pick one rule and have the other caller use it.
