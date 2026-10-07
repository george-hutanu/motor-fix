# Feature Context: Live hub derives staff kind rules from capabilities.ts

- **Feature**: 574-live-hub-capabilities
- **Anchor**: ST-574 Tech debt (ST-254) — https://app.notion.com/p/3f0607bff0d281698e70e92df00231f6 (from ST-254 https://app.notion.com/p/3ee607bff0d281769e64ff763a743def; epic Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707)
- **Gathered**: 2026-10-07
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature partial (not fetched; the story relates to the ST-254 feature page) | epic partial (not fetched) | architecture ok | decisions partial (Security page and ST-254 only; no open decision about live events found)
- **Overall confidence**: medium-high

## Story

- **ST-574** — status Planning, priority Medium, role System, epic Foundations, PR #194 (page edited 2026-10-07)
- Scope per the story: "So that a rule is written once, derive the live hub's receptionist and mechanic kind rules from capabilities.ts instead of a second list; today a receptionist, who has no garage.reviews or garage.profile capability, still gets review.* and garage.profile_changed through the garage channel". Where: `libs/domain/src/events/live.hub.ts:17-26`. Found by pr-tester (lap 2) on PR #75. Finding: "FR-003 is met as written; the fix is to map kind families to capabilities and reuse `capabilitiesOf`" (Principle V).
- Comments that moved scope: none (the story has no comments).

## Receptionist: the three questions you asked

- **Reviews: MAY NOT reply to or report them; MAY read public reviews.**
  - Security › Capabilities by role: "Reply to a review and edit the reply; report a review" is `—` for no one but the owner, and for the receptionist "Decided 2026-10-03: no (W10)".
  - The same table gives "Search; open garage profiles, price lists, reviews, mechanic pages" ✓ to every role. That is the public read, not a garage review capability.
  - ST-400 lists "review replies or reports" under "Not". Notion does not say a receptionist is told live when a review arrives. The story says `garage.reviews` is not a receptionist capability.
- **Garage profile: MAY NOT change it; no garage-side read right is stated.**
  - "Profile, brands and per-brand ticks, payment methods, courtesy car, closed days, facility requests" is `—` for the receptionist.
  - Price list is `—` and settings is `—`. ST-400: "no access to the garage's settings, prices or team". The public profile is readable by all (above).
- **Team and invites: MAY NOT, read or change.**
  - "Feature switches; team, invites, mechanic cards and permissions" is `—` for the receptionist.
  - ST-400: "A receptionist cannot invite anyone", and Setări, Prețuri and Mecanici are absent from her menu.
  - ST-254 scenario 4: "A receptionist does not see prices, settings or the team".
  - ST-254 Rules: the receptionist gets "everything except prices, settings, feature switches and the team".

## Decisions

- A receptionist is allowed: requests, quotes, bookings (confirm, move, cancel, no-show, turn down a move), odometer, final price, driver phone, plate, shared car history, day sheets, garage figures, own audit history, own request mute. Not allowed: job stages or steps, estimated finish, media, review replies or reports, settings, switches, prices, team. — [ST-400 https://app.notion.com/p/3ee607bff0d2814eabd2c4632b585048, Rules; Security page https://app.notion.com/p/3ee607bff0d2810d852efa0a9346afd3, "Capabilities by role"] (2026-10-03, high)
- "No receptionist or mechanic cell is left open." — [Security, Open note] (2026-10-03, high)
- A mechanic gets only own jobs and bookings, requests and messages if `can_answer_quotes`, booking moves if `can_move_bookings`. Mechanics never confirm bookings. — [ST-254 Rules, "Filter on garage:{garageId}"; Security] (2026-10-05 / 2026-10-03, high)
- "The capabilities matrix on the Security page is one table in code, in `libs/auth`, with a test for every 'may not'." Marked proposed. — [ST-79 https://app.notion.com/p/3ee607bff0d281778692cbdd267fb72f, Rules] (2026-10-04, medium)
- The rule ST-254 enforces: "a person receives an event only if they could read its object through the API at that moment". — [ST-254 Build brief] (2026-10-05, high)
- Review audience is: the garage, the author, `public:garage`, `public:mechanic`. Only the garage, not a role within it, is named. — [ST-254 Rules, Audience by subject] (2026-10-05, high)

## Constraints

- Fail closed: an event with no audience is dropped and logged. The live message carries only kind, id and time, and the API re-read is the second check. — [ST-254 Rules] (2026-10-05, high)
- Nothing about a switched-off garage feature is forwarded (e.g. `live_media`). Garage access is cached 60 s and dropped on `member.removed`, `mechanic.updated` and `garage.features_changed`. — [ST-254 Rules, Data] (2026-10-05, high)
- Private events never reach `GET /api/v1/live/public`. — [ST-254 scenario 6] (2026-10-05, high)
- Live updates use server-sent events, "the same server-sent events as the dashboards". — [Security, caching table] (2026-10-03, medium)

## Prior Art

- ST-254 is Done, merged as PR #75. It matched kinds by prefix (`price_list.*`, `member.*`, `mechanic.*`, `garage.settings_changed`, `garage.features_changed`, `request.*`, `message.*`, `booking.move*`) "from the brief's examples"; later kinds "extend the list". — [ST-254 comment, 2026-10-05 02:42, georgeh]
- ST-79 is Done (PR #3); it created the capability table's home. ST-400, the receptionist story, is To do.
- Siblings filed from the same review: ST-567 (access cache never swept), order across channels, one warning per staff stream, no colocated spec for garage-access.ts. — [ST-254 comment]

## Open Decisions

- none found. ST-254 says "Open: None" and the Security page says no cell is open. I found no numbered open decision about live events; I did not read the full Open decisions list (open decision 23, WebSocket or SSE, appears in a search highlight and was not opened).

## Contradictions with spec.md

- not compared (spec.md not read in this run). Within Notion, ST-254's brief says a receptionist gets "everything except prices, settings, feature switches and the team". That conflicts with ST-574 and the Security table, which give her no review or profile kinds. ST-574 is newer (2026-10-07) and is the current position. ST-254's wording is superseded for review and profile kinds, and ST-574 itself says the old rule met FR-003 as written.

## Proposed Clarifications (this command's proposals, not requirements)

- Is `member.*` (team) the only team kind? An invite kind (`invite.sent`, `invite.accepted`, `invite.revoked`) goes to the owner; ST-400 lists it as owner-only. Confirm the receptionist gets none. — from ST-400 Events, Security table.
- No capability row exists for "see review events" or "see profile-change events". Decide whether kinds map to existing capability names such as `garage.reviews` and `garage.profile`, or whether any role seeing them needs a new row. Notion gives no answer for the owner either. — from ST-574 finding.
- Mechanic: ST-254 says only own jobs and bookings, plus requests and messages with `can_answer_quotes`. Check that every mapped kind family keeps that. — from ST-254 Rules.

## Gaps

- [NEEDS CLARIFICATION: does a mechanic receive review.* or garage.profile_changed? Notion states neither way; the Security table gives the mechanic no review or profile capability.]
- No Notion page describes `capabilitiesOf`. It is a code-level name taken from ST-574.

## Sources

- ST-574 — https://app.notion.com/p/3f0607bff0d281698e70e92df00231f6
- ST-254 Send live updates only to the people involved (and its finish comment) — https://app.notion.com/p/3ee607bff0d281769e64ff763a743def
- Security, performance and operations › Capabilities by role — https://app.notion.com/p/3ee607bff0d2810d852efa0a9346afd3
- ST-400 Add an optional receptionist to the garage — https://app.notion.com/p/3ee607bff0d2814eabd2c4632b585048
- ST-79 Set up the account model, the roles and their rights — https://app.notion.com/p/3ee607bff0d281778692cbdd267fb72f
