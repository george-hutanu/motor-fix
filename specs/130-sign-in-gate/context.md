# Feature Context: Be asked to sign in when an action needs an account

- **Feature**: 130-sign-in-gate
- **Anchor**: ST-130 Be asked to sign in when an action needs an account — https://app.notion.com/p/3ee607bff0d281faa438efc7098315c1 | terms: sign-in gate, sign_in_required, deny by default, public list
- **Gathered**: 2026-10-04
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok | epic ok | architecture ok (Security, Sequence diagrams: hot paths; Backend architecture skipped, too big) | decisions not read (Decisions and ideas page skipped; no SQL today)
- **Overall confidence**: medium (sibling stories ST-157/159/80/394 and the maintenance and sign-out stories were not opened)

## Story

- **ST-130 Be asked to sign in when an action needs an account** — status Planning, priority High, role Visitor, epic EP-1 Foundations, feature MF-6, 3 points, PR #64
- Scope per the story: the shared gate. Visitors browse freely; an action that needs an account opens the sign-in dialog over the screen and, after sign-in or sign-up, resumes with what was typed; the API refuses those actions without a session. Build brief (2026-10-03) wins over the criteria above it.
- Comments that moved scope: none (0 comments on the story and on the feature page).
- Story page last edited 2026-10-04T19:34Z, later than the 2026-10-03 brief date the spec cites; the spec's "read 2026-10-04" may predate that edit. Re-read before `/speckit-clarify` if in doubt.

## Decisions

