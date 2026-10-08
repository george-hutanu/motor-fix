# Bug Assessment: PR QA blocks PRs on main's layout debt the baseline never measured

- **Slug**: 985-qa-layout-preexisting
- **Created**: 2026-10-08
- **Source**: pasted text (Chief); Notion ST-985 https://app.notion.com/p/3f3607bff0d281d88016d83c8f039adc
- **Verdict**: valid
- **Severity**: high

## Report (summarized)

Since ST-953, PR QA reports main's existing layout debt as new and blocking. PR #287's QA
run 37828523124 (lap 5, head ab8f208, base ced0328) reported 87 HIGH blocking findings, all of
kind `layout`, on screens #287 did not change. Its visual diff compared against run
37825345218 of b9f535e (PR #283 = ST-953, lap 7). FR-011 of specs/953-ui-review-checks: a PR
is never blocked by a defect main already had.

## Symptom

A layout finding on a screen the PR did not change is reported high and blocks the merge,
because the baseline run is silent about it. Expected: capped at medium (pre-existing)
whenever the baseline cannot vouch that main was clean there.

## Reproduction

Reproduced from the two artifacts (`gh run download 37828523124 -n pr-qa-287`,
`gh run download 37825345218 -n pr-qa-283`):

1. Baseline report: `layout: true`, routes `/`, `/cockpit`, `/ro/list-your-garage`, 48
   route x size x scheme x language combinations; its observations carry only the rules
   `grid`, `min-text`, `tap-target` (49 layout findings, none `type-scale` or `clipped`).
2. #287's report: 4 routes, 64 combinations, rules `type-scale`, `clipped`, `grid`,
   `min-text`, `tap-target`. 87 high: `type-scale` 17 (e.g. `mf-home > header > h1`
   "MotorFix" 30px, expected one of 12/13/15/16px), `clipped` 2, `min-text` 68 on `/`,
   `/cockpit`, `/ro/list-your-garage`.
3. `git merge-base --is-ancestor b9f535e ced0328` fails: the baseline commit is not in
   #287's history. `git log b9f535e..ced0328 -- apps/web` lists ST-229 and ST-90 web commits;
   main also gained ST-260 (`70be610d`, "screens read only defined Cockpit tokens and type
   sizes") after the baseline.

## Suspected Code Paths

- `.claude/scripts/pr-test/findings.mjs:192-197` `markPreExisting`:
  ```js
  const before = new Set(baseline.filter((f) => f.kind === "layout").map(layoutKey));
  const unswept = (route) => Array.isArray(routes) && !routes.includes(route);
  return findings.map((f) =>
    f.kind === "layout" && (!measured || unswept(f.route) || before.has(layoutKey(f))) ? { ...f, severity: capAt(f.severity, "medium"), preExisting: true } : f,
  ```
  Silence in the baseline is read as "main was clean", whatever the baseline measured.
- `.claude/scripts/pr-test/layout.mjs:148`
  `if (scale.length && !scale.some(...)) report("type-scale", ...)`: with no `--mf-size-*`
  tokens on the page the rule is skipped, and nothing records that it was.
- `.claude/scripts/pr-test/layout.mjs:281-284`: each rule keeps `CAP` (20) observations per
  page and folds the rest into "...and N more", so a baseline over the cap lists only some of
  main's findings; the rest look new.
- `.claude/scripts/pr-test/run.mjs:357-359`: `measured` is only `before.layout === true`;
  the baseline's commit is never compared with the PR's base.
- `.claude/scripts/pr-test/baseline.mjs:113-117` `baseRuns`: a run qualifies when `compare
  ${base}...${r.sha}` is `behind`/`identical` against the branch name `main` at run time, so
  a commit on today's main but not in the PR's history (b9f535e for #287) is accepted.

## Root Cause Hypothesis

Confidence high. `markPreExisting` treats a finding as new whenever its key is absent from the
baseline, but absence only means "main was clean" when the baseline measured that rule on
that route, size, scheme and language, completely (under the cap), on the code the PR is based
on. Here the baseline measured other code (b9f535e is not in #287's history, and main's web
code changed since), never measured `type-scale` (no tokens on its pages) or found no
`clipped`, and capped `min-text`. The `routes` check covers only a route never swept, and the
`layout` flag only a tester with no layout at all.

## Proposed Remediation

**Preferred**: record what each sweep measured and only trust a baseline where it did.
1. `measureLayout` returns `rules`: the rules it measured completely on that page (always
   `min-text`, `clipped`, `overlap`, `grid`, `stretched-image`, `font-fallback`; `tap-target`
   with touch, `type-scale` when the page has a type scale, `focus-ring` on desktop), minus
   any rule that hit `CAP`.
2. `runSweep` returns `coverage`: `route|viewport|scheme|lang` -> rules; `run.mjs` writes it
   to the report as `layoutCoverage`.
3. `markPreExisting` takes `coverage` and `stale`: a layout finding is pre-existing unless
   the baseline measured its rule, completely, on its route in at least one size, scheme and
   language it was seen in, and did not report it. A baseline with no `layoutCoverage` (every
   report before this fix) covers nothing.
4. `run.mjs` marks the baseline `stale` when web code differs between the baseline's commit
   and the PR's base (`git diff --name-only <baseline sha> <base>`, `touchesWeb`), or the
   commit cannot be read; a stale baseline vouches for nothing (a note says so).
5. `baseline.mjs` `baseRuns` prefers a run whose commit is in the PR head's history too, so
   the baseline is main as the PR sees it; the old rule stays the fallback.

**Alternatives**:
- Boot main in the same run: rejected by ST-953's clarification (FR-020 time budget).
- Cap every layout finding on a route the PR's diff does not touch: no mapping from files to
  routes exists.

**Files likely to change**: `.claude/scripts/pr-test/{findings,layout,sweep,run,baseline}.mjs`
and their `*.spec.mjs`.

**Tests to add**: markPreExisting with no coverage, a combo or rule the baseline did not
measure, a stale baseline, and the #287 shape (type-scale absent from baseline coverage);
measureLayout's `rules` (type scale absent, CAP hit); baseRuns preferring a run in the head's
history.

## Risks & Considerations

- More findings capped while baselines are old: the first runs after the merge have no
  `layoutCoverage`, so layout findings cap at medium until a new baseline exists. That is
  FR-011's side (never block on main's debt); the visual diff and the reviewer still see them.
- `stale` caps all layout findings when main's web code moved since the baseline; preferring
  a baseline in the PR's history keeps that rare.
- The PR QA workflow runs the tester from main, so the fix reaches other PRs only after merge.

## Open Questions

None.
