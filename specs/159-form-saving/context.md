# Feature Context: Shared saving, validation and errors for small actions

- **Feature**: 159-form-saving
- **Anchor**: ST-159 Build shared saving, validation and errors for small actions — https://app.notion.com/p/3ee607bff0d28158a0bee4952af0d856 | feature MF-5, epic EP-1
- **Gathered**: 2026-10-04
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok | epic ok | architecture ok | decisions partial (Open decisions page too big to fetch; its decisions are repeated on the pages read)
- **Overall confidence**: high on the story and the A-numbers; medium on the maintenance flow (the maintenance-switch story was not read)

## Story

- **ST-159 Build shared saving, validation and errors for small actions** — status Planning, priority High, role System, labels front end, 3 points, epic EP-1 Foundations, feature MF-5, PR #44. Page last edited 2026-10-04T13:02Z.
- Scope per the story: five acceptance criteria (nothing sent before the main button; invalid field shows a message and nothing is sent; result shows where the person came from; screen behind already shows the new state; a failed save keeps the dialog open, keeps the text, shows the error next to the button). The Build brief (current as of 2026-10-03, "where this section and anything above disagree, this section wins") widens the scope to "field validation, sending, progress, server errors, success, offline, an expired session and maintenance mode", with nine scenarios, of which 6, 7 and 9 are marked *(proposed)*.
- Comments that moved scope: none. `notion-get-comments` (all blocks, resolved included) returned no discussions on the story. The feature page was fetched without a discussion marker.

## Decisions

- The story's Build brief is authoritative over the story's own acceptance list, and it puts offline (scenario 6), expired session (scenario 7) and maintenance (scenario 8) inside this story. Scenario 8 (maintenance) is not marked proposed; 6 and 7 are. — [ST-159, Build brief, Scope and Acceptance scenarios] (2026-10-04, confidence: high)
- Errors are RFC 9457 problem details (`application/problem+json`) with a stable `code` the front end translates; codes are lower snake case. — [Architecture decisions, A28 and A42] (page 2026-10-04, confidence: medium; both are marked Proposed)
  - superseded by: none; it replaces the older "`{ code, message, details }`" of Backend architecture ("Revised October 3, 2026 (proposed)") and the "one shape with a code" of Front end architecture, Patterns › Errors (2026-10-03).
- Every create and accept action takes an `Idempotency-Key` header; a repeat returns the first result. — [Architecture decisions, A32] (2026-10-04, confidence: medium, Proposed)
  - Older, narrower statement: Backend architecture says only the four writes "that must not happen twice (send request, send quote, accept quote, post review)" accept a key (2026-10-03). A32 is wider and the later of the two pages.
- Forms are Angular reactive forms read through signals. — [ST-159, Rules and validation; Technology stack, Forms] (2026-10-04, confidence: high)
- A small action never changes the page address; a task opening another task stacks, Escape closes only the top one *(proposed)*. — [MF-5 Build brief, Edge cases; ST-157, scenario 6] (2026-10-03, confidence: high)
- The discard question ("Renunți la modificări?") belongs to ST-157's overlay service and is Done. — [ST-157, scenario 5] (2026-10-04, confidence: high)
- Front end stack is Spartan UI, not PrimeNG. — [Architecture decisions, A1 amended 2026-10-04] (confidence: high)
  - superseded: "PrimeNG Dialog/Drawer" on the MF-5 page ("For the build team", 2026-10-03) and in ST-157's Rules (page edited 2026-10-04T12:55Z but still wording PrimeNG).

## Constraints

