# Deferred — 454-home-main-landmark

- `apps/web-e2e/src/landmarks.spec.ts:6` — **medium** — the axe loader (read `axe-core/axe.min.js`, inject, `axe.run`) is now copied in four e2e specs (`landmarks.spec.ts`, `motion.spec.ts:16`, `overlays.spec.ts:34`, `sign-up.spec.ts:14`); extract one shared `apps/web-e2e/src/axe.ts` helper and use it from all four (code-reviewer, 2026-10-05)
