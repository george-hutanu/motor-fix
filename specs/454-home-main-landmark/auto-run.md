# speckit-auto run log — 454-home-main-landmark

**Description**: ST-454 — the public home page `/` fails axe `landmark-one-main` and `region`; give it a proper main landmark so every piece of content sits inside a landmark. ST-458 is the same finding.
**Start commit**: a55fa6e03f4ab3c2720249baa7466f3d5a2e6e5b (origin/main)
**Branch**: 454-home-main-landmark (worktree `.worktrees/454-home-main-landmark`)

## Preflight

- Tree clean; identity check green (george-hutanu).
- `sh scripts/heavy.sh sh -c 'npm run typecheck && npm run lint && npm run test'` exit 0.
- Task choice: ST-444 (lower ST number, same priority) skipped — already done on origin/main by 8309e45; ST-454 next.

## 0. Size

- Level 1 (one-session): intent clear — one main landmark, all content in landmarks, no visual change. Phases 2, 7, 9, 10, 12, 14, 16.

## 2. Specify

- spec.md written; checklist all pass.
- (autonomous default) `/` renders Home inside the public frame instead of Home carrying its own `<main>`: the frame already owns the one `<main>` (Principle I).
- (autonomous default) frame top bar becomes `<header>`; no visual change.
- (autonomous default) Spec Delta capability `phone-layout` (the public frame's capability).
