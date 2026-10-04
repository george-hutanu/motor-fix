# Tasks: The charts follow reduced motion live

**Input**: `specs/470-chart-reduced-motion/spec.md` (level 1: no plan.md)

## Phase 1: Tests first

- [X] T001 [P] [US1] Test: `libs/ui-cockpit/src/lib/chart.spec.ts` — with `REDUCED_MOTION` provided as a writable signal: a chart drawn with it off is animating and carries the animation options; turning it on stops the animation and drops the options; turning it off brings the options back; the chart never queries `prefers-reduced-motion` itself (FR-001, FR-002, FR-003)
- [X] T002 [P] [US1] Test: `apps/web-e2e/src/charts.spec.ts` — `/cockpit` loaded with reduced motion; switch it off, retry the failed chart and see it grow; switch it on mid-growth and see the pixels hold from the next frame (FR-002, FR-003, SC-001)

## Phase 2: Implementation

- [X] T003 [US1] `libs/ui-cockpit/src/lib/chart.ts`: read `REDUCED_MOTION` in the draw effect in place of `matchMedia`; stop running animations when it is on (FR-001, FR-002, FR-003)

## Phase 3: Proof

- [X] T004 Existing chart unit specs (`chart.spec.ts`, `chart.adversary.spec.ts`, `chart-config.spec.ts`, `charts-sample.spec.ts`) and `apps/web-e2e/src/charts.spec.ts` green, with no new injected style in "grows the bars in" (FR-004, SC-002)

## FR → test

| FR | Proof |
|---|---|
| FR-001 | `libs/ui-cockpit/src/lib/chart.spec.ts` (no media query from the chart; follows the provided signal) |
| FR-002 | `libs/ui-cockpit/src/lib/chart.spec.ts`; `apps/web-e2e/src/charts.spec.ts` |
| FR-003 | `libs/ui-cockpit/src/lib/chart.spec.ts`; `apps/web-e2e/src/charts.spec.ts` |
| FR-004 | the existing chart specs, unchanged and green |
