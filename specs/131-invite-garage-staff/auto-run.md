# Auto run — ST-131 Invite a mechanic or receptionist to the garage

- Description: ST-131 "Invite a mechanic or receptionist to an account in my garage" — Notion https://app.notion.com/p/3ee607bff0d281f3aa26ca1f287f6138 (feature description taken from the story and its Build brief)
- Start: main 26cf0dc, worktree .worktrees/131-invite-garage-staff, branch 131-invite-garage-staff
- Holder check: no branch, worktree or watch item for ST-131 before start
- Preflight: npm ci, typecheck + lint + test green (11 projects); rules delta vs origin/main empty

## 0. Size
- Level 2 (feature): new data, a new surface, identity and roles (level.mjs set 2).

## 1. Constitution
- v1.8.1 card read; Principle I first.

## 2. Specify
- Phase agent (fable): STATUS success; spec.md, checklists/requirements.md, .specify/capabilities/garage-team.md.
- Autonomous defaults (evidence in spec Assumptions): e-mail only (phone/WhatsApp deferred: notifications go to accounts only, no phone sign-up); pending move deferred (no BOOKING model, so a move completes at once); no mechanic_id on the invite (Mechanic.accountId is required); Team page out of scope; land on ST-79's garage frame.
- Clarification (autonomous default): the Build brief's [NEEDS CLARIFICATION] "how long does a pending move wait" — no time limit, as the brief proposes; applies when the pending move is built.
- Lifecycle open: draft PR #152, Notion start + pr through the connector (no NOTION_TOKEN), Ready to work unticked on ST-131.
- Design check: no boards; design.md records the Build brief's proposed minimal dialog and acceptance screen.

## 3. Org context
- org-researcher (background): STATUS failure — its Notion tool ids belong to another session; logged UNAVAILABLE. Read the story and feature page MF-6 in the run's own session instead and wrote a lean context.md (decisions, constraints, one contradiction: resend as revoke+new vs new token on the same row → same row, old token void).

## 4. Clarify (inline, spec-challenger first: 7 findings)
- Q1 expired written? → derived from expiry, resend allowed for an expired `sent` invite, not blocking a new one (challenger recommendation).
- Q2 send sync? → within the request; `emailSent`, link returned only on failure; SC-001 "sent".
- Q3 accept switches role? → yes, new access token like the role switch.
- Q4 auto-accept after sign-in? → only after sign-up from the link; explicit "Acceptă" after sign-in.
- Q5 already-in-team 409 → same kind only; owner's own e-mail refused at send.
- Q6 invite_expired kept; SC-003 narrowed to unknown/malformed ≡ revoked/used.
- Q7 open answers feature_off too.
- Plus the Build brief's [NEEDS CLARIFICATION] (pending move wait): no time limit, autonomous default (phase 2).
