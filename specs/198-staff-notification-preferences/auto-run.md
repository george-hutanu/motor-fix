# Auto run — 198-staff-notification-preferences

Description: ST-198 "Choose which messages I get as a garage, mechanic or admin" (Notion https://app.notion.com/p/3ee607bff0d28165bbebde1ebfad3a78).
Start: origin/main bdd5b87, worktree .worktrees/198-staff-notification-preferences, branch 198-staff-notification-preferences. Draft PR #155.

## Preflight
- Tree clean (new worktree). Constitution v1.8.1, no placeholders. `npm run typecheck && lint && test:unit` green through heavy.sh (integration suites need Docker; run per change by the pre-commit hook and CI).

## 0. Size
- Level 2 (feature): API, web and pipeline across libs/domain, libs/contracts, apps/web.

## 1. Constitution
- Verified, not rewritten.

## 2. Specify
- Phase agent, model fable: STATUS success — 16 FRs, 5 SCs, judgement calls under Assumptions (autonomous default).
- Draft PR #155 opened by `lifecycle.mjs open`; Notion start and pr written.
