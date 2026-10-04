# Feature Context: Message templates in Romanian and English

- **Feature**: 195-message-templates
- **Anchor**: ST-195 "Set up message templates in Romanian and English" — https://app.notion.com/p/3ee607bff0d2813dbda8c0e39bb8c756 | terms: templates, Romanian, English, notifications, bell, Brevo
- **Gathered**: 2026-10-04
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature partial (page is 59k characters and could not be fetched whole; only search highlights read; comments none) | epic ok | architecture partial (Architecture decisions ok; Backend architecture skipped as too big) | decisions ok (Decisions and ideas is an index; its sub-pages were not opened)
- **Overall confidence**: medium (the story, its siblings and the epic are read in full; the feature page is not)

## Story

- **ST-195 Set up message templates in Romanian and English** — status Planning, priority High, role System, epic EP-1 Foundations, feature Notifications and reminders, 3 points, label backend, PR #67. Page last edited 2026-10-04T20:24Z.
- Scope per the story: "So that every message reaches a person in their language, we need templates with a Romanian and an English version of each message." Criteria: every message in RO and EN in the person's language; the test message exists in both; prices, numbers and dates follow the language's format; no other person's phone or plate (day-sheet exception). The Build brief (2026-10-03) wins over the criteria above it. Its scope is the template system of the `notifications` worker, the content rules "enforced by a check at build time", and the texts of TEST_MESSAGE and ACCOUNT_EMAIL.
- Comments that moved scope: none. The story and the feature page have no comments.

## Decisions

- Languages are `ro` and `en`; an unknown language falls back to Romanian. Recipient language is `ACCOUNT.language`. Dates and times are shown in Europe/Bucharest. — [ST-195 Build brief, States; ST-194 Build brief, Rules] (2026-10-04 / 2026-10-04, confidence: high)
- The plate rule is "never another person's phone number or number plate". The exceptions are the day sheet, which goes only to the garage's own staff, and a driver's own plate in their own messages. — [ST-195 criteria and Rules] (2026-10-03, confidence: high)
  - superseded: the earlier "never a plate" wording, replaced by "Superseded 2026-10-03" on the story and on the feature page.
- Scope boundary: this story writes only TEST_MESSAGE, the e-mail check and the password reset. Every other type's text is written by the epic that owns the event, in this system. — [ST-195 Notes, Left for later; EP-1 Out of scope] (2026-10-04 / 2026-10-03, confidence: high)
- Launch channels are e-mail, push (Web Push), SMS and WhatsApp, all through Brevo (A18, decided 2026-10-03). Every type also lands in the bell. — [Architecture decisions A18; EP-1 Risks] (2026-10-04, confidence: high)
- Quiet hours (22:00–08:00) are applied once, in the worker (A37). The bell row is written at once during them. A template does not need to know the time. — [Architecture decisions A37; ST-199 Rules] (2026-10-04, confidence: high)
- Money is stored and sent as integer bani, VAT included (A29, Proposed). This is why the 125000–160000 bani example in scenario 3 is a range. — [Architecture decisions A29] (2026-10-04, confidence: medium)
- Each notification type has template keys in `NOTIFICATION_TYPES`. ST-194 fills in only TEST_MESSAGE and ACCOUNT_EMAIL. ACCOUNT_EMAIL goes straight to the queue, is never grouped and cannot be muted. TEST_MESSAGE is admin-only and e-mail only. — [ST-194 Build brief, Rules and scenario 8] (2026-10-04, confidence: high)
- The bell text is rendered when it is read, from `NOTIFICATION.params` and the bell template in the viewer's current language. — [ST-199 Build brief, Rules] (2026-10-03, confidence: high)

## Constraints

- ST-194 is Done and merged (PR #59). Its deviation: grouping is leading-edge, so the first e-mail of a type goes alone and the later ones in the 5-minute window go as one "N oferte noi" e-mail. The grouped template therefore has to render a count. — [ST-194 comment, georgeh, 2026-10-04T19:48Z] (2026-10-04, confidence: high)
- ST-392 keeps the WhatsApp registration list "in the repository with the templates" and falls back to e-mail when a WhatsApp template is not yet approved (scenario 8). A WhatsApp template here must therefore carry a stable template name and ordered slots that ST-392 can register. ST-392 itself is out of scope here. — [ST-392 Rules and scenario 8; ST-195 Out of scope] (2026-10-03, confidence: high)
- ST-392 counts "one template fits one SMS (ST-195), so one message counts as 1". The 70-character SMS limit is what makes the monthly cap of 5 count messages. — [ST-392 Rules] (2026-10-03, confidence: medium)
- The SMS-eligible types are BOOKING_REMINDER, DUE_ITP, DUE_RCA, DUE_ROVINIETA, SERVICE_DUE and TYRES_SEASON. REVIEW_INVITE never goes by SMS, and staff never get SMS. Only these types would later need SMS text. — [ST-392 Rules] (2026-10-03, confidence: high)
- ST-199 puts the relative time ("acum 5 min") and the toast in the bell component. The bell template supplies only the notification's text. Its example texts are short ("Ofertă nouă de la Service Auto Nord"). — [ST-199 Build brief, scenarios 2 and 5] (2026-10-03, confidence: medium)
- Slice order puts ST-195 and ST-197's neighbours together: ST-195 and ST-198 (account language) "build together"; ST-81 (confirm e-mail) needs ST-195. — [EP-1 Build plan, Slice 5 and 6] (2026-10-03, confidence: high)
- The e-mail sending domain (S10) is still open, so production sending stays off. This does not block templates. — [ST-194 comment, 2026-10-04; EP-1 Risks] (2026-10-04, confidence: high)

## Prior Art

- ST-194 Set up e-mail sending — Done, PR #59, merged 2026-10-04. It owns the NOTIFICATION table, the type catalogue, the Brevo adapter and the 194 message table that this story replaces. — [ST-194] (2026-10-04)
- ST-199 the bell list, ST-392 SMS and WhatsApp, ST-196 push — all To do. The bell is the reader of the bell template and ST-392 the sender of the WhatsApp template. — [ST-199, ST-392] (2026-10-03)
- ST-19 formatters per language — merged (the story's dependency). Templates must reuse them. — [ST-195 Depends on] (2026-10-04)

## Open Decisions

- Who pays for the WhatsApp Business account behind Brevo beyond "MotorFix for now" — blocks: nothing in this story (it is a cost matter in ST-392).
- S10, the sending domain — blocks: only the production switch-on, not template work.

## Contradictions with spec.md

The spec was written 2026-10-04 and is uncommitted. The story page was edited at 2026-10-04T20:24Z. If that is later than the spec's file time, the spec is the stale side. The file time was not checked, so treat the direction as unknown. The story's own text has no scope change dated after 2026-10-03.

- **spec.md**: "no template may use a phone number" (User Story 3 scenario 2) — **Notion**: "A message never contains another person's phone number or number plate" [ST-195 Rules] (2026-10-03). The spec is stricter than the source. It would block the driver's own phone number in a message, and a later phone sign-in or phone-change code (PHONE_CHANGE_CODE exists in the feature page's catalogue). Same date or unknown, so recorded as a contradiction.
- **spec.md**: scenario 2 checks ș and ț "in the e-mail and the bell text" — **Notion**: "in the e-mail, the push and the bell" [ST-195 scenario 2] (2026-10-03). The spec drops push. This is consistent with push being checked on fixtures only, but the source names it.
- **spec.md**: scenario 3 uses "a range … as a price" — **Notion**: the example is QUOTE_RECEIVED [ST-195 scenario 3]. The spec has no QUOTE_RECEIVED text and says no push, SMS or WhatsApp texts exist. This is consistent with the "left for later" note, so only the test message would carry the price example.
- **spec.md** edge case: "A notification type with no template for a channel falls back to the generic text … (the 194 behaviour)" — nothing in the Notion source says so for the e-mail. ST-195 says only that a failed render gives a generic bell text. See Gaps.

## Proposed Clarifications (this command's proposals, not requirements)

- Restate the phone rule as the source writes it (another person's phone number), or confirm the stricter "no template may use any phone value" as a deliberate choice. — from the first contradiction
- Decide whether the test message and the account e-mails have a push text. The source's scenario 2 expects diacritics "in the e-mail, the push and the bell". — from the second contradiction
- Make the grouped template ("N oferte noi") take a count and render ro/en plural forms. It is sent from the second e-mail on, per the ST-194 comment. — from ST-194 comment, 2026-10-04
- Let the WhatsApp template shape hold a name and ordered slots that ST-392 can list for registration, and keep it one list in the repository. — from ST-392 Rules

## Gaps

- [NEEDS CLARIFICATION: the Notifications feature page (59k characters) was not read in full. Its own template rules, state texts and catalogue are unconfirmed here. Re-run with a way to slice the page.]
- No page says that a missing e-mail template falls back to a generic text. ST-195 states only the failed-render case (row `failed`, bell generic text), and states no fallback for a type with no template.
- Where the "why you get this e-mail" footer text lives per type, and the sender and reply-to wording, are not specified. Only "a footer explaining why the person gets them" is.
- Plural forms for Romanian ("1 ofertă", "3 oferte", "20 de oferte") are not specified anywhere in what was read.

## Sources

- ST-195 Set up message templates in Romanian and English — https://app.notion.com/p/3ee607bff0d2813dbda8c0e39bb8c756
- Notifications and reminders (feature page, search highlights only) — https://app.notion.com/p/3ee607bff0d28162b9b2cc67189317d1
- 🧱 Foundations (EP-1) — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
- ST-194 Set up e-mail sending, with its comment of 2026-10-04 — https://app.notion.com/p/3ee607bff0d281df9c01d35400d5195f
- ST-392 Send SMS and WhatsApp through Brevo with the monthly SMS cap — https://app.notion.com/p/3ee607bff0d281e088cadac726138cc5
- ST-199 See my notifications in a list behind the bell — https://app.notion.com/p/3ee607bff0d281e0a903f6f4d2ccf719
- 🧾 Architecture decisions — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a
- ❓ Decisions and ideas (index) — https://app.notion.com/p/3ee607bff0d281df9485ce97dfa3332d
