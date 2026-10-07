# Feature Context: Save a draft and come back to it later

- **Feature**: 114-save-draft
- **Anchor**: ST-114 Save a draft and come back to it later — https://app.notion.com/p/3ee607bff0d28182bfafc99b0021fc1f | terms: garage, listing draft, continue link, reminder
- **Gathered**: 2026-10-07
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok | epic ok | architecture ok | decisions partial (the Open decisions page, 64k characters, was too large to read in full; its quiet-hours line for the listing reminder came from a search highlight)
- **Overall confidence**: high

## Story

- **ST-114 Save a draft and come back to it later** — status Planning, priority Highest, role Garage, epic EP-2 Garage onboarding and verification, 5 points, labels front end, backend, outside service. PR #199 is linked.
- Scope per the story: "As a garage owner, I want to save the form as a draft and resume it later, so that I do not lose my work if I stop halfway." Criteria: Salvează ciorna keeps the form; a draft can be closed and resumed with nothing lost; the listing is stored as draft until sent; an owner who leaves halfway is reminded. The account criterion was superseded on 2026-10-03: the draft lives in the browser, an e-mail asked on step 1 sends a continue link, and the account is created at the end of the form. The Build brief (current as of 2026-10-03) wins over the criteria above it.
- Comments that moved scope: none. The story has no comments (`notion-get-comments` with all blocks and resolved included returned none). Scope moved through in-page "Superseded/Decided 2026-10-03" notes.

## Decisions

- The owner's account is created at the end of the listing form. The draft is saved in the browser as the owner types, and an e-mail asked on step 1 sends a "continue on any device" link. — [ST-107 Decide: when the garage owner's account is created; Open decisions (17)] (2026-10-03, confidence: high)
  - superseded: story criterion "saved to the owner's garage account" and the feature page Dependencies row "signed-in garage account" (both 2026-10-03, replaced the same day).
- Server copy is LISTING_DRAFT (email, resume_token_hash, data, step, updated_at). Token is 32 random bytes with only the hash stored, header `X-Listing-Token`, older tokens valid until sent, at most 5 link e-mails per draft per hour, data at most 256 KB, photos as file keys. Wrong, old or used token gets 404. — [ST-114, Build brief › Rules and validation] (2026-10-03, confidence: medium; each detail is marked *(proposed)* by the owner's brief)
- The link e-mail goes straight to the `notifications` queue with no outbox event, no audit entry and no live update while there is no account. — [ST-114, Build brief › Events and notifications; MF-29 Build brief › Data and events] (2026-10-03, confidence: high)
- LISTING_CONTINUE_LINK cannot be muted. Brevo failure is retried by the queue and the form never waits for it. — [ST-114 Build brief; A18 Architecture decisions] (2026-10-03/04, confidence: high)
- Quiet hours are applied once, in the notifications worker: non-urgent messages are held 22:00–08:00 Europe/Bucharest (A37). The listing reminder also waits for the end of quiet hours. — [Architecture decisions A37; Open decisions, via search highlight] (2026-10-04 / 2026-10-03, confidence: medium)
- Errors are RFC 9457 problem details with a lower snake case `code` (A28, A42). A resource of another party answers 404 (A31). — [Architecture decisions] (2026-10-04, confidence: high)
- Stack is Angular + Spartan UI (A1 amended 2026-10-04: no PrimeNG), NestJS, PostgreSQL, Prisma, BullMQ worker. — [Architecture decisions A1, A6, A9] (2026-10-04, confidence: high)
  - superseded: the feature page "PrimeNG components" toggle (InputText, InputMask, FileUpload…) (2026-10-03) by A1 amended (2026-10-04).
- Retention: an abandoned draft and its photos are deleted 90 days after the last change. This is the owner's proposal pending the lawyer (T10, T12). — [MF-29 Build brief › Open; Architecture decisions T10] (2026-10-03, confidence: medium)

## Constraints

- Module is `garages` (draft, survey, profile data); `storage` holds photos. The brief names the API `listing-drafts` in the `garages` module: `POST /api/v1/listing-drafts`, `PATCH …/:id`, `POST …/:id/continue-link` *(proposed)*. — [ST-114 Build brief › Data; MF-29 Build brief] (2026-10-03, confidence: high)
- Each step story owns its section of `LISTING_DRAFT.data`, typed in a shared library, and the function that writes its rows. The submit (ST-116) runs them all in one transaction *(proposed)*. — [MF-29 Build brief › Final rules 16] (2026-10-03, confidence: medium)
- The story's edges: the e-mail field on step 1, the browser store, the `listing-drafts` API and the two e-mails. Out of scope: other step 1 fields and prices (ST-109), photo uploads (ST-110), creating the account and sending the listing (ST-116). — [ST-114 Build brief › Scope, Out of scope] (2026-10-03, confidence: high)
- Design: the mock shows only the button "Salvează ciorna". The e-mail field, the "link sent" line, both e-mails and the expired-link page are not designed. The mock URL is recorded, not opened: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr. — [ST-114 Build brief › Screens; EP-2 Design] (2026-10-03, confidence: high)
- Tests asked by the brief: Jest for hashed token and 404, link e-mail once per send in the form's language and at most 5 an hour, last save wins by `updated_at`, 90-day clean-up with files, a sent draft refuses saves. Playwright reads the link from the test mail sink, opens it in a new context and checks the data. — [ST-114 Build brief › Tests] (2026-10-03, confidence: high)
- Phone-first and bilingual: every screen works in Romanian and English, on a phone and a desktop (EP-2 definition of done). — [EP-2 Definition of done] (2026-10-07, confidence: high)

## Prior Art

- ST-108 Move through the six steps with the step list in view — Done, PR #192; it built the page this story adds to. — [MotorFix stories] (queried 2026-10-07)
- ST-194 e-mail sending, ST-195 Romanian and English templates, ST-196 push, ST-200 scheduler, ST-422 private file storage, ST-79/80/82/83/393 accounts and sign-in, ST-390 audit writer, ST-253/257 live events — all Done. The brief's "Depends on" are all Done. — [MotorFix stories] (queried 2026-10-07)
- Siblings still To do: ST-109 (details, prices, mechanics), ST-115 (what is missing), ST-116 (send and status), ST-396 (survey). ST-116 must set the draft to submitted/sent; ST-114 only stores and respects it. — [MotorFix stories; EP-2 Build plan slice 4] (2026-10-07)
- Slice 1 of the EP-2 build plan: "a draft that survives closing the tab and continues from the e-mail link" is what staging must show; demo step 1 is the phone-to-desktop continue link. — [EP-2 Build plan › Story order, Demo script] (2026-10-03)

## Open Decisions

- Reminder timing: "when, and how many times, is the owner reminded of an unfinished listing?" Notion's build default is one e-mail 3 days after the last change, still marked [NEEDS CLARIFICATION] on both the story and MF-29 (story page edited 2026-10-07). — blocks: FR-015, story 4. spec.md already took this default as a Clarification.
- T10/T12 retention and legal documents: the lawyer is still to confirm. The 90-day draft retention waits on it. — blocks: FR-016 number (one place in code).
- The e-mail sending domain is still open with the owner (Decisions and ideas, Update 2026-10-03). — blocks: real e-mail delivery of the link (not the build).

## Contradictions with spec.md

- **spec.md** (2026-10-07): the link is `/<lang>/list-your-garage?draft=<token>` — **Notion**: `…/listeaza-service?draft=<token>` [ST-114 Build brief › Rules and validation] (2026-10-03) — newer: spec.md, and it is a deliberate clarification from the repo's route.
- **spec.md**: draft status is `draft` or `sent` — **Notion**: LISTING_DRAFT is `open` then `submitted` at account creation [MF-29 Build brief › States and lifecycle; Data] (2026-10-03). The story's own acceptance criterion says "the state draft until it is sent". Naming differs, meaning is the same — newer: Notion is not clearly newer; same date range.
- **spec.md** (Clarifications): the reminder is settled as 3 days, once — **Notion**: the question is still open [ST-114 Build brief › Open] (2026-10-07) — newer: Notion (page edited after spec created); spec's choice is an autonomous default, not an owner decision.
- **spec.md** FR-009/FR-012 give 429 and 409 with stable codes and the form's wording on the cap — **Notion** gives none of these (brief only says 404 for bad tokens and 5 an hour) — a spec addition, not a conflict.

## Proposed Clarifications (this command's proposals, not requirements)

- Keep the reminder at one e-mail 3 days after the last change, but record it as the build default awaiting the owner, not as decided — from Open Decisions.
- Confirm that `sent` is the spec's name for the feature page's `submitted`, so ST-116 uses one state name — from the contradiction on status naming.
- Decide whether the link path stays `/list-your-garage` or the Romanian slug from the brief is added later; the route should be set in one place — from the link contradiction.
- Decide if the 5-per-hour cap also stops the 6th "Salvează ciorna" press from saving (spec: it still saves) — from the brief rule "at most 5 link e-mails per draft per hour".

## Gaps

- [NEEDS CLARIFICATION: reminder timing and count, owner has not answered (Notion Open).]
- [NEEDS CLARIFICATION: wording and design of the e-mails, the "link sent" line and the expired-link page; none are designed.]
- The Open decisions page and the Notifications and reminders page were not read in full; the notification type table was not checked for LISTING_CONTINUE_LINK and LISTING_REMINDER (only search highlights seen).

## Sources

- Save a draft and come back to it later (ST-114) — https://app.notion.com/p/3ee607bff0d28182bfafc99b0021fc1f
- 🛡️ Garage onboarding and verification (EP-2) — https://app.notion.com/p/3ee607bff0d281f8ba8ae20d1af741cf
- 📝 List your garage: the onboarding form (MF-29) — https://app.notion.com/p/3ee607bff0d28117a3fffe7230aef5cb
- Decide: when the garage owner's account is created (ST-107) — https://app.notion.com/p/3ee607bff0d281739ad1c547c921fe5d
- 🧾 Architecture decisions — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a
- ❓ Decisions and ideas — https://app.notion.com/p/3ee607bff0d281df9485ce97dfa3332d
- Open decisions — https://app.notion.com/p/3ee607bff0d2817d95ebd3b142c1de11
- Notifications and reminders — https://app.notion.com/p/3ee607bff0d28162b9b2cc67189317d1
- MotorFix stories (sibling statuses) — collection://326eee3c-abec-41d9-9f96-eb3bd545a802

## Refresh 2026-10-07

No changes since 2026-10-07. The story (ST-114) was re-read: status Planning, priority Highest, PR #199 linked, Build brief and criteria identical to the digest above, still no comments (all blocks, resolved included). The reminder question is still marked [NEEDS CLARIFICATION]. The baseline is a date without a time, so a same-day edit cannot be told apart; the page body shows nothing new. Only the story was re-checked; other pages were not re-read.
