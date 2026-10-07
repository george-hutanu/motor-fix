# Feature Context: Open the admin dashboard and its menu, admins only

- **Feature**: 160-admin-dashboard-menu
- **Anchor**: ST-160 "Open the admin dashboard and its menu, admins only" — https://app.notion.com/p/3ee607bff0d281bcb229eaf763d5d51c | feature MF-43 https://app.notion.com/p/3ee607bff0d28145803ee93091505ae5 | epic EP-2 https://app.notion.com/p/3ee607bff0d281f8ba8ae20d1af741cf
- **Gathered**: 2026-10-07
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok | epic ok | architecture partial (Architecture decisions ok; the Architecture sub-pages not opened, their content came through the story briefs of ST-79 and ST-253) | decisions partial (Decisions and ideas index ok; the "Open decisions" sub-page returned 64k characters and could not be sliced without a shell, so it was not read; every brief here says "Open: None")
- **Overall confidence**: high for the story and feature; medium for open-decision coverage

## Story

- **ST-160 Open the admin dashboard and its menu, admins only** — status Planning, priority Highest, 3 points, role Admin, epic EP-2 (Garage onboarding and verification, In progress), labels front end / backend / real-time, PR #196 linked. Page last edited 2026-10-07T08:53Z (after the Build brief's "current as of 2026-10-03"; the visible change is the sync fields Status and PR).
- Scope per the story (Build brief wins over the criteria above it): the admin shell for admin accounts only: route guard, API guard for `admin/*`, layout, header, menu counters, live updates on the `admin` channel, desktop and phone. Views whose features are not built stay hidden behind release flags *(proposed)*. Counters equal items waiting for an admin and update live. "Open: None."
- Comments that moved scope: none. `notion-get-comments` (all blocks, resolved included) returned no discussions on the story.

## Decisions

- Header label is "ADMINISTRATOR", not "ADMIN" — [ST-160, Build brief scenario 4 and feature MF-43 Final rules 4] (2026-10-03, high)
  - superseded: "label ADMIN" in ST-160 acceptance criteria and in MF-43 "The overview" step 1 (same page, older text; the brief states it wins).
- One admin role at launch; every admin has the same rights; admin roles with different rights are out of release 1 (ST-165, X21) — [MF-43 Open, Where it stands; Architecture decisions A39] (2026-10-03, high)
- Admin access is given by MotorFix only; no public endpoint adds a role; `admin` is added by a protected command-line script the build team runs *(proposed)* — [ST-79 Build brief, Who can do it; ST-160 Build brief] (2026-10-04 / 2026-10-03, medium: the mechanism is marked proposed)
- Live updates by server-sent events (A8); `admin` stream joins `admin`, `account:{id}`, `system`; the screen re-reads through the normal API — [Architecture decisions A8; ST-253 scenarios 1-2] (2026-10-04, high)
- A resource of another role's area answers 404, not 403 (A31), and the route guard sends a driver typing `/app/admin` to `/app/driver` before that area downloads — [Architecture decisions A31; ST-79 scenario 5] (2026-10-04, high)
- Errors are RFC 9457 problem details with a lower-snake `code` (A28, A42); suspended account: `account_suspended` (ST-79 scenario 9, proposed) — [Architecture decisions; ST-79] (2026-10-04, high)
- Maintenance mode: the admin sign-in page and dashboard stay open — [EP-2 Risks, decided 2026-10-03; ST-160 scenario 7] (2026-10-03, high)
- Counter "waiting" = verification file status `submitted` or `in_review`; `more_requested` is not counted *(proposed)* — [ST-160 Data; ST-301 Rules] (2026-10-03, high)

## Constraints

- Reads only: ACCOUNT_ROLE, count of VERIFICATION_FILE (`submitted`/`in_review`), REVIEW_REPORT count only once released; writes none; opening the dashboard is not logged — [ST-160 Build brief, Data] (2026-10-03, high)
- Events consumed: `verification.submitted`, `verification.decided`, `verification.reopened`, `review.reported`, `review.decided`; the feature emits none; notifies nobody — [ST-160, Events and notifications] (2026-10-03, high)
- On live-connection loss the counters re-read on reconnect (ST-255 owns the reconnect rules) — [ST-160 States; ST-253 Out of scope] (2026-10-03, high)
- Counter query failure: counter hidden, never 0 *(proposed)*; loading: skeleton — [ST-160 States and errors; MF-43 States] (2026-10-03, high)
- The reports counter shows only once MF-45 is released *(proposed)* — [ST-160 Rules] (2026-10-03, high)
- City in the header is București by default; the choice story makes it selectable — [ST-160 Rules; MF-43 Final rules 8] (2026-10-03, high)
- Text Romanian and English following the language switch (MF-1); smallest text on a phone 12 px [24]; bottom tab bar on a phone (ST-288) — [ST-160 Rules and Depends on] (2026-10-03, high)
- Route proposed: `GET /api/v1/admin/overview`; 404 for every `admin/*` call by driver, garage owner, receptionist, mechanic (Jest: one test per role) — [ST-160 scenario 2, Tests] (2026-10-03, medium: marked proposed)
- Customising the dashboard's panels is ST-15; the menu items' views are other features (MF-44, 45, 46, 47, 48, 49, 50) — [ST-160 Out of scope] (2026-10-03, high)
- ST-164 (audit) will add a guard test over every `admin/*` endpoint that changes data and depends on this story's `admin/*` surface — [ST-164 Build brief, Depends on] (2026-10-03, high)

## Prior Art

- ST-79 accounts, roles and rights — Done (PR #3): roles `driver`, `garage`, `receptionist`, `mechanic`, `admin`; one policy; role keys and route guards; each role lands on its own empty frame — [ST-79] (2026-10-04)
- ST-253 live connection — Done (PR #57): `GET /api/v1/live`; the admin joins `admin`; `POST /api/v1/admin/live/test` is an existing admin-only route (404 for non-admins), so it falls under FR-002's "every admin/* route" test — [ST-253] (2026-10-04)
- ST-207 garage approval flow / verification file: built in the repo (the spec cites it); not re-read in Notion.
- ST-301 queue of garages waiting for verification — To do, depends on ST-160 for shell, menu and header; it takes over the "Service-uri" view, the four counts from one query, and the admin alert; it also consumes `verification.opened` and `verification.check_recorded` — [ST-301] (2026-10-03)
- ST-164 audit of admin actions — To do (Task) — [ST-164] (2026-10-03)
- Mock: DashAdmin / MDashAdmin show all seven views with sample numbers ("4"); the mock is not opened (design check records it).

## Open Decisions

- Operations command that grants `admin`: "proposed" in ST-160, MF-43 and ST-79; no page owns it and no story builds it — blocks: how the real admin is created outside the seed (FR-004).
- Release flag mechanism: "proposed" only; no page defines it — blocks: FR-007's per-view mark vs a stored switch.
- ST-301's flag style and the "Actualizat" marker are "not designed" — does not block ST-160.
- Open decisions page (numbered): not read (size); nothing in the stories points to one that blocks ST-160. T10/T12 (lawyer) do not touch this shell.

## Contradictions with spec.md

- **spec.md** (committed 2026-10-07): "The header MUST show the label 'ADMINISTRATOR'" — **Notion**: ST-160 criteria and MF-43 overview text say "ADMIN"; the Build brief (2026-10-03) says "ADMINISTRATOR" — newer: brief; spec agrees with the winner, no change needed.
- **spec.md**: FR-015 defers the live-rise end-to-end to ST-116 — **Notion**: ST-160 Tests list "in another browser a garage sends its file; the count goes up live" (2026-10-03) — newer: same date; spec's deferral is a deliberate deviation, record it as such on the Notion finish comment.
- **spec.md**: FR-004 / Assumptions "ships no command" — **Notion**: ST-160 Who can do it says "at launch, through an operations command run by the build team" *(proposed)*; ST-79 says a protected CLI script *(proposed)* — newer: ST-79 page (2026-10-04); both proposed, spec's deferral is consistent only if recorded as open.
- **spec.md** FR-013 / SC-002: seed gives 2 waiting; Notion's "4" is a sample — not a conflict, listed for the reader.
- Page ST-160 was edited 2026-10-07T08:53Z, after the spec's source note ("current as of 2026-10-03") — the diff visible to me is only Status Planning and the PR link; no scope text changed. Re-check with `--since` before PR.

## Proposed Clarifications (this command's proposals, not requirements)

- Record the end-to-end live-rise deferral to ST-116 as a deviation from ST-160's Tests, and ask the owner to confirm — from the contradiction above.
- Confirm whether "Setări" and "Service-uri" are released at this story and whether "Asistent AI" may reuse `admin.settings`: the brief names no capability or flag list — from Open Decisions, release flag.
- Ask whether the operations command that grants `admin` is a task of its own (proposed by three pages, built by none) — from Open Decisions.
- Confirm the zero form of the header ("niciun service nu așteaptă verificarea") and a hidden counter at 0: ST-301 scenario 8 says "counts are hidden or 0" — from ST-301 vs spec FR-008/FR-010.
- Name the city-choice story that replaces "ST-??" in FR-008 (the period-and-city story, page 3ee607bff0d281bcba2fe16979f909fc; ID not read here).
- Decide whether the header count should also re-read on `verification.opened`; ST-301 consumes it, ST-160 does not (spec edge case says the count does not change on opened) — consistent, but ST-301 will need the same list.

## Gaps

- [NEEDS CLARIFICATION: Open decisions sub-page not read; confirm no numbered decision touches the admin shell]
- The Architecture Security page "Capabilities by role" and ST-255 reconnect rules were not opened; the spec leans on the repo's capability table.
- Whether live re-read must work if the maintenance page blocks the stream: no page says.

## Sources

- ST-160 story — https://app.notion.com/p/3ee607bff0d281bcb229eaf763d5d51c
- MF-43 Admin dashboard: platform numbers and growth — https://app.notion.com/p/3ee607bff0d28145803ee93091505ae5
- EP-2 Garage onboarding and verification — https://app.notion.com/p/3ee607bff0d281f8ba8ae20d1af741cf
- ST-301 See the queue of garages waiting for verification — https://app.notion.com/p/3ee607bff0d28178b6d8f2bc3a968e84
- ST-164 Record every admin action — https://app.notion.com/p/3ee607bff0d281d788c1d0bf4822b656
- ST-79 Set up the account model, the roles and their rights — https://app.notion.com/p/3ee607bff0d281778692cbdd267fb72f
- ST-253 Set up the real-time connection — https://app.notion.com/p/3ee607bff0d281739e3df7b8fc484d49
- Architecture decisions — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a
- Decisions and ideas (index) — https://app.notion.com/p/3ee607bff0d281df9485ce97dfa3332d

## Refresh 2026-10-07

- Story ST-160 re-read at 2026-10-07T09:26Z: only the sync property changed, Status Planning to Implementing (page last edited 09:26Z). Title, acceptance criteria and Build brief (current as of 2026-10-03) are unchanged; the PR link is still #196. Comments: none (all blocks, resolved included).
- MF-43 feature page last edited 2026-10-03T18:47Z: unchanged since the first gather.
- No scope change. Nothing above is superseded.
