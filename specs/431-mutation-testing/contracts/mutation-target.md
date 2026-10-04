# Contract: the `test:mutation` target

```
npx nx run <project>:test:mutation [--incremental]
  → node scripts/mutation.ts <projectName> <projectRoot> [--incremental]
npm run test:mutation             # every project, one at a time
npm run test:mutation:affected    # affected vs main (or --base), one at a time
```

## Output

1. First line, always: `mutation: <projectName>`.
2. No `*.spec.ts` / `*.test.ts` under the project: `<projectName>: no tests yet, mutation run skipped`; exit 0; Stryker not started.
3. Otherwise Stryker's clear-text report, then its own floor line.
4. When `GITHUB_STEP_SUMMARY` is set: one row appended, `| <projectName> | <score>% | <break> |` (score with two decimals, or `n/a`), preceded by the header `| Project | Mutation score | Floor |` when the file is empty.

## Exit code

| Case | Exit |
|---|---|
| score ≥ `thresholds.break` | 0 |
| score < `thresholds.break` | 1 (set by Stryker) |
| no spec files | 0 |
| missing `stryker.config.json`, Stryker start-up or initial test run failure | non-zero, with Stryker's or the script's error |

## Files written

- `reports/mutation/<projectName>/index.html` — HTML report.
- `reports/mutation/<projectName>/incremental.json` — only with `--incremental`.
- `.stryker-tmp/` — Stryker's sandbox, removed after a run.

All under git-ignored paths (`.gitignore`: `reports/`, `.stryker-tmp/`).
