# Auto run — 470-chart-reduced-motion

- Description (user): fix Notion task ST-470 — the charts read `matchMedia('(prefers-reduced-motion: reduce)')` once per redraw instead of the shared `REDUCED_MOTION` signal; take it through the whole PR lifecycle.
- Mode: agent worktree `.claude/worktrees/agent-a01da58b9f0d31aa3`, based on `origin/main` b76ea92; its own `npm ci` (no symlink).
- Start commit: b76ea92

## 0. Size

- Level 1 (one-session): the task sets the intent fully (what changes, the tests, what must not change). Phases 2, 7, 9, 10, 12, 14, 16 plus hand-off.

## 2. Specify

- Branch `470-chart-reduced-motion` (story-numbered). Capability `cockpit-charts`.
- Autonomous answers (spec Clarifications): jump to the end on switch-on (ST-53 design States); no replay on switch-off; unit test on the component, not the page (owner instruction).

## Preflight

- The first commit's `.husky/pre-commit` (typecheck + lint + test across every project) was green: 11/11 test targets. Constitution read: it has a version and no placeholders.

## 7. Tasks

- 4 tasks (2 test, 1 implementation, 1 proof). `artifact-lint --check`: 0 errors once the Spec Delta used plain ids.

## 9. Tests (red first)

- `npx jest libs/ui-cockpit/src/lib/chart.spec.ts`: `Tests: 3 failed, 12 passed, 15 total`. The new tests failed for the expected reasons: the animation kept running after the switch, and the chart queried `prefers-reduced-motion` itself.
- `BASE_URL=http://localhost:4471 npx playwright test charts.spec.ts`: `1 failed, 9 passed`. The new test failed at the "pixels hold after the switch" check.

## 10. Implement

- `chart.ts`: the effect reads `REDUCED_MOTION` and calls `chart.stop()` before `update('none')` when it is on. Unit: `Test Suites: 6 passed`, `Tests: 115 passed` (chart*, charts-sample, reduced-motion and motion specs). e2e: charts + motion `18 passed`; the new test with `--repeat-each=8`: `8 passed`.

## 12/14. Harden and review

- diff-audit --no-jev: local `main` is stale (18c9e3d), so it diffs other merged work too; for this change only `import-extension` on `./reduced-motion` — known false positive (moduleResolution bundler; 016/017/019 runs). artifact-lint: 0 errors; Jev lane unavailable (no key).
- No test-adversary (one-file change, level 1) and no local mutation run (owner rule: no local mutation tests).
- spec-reviewer: APPROVE, 1 LOW (tick the closed 053 deferred line) → patched.
- code-reviewer: APPROVE, 2 LOW: comment on why stop() precedes update('none') → patched; e2e mid-growth timing → accepted (coordinator option a), deferred and filed as Notion task.