- API guard denies by default: every route needs a token unless on the public list — [ST-130, Build brief › Rules] (2026-10-04, confidence: high; the list itself is marked *(proposed)*)
- 401 `sign_in_required` from any call opens the gate; the interceptor first tries one token refresh — [ST-130, Build brief › States and errors] (2026-10-04, high)
- Gate reuses the "Autentificare" dialog; the title stays, a short line says why — [ST-130, Build brief › Rules] (2026-10-04, high)
- A refused call after the one refresh is repeated; the Angular interceptor renews once on 401 and repeats the request — [ST-82, Rules and validation] (2026-10-04, high)
- Two tabs refreshing at once get the same answer for a few seconds, not a theft verdict — [Sequence diagrams: hot paths §3, Can go wrong] (2026-10-03, medium; bears on the interceptor's single-flight renewal)
- Role/ownership check is in the use case; another person's resource is 404, a staff member out of scope is 403 — [Security, Measures] (2026-10-03, high; matches FR-003)
- Driver-only actions for a non-driver account answer 404; the `driver` role is added in ST-394 — [ST-130 scenario 7; MF-6 Final rules 19] (2026-10-04, high)
- Free without an account: search, Home, results, profiles, prices, reviews, mechanic pages, share link, the listing form. Needs an account: quote request, one-off message, save a garage, review — [ST-130, Build brief › Who can do it] (2026-10-04, high)
  - superseded: ST-130 acceptance criterion 2 "account required to … list a garage" by the 2026-10-03 listing-form note (same page)

## Constraints

- Refresh token is an httpOnly cookie sent only to `POST /api/v1/auth/refresh`; every other call uses the access token in a header; access token 15 min, memory only — [Security, Measures › Stolen sign-in, Forged requests; ST-82] (2026-10-03, high). Renewal needs no access token, which supports its place on the public list.
- Sign-in is rate limited (429 `too_many_attempts`); error codes `invalid_credentials`, `account_suspended`, `maintenance` exist — [ST-82, States and errors] (2026-10-04, medium). None may open the gate.
- Maintenance mode blocks writes for non-admins through an API guard (its own story) — [Put the site in maintenance mode, search highlight only] (2026-10-03, low). Guard ordering against the sign-in guard is not stated.
- Tests the brief names: guard denies by default; public list exact; 401 for each gated endpoint; pending action expires after 30 minutes; e2e = a visitor starts a quote request, signs up in the dialog, is back on the filled request — [ST-130, Tests] (2026-10-04, high)
- The return to the interrupted action "is not designed" in the mock — [ST-130, Screens] (2026-10-04, high)
- Routes the brief adds to the public list that the spec's six do not carry: public reads (search, garage profile), listing draft, live public stream (`GET /api/v1/live/public`), `GET /api/v1/places` — [ST-130 Rules; Sequence diagrams §1, §2] (2026-10-04, medium)

## Prior Art

- ST-82 Sign in with e-mail and password — Done (PR #45); scenario 5 already says a dialog opened by an action returns the person to that action, not a dashboard — [ST-82] (2026-10-04)
- ST-80 sign-up, ST-157 shared dialog, ST-159 shared form saving — blockers named by the brief; the spec reports them merged (not re-verified in Notion)
- Sign-out story (ST-84-area page, edited 2026-10-04T19:23Z) not opened; it may touch the public status of `/auth/sign-out`

## Open Decisions

- none found that block this story (brief "Open: None")

## Contradictions with spec.md

- **spec.md** (2026-10-04): "the action they asked for is carried out" / "repeated once with the new session" (FR-005) — **Notion**: "the form is back exactly as they left it and is sent with one more tap *(proposed)*"; "never sent before the person taps the main button again *(proposed)*" [ST-130, Build brief scenario 1 and Rules] (2026-10-04) — newer: same date. The spec records this as an autonomous default. The sequence diagram (§3 step "the action the user started continues") and brief scenario 6 ("the action resumes after sign-in") support auto-repeat.
- **spec.md**: reason line "Intră în cont ca să continui." — **Notion**: "Intră în cont ca să trimiți cererea." *(proposed)* [ST-130, Rules] — newer: same date. Spec deliberately generic; flagged for owner.
- **spec.md**: pending action kept in memory only; no 30-minute expiry — **Notion**: session storage, 30 minutes *(proposed)*; and a Jest test "the pending action expires after 30 minutes" [ST-130, Rules and Tests] — newer: same date. The brief's own fallback (storage blocked: memory) is what the spec makes the rule.
- **spec.md** FR-002: public list is exactly six routes — **Notion**: list is "auth, public reads, listing draft, live public stream" *(proposed)*. Those routes do not exist yet, so no conflict today, but the "exact" test will fail the moment a story adds one unless it updates the list (spec already says each story marks its route public).
- **spec.md** e2e uses `PATCH /api/v1/me` — **Notion** e2e is a quote request in the dialog. Quote request is out of scope; no conflict in scope, a deviation to record.

## Proposed Clarifications (this command's proposals, not requirements)

- Does the owner accept auto-repeat after sign-in instead of "one more tap"? If not, FR-005 and SC-003 change; session expiry (story 3) still needs the repeat. — from brief scenario 1 vs FR-005
- Accept the generic reason line for this story, with a per-call override for the quote request story? — from the reason-line contradiction
- Record the 30-minute session-storage expiry as a follow-up owned by ST-83 (Google/Apple), as the spec assumes? — from the storage contradiction
- Should the interceptor renew once for concurrent 401s (single-flight) so two tabs or two calls do not look like token reuse? — from Sequence diagrams §3
- Should 429 `too_many_attempts` and `maintenance` on the session calls be listed beside 403/404/401 `invalid_credentials` as never opening the dialog? — from ST-82 error codes

## Gaps

- [NEEDS CLARIFICATION: is `/auth/sign-out` public, and do password-reset, e-mail confirmation and phone-code routes (later stories) each mark themselves public?]
- Ordering of the maintenance-mode guard and the sign-in guard is not stated in pages read.
- Backend architecture (guard and decorator conventions) was not read; the page is too big to fetch.
- Decisions and ideas page not read.

## Sources

- Be asked to sign in when an action needs an account (ST-130) — https://app.notion.com/p/3ee607bff0d281faa438efc7098315c1
- Accounts, roles and sign-in (MF-6) — https://app.notion.com/p/3ee607bff0d28194880afef05a6b30fc
- Foundations (EP-1) — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
- Security, performance and operations — https://app.notion.com/p/3ee607bff0d2810d852efa0a9346afd3
- Sequence diagrams: hot paths — https://app.notion.com/p/3ee607bff0d281228f49e21c9276591d
- Sign in with e-mail and password (ST-82) — https://app.notion.com/p/3ee607bff0d2810e8ab4ed9099e3e908
- Design mock (recorded, not opened) — https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr
