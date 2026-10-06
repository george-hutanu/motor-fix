# Auto run — 393-whatsapp-phone-sign-in

**Description**: ST-393 Sign in with a phone number and a code sent by WhatsApp (https://app.notion.com/p/3ee607bff0d28192afb9c5c7f7195b8c), EP-1 Foundations.
**Start commit**: 742405a (origin/main) · branch `393-whatsapp-phone-sign-in` · PR #153 (draft, `planning`, `feature`, `scope: auth`)

## 0. Size
- Level 2 (feature): 8 points, API routes, a table, a dialog step, a WhatsApp template, Jest and Playwright.

## 1. Constitution
- Constitution v1.8.1 verified (version present, no placeholders); the card's principles carried into the spec: I (no extra identity row on sign-in, no NOTIFICATION record for a code), VI (the code in PostgreSQL, Redis counts only).

## Preflight
- Green (reported by the orchestrator before this phase).

## 2. Specify
- Phase agent: model fable. `speckit-specify` run with the story; the `before_specify` git hook was skipped because the branch `393-whatsapp-phone-sign-in` already existed: the directory was created by hand and `level.mjs point specs/393-whatsapp-phone-sign-in` set `feature.json` (level 2).
- Story and its Foundations timeline row read directly from Notion (row: lane C · Auth, W6, 8 points, "Needs the approved WhatsApp code template"). Build brief wins over the criteria above it.
- Clarification table answered autonomously; every answer is an Assumption `(autonomous default)` in `spec.md`. The two departures from the brief, with evidence:
  - SIGN_IN_CODE in PostgreSQL, not Redis: Constitution VI; the repo's comparable secrets (`AccountToken` for e-mail confirmation and password reset) are hashed PostgreSQL rows with expiry and used time, and `Attempts` keeps only fail-open counts in Redis. The resend, hourly and per-address limits stay in Redis as counts.
  - The code is sent from the request through the shared Brevo WhatsApp sender, not through the notifications queue: a NOTIFICATION row needs an account (a new number has none) and the brief's immediate `whatsapp_failed` answer needs the send's result.
  - Other defaults: per-address limit 20 an hour (mirrors 082-FR-005); same 202 for known and unknown numbers; `200 { "next": "profile" }` with the code left live for the new-number profile step; status codes by repo convention (401 `code_invalid`, 410 `code_expired`, 429, 502 `whatsapp_failed`, 503, 409 `phone_taken`); "Continuă cu telefonul" is the only button under "sau" until Google and Apple exist.
- Spec Delta: `accounts` adds 15 FRs and modifies 080-FR-009 → FR-012 (082-FR-013 is already retired); `notifications` adds FR-002 (the SIGN_IN_CODE text). `artifact-lint --check`: only the expected plan/tasks-missing warnings.
- `level.mjs check`: level 2, unchanged (fr-count tripped at 17; clarification, contract, projects clear).
- Lifecycle `open`: empty start commit 3da6ae7 pushed, draft PR #153 opened from the template with labels `planning`, `feature`, `scope: auth`. Notion through the connector (no NOTION_TOKEN): story To do → Planning, PR link written, Ready to work unticked; timeline row Not started → Planning; epic EP-1 In progress (unchanged). The epic-wide `notion-ready` refresh was not run and is logged PENDING in `notion-sync.md` for the next sync.
- Not run here: the `after_specify` design check (`design.md`); the plan's `before_plan` hook runs it (the phone option is not designed; the brief's Screens section is the source).
