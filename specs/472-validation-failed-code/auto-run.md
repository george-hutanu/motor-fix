# Auto run — 472-validation-failed-code

- size: level 1 (tests only); ST-548 folded in by the orchestrator (same gap)
- specify: 2 FRs; clarify self-answered (cases in apps/api, not the filter in domain)
- tasks: 2
- tests: 2 pass through AppModule+configureApp; with ProblemFilter commented out both fail (bootstrap.ts restored)
- review: spec APPROVE (LOW comment reworded), code BLOCK HIGH (teardown skipped turn.release on a failed boot) fixed; MEDIUM boot-block duplication deferred
- archive: Spec Delta merged into platform
