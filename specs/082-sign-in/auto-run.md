# Auto run — 082-sign-in

- Description: ST-82 Sign in with e-mail and password (Notion https://app.notion.com/p/3ee607bff0d2810e8ab4ed9099e3e908), epic EP-1 Foundations; blockers ST-79, ST-157 (a27b286), ST-16 merged.
- Start commit: a27b2865d1841f62d51fc4832f695b2d76929dfa (origin/main), worktree `agent-a91a450d91244c6f9`, branch `082-sign-in` (story number, the repo's convention). DB `motorfix_st082`, Redis db 8, local `.env` (git-ignored).

## Preflight
- Clean tree; `npm ci` in the worktree (heavy.sh); `npm run typecheck` exit 0, `npm run lint` exit 0, `npm run test -- --maxWorkers=2` → "Successfully ran target test for 11 projects". Constitution v1.6.0 read, no placeholders.

## 0. Size
- Level 2 (feature): sessions, cookies, limits and the dialog all have design choices. `level.mjs set 2`.

## 1. Constitution
- v1.6.0, Principle I first; VII drives the PR lifecycle.

## 2. Specify
- before_specify `speckit.git.feature`: skipped, the branch existed (created from origin/main by this run).
- Story, feature MF-6, Security page, ST-128 (sign-out) read in Notion. Autonomous answers (spec Assumptions):
  - Unbuilt flows' controls (Apple, Google, forgot password, create account, role switch) not shown.
  - "MotorFix" in the dialog body, not the overlay header (no subtitle option; ST-159 is in `libs/overlays`).
  - Desktop entry: a top bar in the public frame with "Autentificare" until the EP-4 header; phones use the "Cont" tab.
  - Sign-out on this device included; all devices and cross-tab stay ST-128.
  - Per-address limit 20 / 15 min; unticked sessions accepted 12 h; 20 s rotation grace; 15-minute access token kept constant.
  - argon2id via Node's `crypto.argon2` (no dependency); XFF appended by the web edge, the API trusts private hops only.
  - Seed accounts with a fake default password; staging needs `SEED_PASSWORD`; real-sign-in e2e needs `E2E_PASSWORD` on a deployed address.
- after_specify: notion-sync start (story + timeline Planning; epic unchanged); design-check wrote design.md (mock v22 read); git commit with the first slice and the draft PR; agent-context in phase 15.
