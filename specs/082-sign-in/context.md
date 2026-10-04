# Feature Context: Sign in with e-mail and password

- **Feature**: 082-sign-in
- **Anchor**: ST-82 Sign in with e-mail and password — https://app.notion.com/p/3ee607bff0d2810e8ab4ed9099e3e908 | terms: sign-in, refresh token, rotation, attempt limits, maintenance
- **Gathered**: 2026-10-04
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok | epic ok | architecture ok | decisions partial (Open decisions page too big to fetch; the story's Build brief, feature page and Architecture decisions repeat each decision with its date)
- **Overall confidence**: high

## Story

- **ST-82 Sign in with e-mail and password** — status Planning, priority Highest, role Visitor, epic EP-1 Foundations (release 1, Platform), feature MF-6 Accounts, roles and sign-in, 5 points, PR #45, labels front end + backend, "Ready to work" unticked.
- Scope per the story (Build brief, which wins over the criteria above it, page edited 2026-10-04T13:08Z): the sign-in dialog in sign-in mode plus the session machinery every other method reuses: `POST /api/v1/auth/sign-in`, access and refresh tokens, "Ține-mă autentificat", landing on the right dashboard, attempt limits, the maintenance-mode gate. Sign-up, Google/Apple, phone/WhatsApp, password reset, sign-out and role switch are out of scope.
- Brief details: 5 failures per e-mail in 15 minutes refuse the sixth for 15 minutes, also per IP (all *proposed* texts); refresh token 30 days renewed on use, unticked ends with the browser *(proposed)*; `invalid_credentials`, `too_many_attempts`, `account_suspended`, `maintenance` codes *(proposed)*; `last_active_at` at sign-in and at most hourly on refresh *(proposed)*; reuse of a refresh token closes its family; Open: "None".
- Comments that moved scope: none. `notion-get-comments` (all blocks, resolved included) returned no discussions. The scope moves are dated inline decisions on the page itself (2026-10-03), recorded below.

## Decisions

- One sign-in for every role (driver, garage, mechanic, receptionist, admin); each lands on `ACCOUNT.last_role`'s dashboard; an account with both roles opens the role used last — [ST-82, Notes and Acceptance criteria] (2026-10-03, confidence: high)
- At launch a mechanic lands on a limited `/app/garage`; a receptionist on `/app/garage` without settings, prices or team; admin on `/app/admin`; until the limited dashboard exists a mechanic lands on ST-79's empty garage frame *(proposed)* — [ST-82, Build brief; MF-6 Final rules 8] (2026-10-03, confidence: high)
  - superseded: ST-82 criterion "A mechanic account opens the mechanic dashboard" and MF-6 criterion "A mechanic cannot open any view of the garage dashboard" (both replaced 2026-10-03 by the limited garage dashboard; own dashboard is release 2)
- Sessions: access token 15 minutes, in memory only; refresh token httpOnly, Secure, SameSite cookie, sent only to `POST /api/v1/auth/refresh`, rotated at every use, reuse closes the family; the Angular interceptor renews once on a 401 and repeats — [ST-82 Rules; Security > Measures "Stolen sign-in"; Sequence diagrams: hot paths §3] (2026-10-03, confidence: high)
- Passwords are argon2id; e-mail trimmed and compared case-insensitively; unknown e-mail and wrong password give one 401 message — [ST-82 Rules; Hot paths §3 "401, one message for both cases"] (2026-10-03, confidence: high)
- Attempts are limited per e-mail and per address, counted in Redis (429 on too many) — [Security > Measures; Hot paths §3; ST-82 scenario 7] (2026-10-03, confidence: high)
- In maintenance mode only an account holding `admin` signs in; the admin sign-in stays open; the rule `maintenance_mode` comes with ST-261 and reads as off until then — [ST-82 Rules; ST-261 Notes (decided 2026-10-03); Security > Build and release] (2026-10-03, confidence: high)
- Errors are RFC 9457 problem details with a stable lower-snake-case `code` the front end translates (A28, A42, both Proposed); another person's resource answers 404 (A31) — [Architecture decisions] (page edited 2026-10-04T05:56Z, confidence: medium: Proposed, not Given)
- The stack is Angular + Spartan UI (A1 amended 2026-10-04); own sign-in module with rotating refresh tokens (A11); AI assistants never sign in here (identity server A23) — [Architecture decisions A1, A11, A23] (2026-10-04, confidence: high)
  - superseded: A1 "Angular with PrimeNG" (amended 2026-10-04); A11 "four roles" (superseded 2026-10-03 by five roles plus WhatsApp-code sign-in); MF-6 "switch Sunt șofer / Am un service chooses the role" (superseded 2026-10-03; the brief says the switch is not shown in sign-in mode, *proposed*)

## Constraints

- Frontend lib `auth` holds session, guards and interceptor; `overlays` holds the dialog (bottom sheet on a phone); `data-access` is the generated client; dialogs are not routes and a small action never changes the page — [Front end architecture, Structure and Routes] (2026-10-03, confidence: high)
- Route guard checks the role before an area downloads; the API checks again; dashboards live under `/app/{role}/...`, public routes carry `/ro` or `/en` — [Front end architecture, Routes] (2026-10-03, confidence: high)
- Reads ACCOUNT, ACCOUNT_IDENTITY (`password`), ACCOUNT_ROLE, GARAGE_MEMBER, MECHANIC, PLATFORM_RULE; writes REFRESH_TOKEN (new family per sign-in) and `ACCOUNT.last_active_at`; no audit entry and no events: "Sign-ins themselves are not changes" — [ST-82 Data; MF-6 Final rules 16] (2026-10-04, confidence: high)
- After sign-in the tab opens `GET /api/v1/live` (`account:{accountId}`, plus `garage:{garageId}` for garage roles); the connection itself belongs to the live-connection story — [ST-82 Events] (2026-10-04, confidence: medium)
- Failed attempts: Redis counters plus SYSTEM_LOG_ENTRY without personal data *(proposed)*; PostgreSQL is the truth and Redis "can be emptied without losing anything" — [ST-82 States; Architecture, Principles] (2026-10-04, confidence: medium)
- Tests named by the brief: Jest for credentials, limits per e-mail and per IP, rotation and family close, cookie lifetime with and without the tick, maintenance gate, landing per role, suspended refused; Playwright for a driver and a two-role garage-last account — [ST-82 Tests] (2026-10-04, confidence: high)
- Mock shows the dialog with the driver/garage switch, Apple/Google and "Creează un cont"; the "too many attempts" and maintenance messages are not designed — [ST-82 Screens; Foundations epic, Design] (2026-10-04, confidence: high)

## Prior Art

- ST-79 account model, roles, guards — merged per spec.md; ST-82 depends on it (Build brief "Depends on") — [ST-82]
- ST-157 shared dialog/drawer (`libs/overlays`) and ST-16 i18n — merged per spec.md — [ST-82; Foundations epic Slice 3]
- ST-159 shared saving, validation and errors — status Planning, PR #44, page edited 2026-10-04T13:02Z; defines offline text "Nu ești conectat. Încearcă din nou când revine conexiunea.", server field errors, double-tap guard, expired-session reopen of the sign-in task, discard question; sign-in and sign-up "use it first" — [ST-159]
- ST-128 sign-out — To do, High, depends on ST-82 "(sessions)": "Ieși din cont" ends the session on this device (revoke refresh token, drop access token, clear cookie, open Home); "Ieși de pe toate dispozitivele" revokes every family; `session_revoked` published to Redis `account:{accountId}` so other tabs sign out; idempotent — [ST-128] (2026-10-03)
- ST-80 sign-up — To do, Highest, same dialog switched to sign-up, builds the one `createAccount`; sign-up limited 10/hour per IP *(proposed)*; refused in maintenance as sign-in is — [ST-80] (2026-10-03)
- ST-130 sign-in gate — To do, High, depends on ST-82: API answers 401 `sign_in_required`, the interceptor tries one refresh first, then the dialog opens over the form and resumes the action — [ST-130] (2026-10-03)
- ST-261 maintenance mode — To do, Medium: global guard answers 503 `maintenance` with `Retry-After: 300` to non-admins, but the sign-in call stays allowed and "opens a session only for an account with the `admin` role"; admin reaches sign-in at `/admin` *(proposed route)*; existing non-admin sessions are kept — [ST-261] (2026-10-03)
- In the mock: Sign in · dialog and Mobile · Sign-in sheet work visually and lead to the right dashboard — [ST-82 Notes]

## Open Decisions

- Per-address attempt limit: Security page and brief say "limited per IP address" with no number — blocks FR-005's 20-in-15-minutes figure (spec marks it proposed).
- Where a signed-out admin signs in during maintenance: ST-82 says `/app/admin` *(proposed)*, ST-261 says `/admin` *(proposed route)*; neither route is designed — blocks FR-021/FR-006 end-to-end.
- Terms/privacy re-acceptance at next sign-in when the texts change (ST-132, lawyer, `[NEEDS CLARIFICATION]` on MF-6) — would add a step to sign-in; not answered, not in this story.
- T10 retention periods (lawyer) — touches how long REFRESH_TOKEN rows and failed-attempt logs are kept; unanswered.

## Contradictions with spec.md

- **spec.md** (2026-10-04): FR-010 / User Story 4 builds `POST /api/v1/auth/sign-out` and the "Ieși din cont" wiring — **Notion**: sign-out is ST-128's scope, and ST-82's Out of scope lists "Sign-out: ST-128" [ST-82 Out of scope; ST-128] (2026-10-03/04) — newer: spec.md (the spec records its reason: a persistent session makes the existing sign-out a lie)
- **spec.md** (2026-10-04): FR-009 "rotated less than 20 seconds earlier … MUST answer 401 `sign_in_required` without revoking anything" — **Notion**: "Two tabs refresh at the same moment: the second one is given the same answer for a few seconds instead of being treated as theft" [Sequence diagrams: hot paths §3, Can go wrong] (2026-10-03) — newer: spec.md (the Notion line says the second tab gets a usable answer; the spec makes it fail once and retry)
- **spec.md** (2026-10-04): FR-013 hides "Ai uitat parola?", "Creează un cont", Apple/Google — **Notion**: the brief's dialog texts list them and scenario 10 says "Ai uitat parola?" lets the owner set a password [ST-82 Rules, Dialog texts and scenario 10] (2026-10-04T13:08Z) — newer: same date; the brief marks those flows out of scope, so this is a deliberate omission, not a conflict of behaviour
- **spec.md** (2026-10-04): FR-021 "a signed-out visit to /app/admin … ends on Home with the sign-in dialog open" — **Notion**: "A signed-out admin reaches the sign-in at `/app/admin` *(proposed)*" and ST-261's `/admin` [ST-82 Rules, Maintenance; ST-261 scenario 5] (2026-10-03/04) — newer: same date; both are proposals and Home may show the maintenance page instead of the dialog while maintenance is on
- **spec.md** (2026-10-04): FR-005 "When Redis cannot be reached, sign-in MUST proceed without the limits" — **Notion**: no page says sign-in fails open; the Security page only says counting is in Redis and the sign-in diagram has no Redis-down branch [Security > Measures; Hot paths §3] (2026-10-03) — newer: spec.md
- **spec.md** (2026-10-04): FR-016 offline text "Nu ești conectat la internet." — **Notion**: ST-159 says "Nu ești conectat. Încearcă din nou când revine conexiunea." for every form [ST-159 scenario 6] (2026-10-04T13:02Z) — newer: ST-82 (13:08Z) is the later page, but ST-159 is the shared behaviour sign-in "uses first"; two texts in the space

## Proposed Clarifications (this command's proposals, not requirements)

- Confirm that sign-out on this device ships inside ST-82 and that ST-128 keeps only "all devices" and cross-tab sign-out — from the FR-010 contradiction.
- Decide the two-tab case: a second tab presenting the just-rotated token gets the same new tokens for a short window (Notion) or a single 401 and a retry (spec) — from the FR-009 contradiction.
- Confirm that failing open on the attempt limits when Redis is down is acceptable, or require a PostgreSQL fallback as ST-261 does for the maintenance flag — from FR-005.
- Pick one admin sign-in route for maintenance (`/app/admin` or `/admin`) and say what a signed-out visitor sees there while maintenance is on — from the open route decision.
- Pick one offline sentence for the sign-in dialog, or defer to ST-159's — from the offline text finding.
- Give the per-address limit a number or accept the spec's 20 in 15 minutes — from the Open Decisions.

## Gaps

- [NEEDS CLARIFICATION: texts for "too many attempts" and the maintenance refusal are not designed; the brief marks both *(proposed)* and ST-261's downtime text differs from the spec's FR-006 wording.]
- Data model page is too big to fetch, so REFRESH_TOKEN and ACCOUNT_IDENTITY column types are unconfirmed (column names come from the Build brief "Data" section).
- Open decisions page was not read in full; ST-82's brief lists none open.
- Whether `ACCOUNT.last_active_at` and the "active driver" figure (Q37) need more than the hourly rule: unanswered.

## Sources

- ST-82 Sign in with e-mail and password — https://app.notion.com/p/3ee607bff0d2810e8ab4ed9099e3e908
- Accounts, roles and sign-in (MF-6) — https://app.notion.com/p/3ee607bff0d28194880afef05a6b30fc
- Foundations (EP-1) — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
- Architecture — https://app.notion.com/p/3ee607bff0d2813d83d0c50d0addb0d6
- Architecture decisions — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a
- Security, performance and operations — https://app.notion.com/p/3ee607bff0d2810d852efa0a9346afd3
- Front end architecture — https://app.notion.com/p/3ee607bff0d2811688cde6508dfcd09a
- Sequence diagrams: hot paths — https://app.notion.com/p/3ee607bff0d281228f49e21c9276591d
- ST-128 Sign out — https://app.notion.com/p/3ee607bff0d2819d83d4c981dc0ac1e7
- ST-80 Create an account with e-mail and password — https://app.notion.com/p/3ee607bff0d2813a9bd4d4acd406ca56
- ST-130 Be asked to sign in when an action needs an account — https://app.notion.com/p/3ee607bff0d281faa438efc7098315c1
- ST-261 Put the site in maintenance mode — https://app.notion.com/p/3ee607bff0d28124870dec30190dc2a7
- ST-159 Build shared saving, validation and errors — https://app.notion.com/p/3ee607bff0d28158a0bee4952af0d856
- Design mock (recorded, not opened) — https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr
