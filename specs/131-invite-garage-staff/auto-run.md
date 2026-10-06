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

## 5. Plan
- Phase agent (fable): STATUS success; plan.md, research.md, data-model.md, contracts/staff-invites.md, quickstart.md; CLAUDE.local.md plan pointer.
- Decisions: new GaragesModule; StaffInvite table; e-mail sent in-request through Brevo + render (invitee may have no account); `expired` derived; no `on_profile` column (row existence = on profile).

## 6. Checklist
- Phase agent (sonnet): STATUS success; checklists/invite.md, 29 items, 0 unchecked.

## 7. Tasks
- Phase agent (sonnet): STATUS success; tasks.md T001–T022.

## 8. Analyze (inline)
- artifact-lint --check: 0 errors, 0 warnings.
- F1 HIGH (fixed): spec.md US2 #2/#6, FR-007, Key Entities required `on_profile true`; plan/research drop the column. Spec aligned; Clarification added (autonomous default, Principle I, research.md).
- Status codes: spec 409/404 match contract; 410 on check/accept is contract detail. No other findings. Re-lint clean.
- Ready sweep (EP-1, API, not PENDING): hold review of 73 candidates → 24 ticked, 49 held with reasons; covers the PENDING sweeps of ST-610 (#150) and ST-637 (#151).

## 9. Tests (red first)
- Written: contracts DTO spec, audience case, staff templates spec, one API integration spec (send, check/accept, resend/revoke, feature off), web specs invite-staff, frame.invite, public/invite, sign-in-dialog join, sign-up name prefill, e2e staff-invite.
- Red: web 5/5 suites failing (7 failing cases + 2 missing modules); contracts 1/1 (missing module); domain 3/3 (5 failing, missing modules).
- Decision: the invite page accepts through the generated client and then `Session.switchRole(kind)`, instead of a Session method (keeps Session's dependencies unchanged; refresh cookie path is /api/v1/auth so accept cannot renew the session itself).

## Resume (2026-10-06, after the API session limit)
- Rules delta vs origin/main: the plan pointer only. Merged origin/main (71 behind; conflict in the CLAUDE.local.md plan pointer, kept this feature's), pushed 2810cc5; npm ci for main's new web-push.
- The earlier agent's red tests and first edits kept and built on (set aside in a tagged stash across the merge, re-applied).

## 10. Implement
- API slice: GaragesModule (own Brevo client from the API's EmailConfig), GarageInvitesController + InvitesController, service finished (invite_open answers its inviteId), public check route listed, OpenAPI and client regenerated. Domain invite spec 34/34 green against the worktree's PostgreSQL/Redis.
- Test fix: the audit history is append-only and the outbox is not emptied by reset, so the spec reads only rows written since the test began (database clock).
- T003 dropped as unneeded (token looked up by hash; accept answers 204 and the web switches role). Contract doc aligned (accept 204, InviteViewDto.email).
- Web slice b101cef (invite dialog, invite link page), traces f567ff1.

## 11. Converge
- One gap: the dialog offered "Mecanic" with mechanics off → f2878f3 withdraws it once the server answers `feature_off`; a features read before the dialog is deferred (MEDIUM, deferred.md).

## 12. Harden
- code-reviewer + test-adversary passes: 0543c41 (a mechanic's permissions kept on a link to his own garage), 198a3e1 (refusals through the shared problem parser), 11824b7 + 8d7753b (refuse an invite while PUBLIC_WEB_URL is unset; resend keeps the old link). LOW/MEDIUM leftovers in deferred.md.

## Resume 2 (2026-10-06, cloud session)
- Merged origin/main (43 behind; CLAUDE.local.md plan pointer conflict, kept this feature's) → 16ff6bc; pre-commit typecheck + test (11 projects, integration specs on the worktree's services) and lint green.
- Cloud setup: Node 24 installed but /opt/node22 shadowed it on PATH; ran with /usr/bin first.

## 13. Ticket refresh
- Refresh 2026-10-06 in context.md; re-checked the story's comments through the connector: none. No new evidence.

## 14. Review
- spec-reviewer + code-reviewer: no CRITICAL/HIGH surviving. Re-review of 11824b7^..8d7753b (code-reviewer): APPROVE, 1 MEDIUM + 1 LOW patch rows, both applied in ddf91ad (test unsets the web address through its own config; mail() reads it once). 5 LOW/MEDIUM deferred.

## 15. Agent context
- Plan pointer in CLAUDE.local.md already names this feature; no tracked file changed.

## 16. Retrospective evidence (unjudged)
- `retro-evidence.mjs --since 26cf0dc --jev`: 23 tasks done, 0 open; 14 FRs, 0 retired; Spec Delta garage-team +14; 5 deferred open; the range also counts main's merged commits. Jev lane unavailable (no key). `instincts.mjs triggered`: none.

## 17. Archive
- capabilities validate --check clean; merge applied: garage-team +14 ~0 -0; spec.md status Archived (2026-10-06). /speckit-retro not run (phase 16: the verdict stays the owner's).

## Final Report

```
STATUS: success — ST-131 reviewed, archived and handed off; PR #152 ready, story in QA
PR: #152 ready 9906f4a
NEXT: tail #152 after QA run local (lap 1)
FILES: specs/131-invite-garage-staff/auto-run.md, specs/131-invite-garage-staff/notion-sync.md, specs/131-invite-garage-staff/deferred.md, .specify/capabilities/garage-team.md
```

- Branch 131-invite-garage-staff, feature dir specs/131-invite-garage-staff, range 26cf0dc..9906f4a.
- Phases 1–17 run in order (sections 1–17 above); /speckit-retro left to the owner.
- Autonomous decisions: no design boards, so the Build brief's minimal dialog was used; a pending move has no time limit; T003's exports were not needed (tasks.md:15).
- Verification: the pre-commit typecheck + test (integration specs on the worktree's services) and lint passed on every commit. CI on 9906f4a: Biome, Typecheck, Build, Harness, Contract check, Dependency audit, Docker build and Compose stack passed; Unit, Integration and E2E were still running at the hand-off.
- FR → test: FR-001..005, 010 → staff-invite.api.integration.spec.ts plus staff-invite.dto.spec.ts; FR-006..009 → staff-invite.api.integration.spec.ts plus web-e2e staff-invite.spec.ts; FR-011 → invite-staff.spec.ts, frame.invite.spec.ts; FR-012 → invite.spec.ts, sign-in-dialog.spec.ts; FR-013 → staff.spec.ts plus the web specs; FR-014 → public-routes.integration.spec.ts plus the openapi drift check.
- Review: no CRITICAL/HIGH open; the last MEDIUM + LOW were fixed in ddf91ad; 5 LOW/MEDIUM deferred, each filed as a Notion To do task (deferred.md).
- Retro evidence (unjudged): section 16. Jev lane unavailable (no key).
- QA: dispatching pr-qa.yml from the cloud session was refused (403 Resource not accessible by integration), so lap 1 runs locally through run.mjs --tree with the compose services.
