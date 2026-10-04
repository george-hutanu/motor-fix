# Data Model: Mutation testing

No stored data. One configuration file per project.

## Project mutation config — `<projectRoot>/stryker.config.json`

| Field | Required | Rule |
|---|---|---|
| `thresholds.break` | yes | number 0–100; set a few points under the first measured score (0 with no spec files); only rises (`config-protection.mjs`) |
| `thresholds.low` / `thresholds.high` | yes | 60 / 80 |
| any other Stryker option | no | overrides the shared option of the same name (e.g. `mutate`, `tsconfigFile`, `concurrency`); used only where the project differs from the conventions in research R4 |

## Mutant outcome → score

| Stryker status | In the score |
|---|---|
| Killed, Timeout | detected |
| Survived, NoCoverage | undetected |
| CompileError, RuntimeError, Ignored | excluded |

Score = detected ÷ (detected + undetected) × 100.