- Sign-in and sign-up are the first users; this helper lives in `libs/overlays`, front end only, no server writes, no audit entry, no events. — [ST-159 Build brief, Scope, Data, Events] (2026-10-04, confidence: high)
- The API's error codes already named by neighbours, which the code-to-message map must be able to hold: `invalid_credentials`, `too_many_attempts`, `account_suspended`, `maintenance` (ST-82, "Error codes *(proposed)*"); `sign_in_required` (ST-130, 401); `job_locked` 423, 409, 404 and 410 (ST-255 scenario 7; A34, A42). — [ST-82; ST-130; ST-255; A34, A42] (2026-10-03, confidence: medium)
- 401 `sign_in_required` is handled by the Angular interceptor, which tries one token refresh and then opens the sign-in gate; the pending action (name, form values, return address) is kept in session storage for 30 minutes *(proposed)* and "never sent before the person taps the main button again". — [ST-130, Build brief, Rules and States] (2026-10-03, confidence: medium)
- Maintenance: a write refused with code `maintenance` shows the downtime message and keeps the text; the admin sign-in stays open and every other role's sign-in is refused with the downtime message. The message text and the "too many attempts" text are "not designed". — [ST-159 scenario 8; ST-82 scenario 9 and Screens] (2026-10-03, confidence: medium)
- A form only waits offline if it is a small workshop action (tick a step, change a stage, change the estimated finish), queued by ST-255 with its own `Idempotency-Key`; anything about money, bookings, quotes or reviews "needs a connection" and shows "Ai nevoie de conexiune pentru asta" (proposed). So the shared form helper must not queue. — [ST-255, Rules and scenario 8] (2026-10-03, confidence: medium)
- Touch targets at least 44 px, smallest text 12 px on a phone, Romanian and English texts, motion follows reduced motion. — [MF-5 Build brief, rule 10] (2026-10-03, confidence: high)
- Text keys are per area, loaded with the area (i18n lib, RO and EN files). — [Front end architecture, Patterns › Two languages] (2026-10-03, confidence: high)

## Prior Art

- ST-157 shared dialog and right-hand drawer — Done, PR #40; supplies the overlay service, the typed task result, the discard question and stacking. — [ST-157] (2026-10-04)
- ST-82 sign-in, ST-130 sign-in gate, ST-253 SSE connection, ST-255 catch-up after a lost connection — all To do. ST-130 "Depends on" ST-159 and the epic's slice 6 lists ST-130 as "needs ST-82, ST-80, ST-159". — [ST-82, ST-130, ST-253, ST-255, EP-1 Build plan] (2026-10-03)
- The mock shows no validation, error or offline states for any task ("not designed"); it only updates the screen behind. — [ST-159 Screens; MF-5 Where it stands] (2026-10-03)

## Open Decisions

- None numbered. ST-159's own "Open" is "None", and so is MF-5's. The unsaved-text question on the feature page's States table is answered by MF-5 rule 9 *(proposed)* and implemented in ST-157.

## Contradictions with spec.md

spec.md is dated 2026-10-04 (Created), the same day as the story's last edit (2026-10-04T13:02Z); order within the day is not determinable, so each is "same date".

- **spec.md**: "Offline and session-expired handling (Build brief scenarios 6 and 7) in this story? → No; they hook in later through ST-130 (expired session) and ST-253 (offline)" — **Notion**: scenarios 6 and 7 are in ST-159's own Build brief and Scope. The story it names for offline is wrong: ST-253 is the SSE connection and has no offline behaviour; offline lives in ST-255 (bar and queue for workshop actions, not a form message). ST-130 needs ST-159, so it cannot be built first and then hook in. [ST-159 Build brief; ST-253; ST-255; ST-130] (2026-10-04) — newer: same date
- **spec.md** Assumptions: "Offline detection and the sign-in-on-top flow for an expired session are ST-253 and ST-130" — **Notion**: ST-130 scenario 6 does claim the expired-session resume ("the same dialog opens and the action resumes after sign-in"), and ST-159 scenario 7 claims the same thing; the two pages overlap and neither says who owns the form side. [ST-130 scenario 6; ST-159 scenario 7] (2026-10-04) — newer: same date
- **spec.md** FR-008: a failure with no server answer shows "the network message" — **Notion**: the brief wants an offline message when the device is offline: "Nu ești conectat. Încearcă din nou când revine conexiunea." (ST-159 scenario 6, proposed, 2026-10-04); ST-82 proposes a different text, "Nu ești conectat la internet." (2026-10-03, older). The ST-159 text is the newer; ST-255's bar text is a third, for a different place. [ST-159; ST-82; ST-255] — newer: Notion
- **spec.md** Clarification: server field errors are `errors: [{ field, code }]` — **Notion**: nothing in A28, A42, Backend architecture or the briefs fixes an `errors` member or its shape; scenario 5 says only "field errors from the server show under their fields". The spec's shape is the spec's own default, not a Notion decision. The Notion page also says problem `code` per Backend architecture rather than a per-field code. [A28, A42; ST-159 scenario 5] (2026-10-04) — newer: n/a (gap, not conflict)
- **spec.md** Independent Test and Clarification: the e2e flow is the catalogue's sample task — **Notion**: the story's e2e is "sign up with an e-mail that is taken; the error shows next to the button and the typed name stays", and the story's scope says sign-in and sign-up use it first. Sign-up (and its "taken" code) is not built yet, so the spec's substitute is a departure from the story's Tests, not an equivalent. [ST-159 Tests] (2026-10-04) — newer: same date
- **spec.md** FR-010 message list — **Notion**: codes already named by neighbours (`invalid_credentials`, `too_many_attempts`, `account_suspended`; 423/409/404/410 refusals) are missing from the map; the spec leaves extension to later stories, which fits "each code has a message key in both languages" only if the map is open. [ST-82; ST-255; A34] (2026-10-03) — newer: Notion is older; no real conflict
- **spec.md** busy state: `aria-busy` and `aria-disabled` — **Notion**: the brief says the button "shows progress and is disabled". Narrowing only: aria-disabled keeps focus and fits the 44 px rule; a truly disabled button would drop focus. Not a contradiction. [ST-159 scenario 3] (2026-10-04)

## Proposed Clarifications (this command's proposals, not requirements)

- Should this story include the offline message and the `navigator.onLine` check (brief scenario 6), since ST-253 and ST-255 do not supply a form-level offline message? — from the first contradiction
- Who owns the expired-session resume: does ST-159 expose a hook (a typed failure result such as `sign_in_required` that a task can retry after sign-in) that ST-130 then drives, or does ST-130 own it entirely? ST-130 depends on ST-159, so the hook has to exist first. — from the second contradiction
- Which offline text wins: the ST-159 brief's (2026-10-04, newest) over ST-82's? Proposed: ST-159's. — from the third contradiction
- Confirm the `errors: [{ field, code }]` shape with the owner or record it in Architecture decisions beside A28, since it is not in Notion. A42 would make each field `code` lower snake case. — from the fourth contradiction
- Is the catalogue sample task's e2e acceptable in place of the story's "e-mail taken" sign-up flow, or should the e2e stay in ST-82/sign-up with a note? — from the fifth contradiction
- Idempotency: A32 asks every create and accept action to take the header, while Backend architecture names four writes; the front end should send the key on every submit. Confirm that sending it to endpoints that ignore it is harmless. — from the A32 finding
- Maintenance copy: no downtime message text exists in Notion ("not designed"). Propose a placeholder pair and confirm. — from the maintenance finding

## Gaps

- [NEEDS CLARIFICATION: the downtime message and the "too many attempts" message are not designed in the mock or the briefs]
- The maintenance switch story (https://app.notion.com/p/3ee607bff0d28124870dec30190dc2a7) and the "Give features one way to publish and receive live events" story were not read.
- HTTP status to code mapping for 5xx and proxy HTML answers is not specified anywhere in Notion.

## Sources

- Build shared saving, validation and errors for small actions (ST-159) — https://app.notion.com/p/3ee607bff0d28158a0bee4952af0d856
- Small actions in dialogs, drawers and sheets (MF-5) — https://app.notion.com/p/3ee607bff0d2815b88a7c6c67a7ede4d
- Foundations (EP-1) — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
- Build the shared dialog and right-hand drawer (ST-157) — https://app.notion.com/p/3ee607bff0d2811db730c1017d198dd2
- Sign in with e-mail and password (ST-82) — https://app.notion.com/p/3ee607bff0d2810e8ab4ed9099e3e908
- Be asked to sign in when an action needs an account (ST-130) — https://app.notion.com/p/3ee607bff0d281faa438efc7098315c1
- Set up the real-time connection to open dashboards (ST-253) — https://app.notion.com/p/3ee607bff0d281739e3df7b8fc484d49
- Get back in step after a lost connection (ST-255) — https://app.notion.com/p/3ee607bff0d2810ba16cdf47e382046a
- Accounts, roles and sign-in (MF-6) — https://app.notion.com/p/3ee607bff0d28194880afef05a6b30fc
- Architecture decisions (A1, A28, A32, A34, A42) — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a
- Front end architecture — https://app.notion.com/p/3ee607bff0d2811688cde6508dfcd09a
- Backend architecture (search excerpt only) — https://app.notion.com/p/3ee607bff0d281dfa162cd4b9983dd2e
