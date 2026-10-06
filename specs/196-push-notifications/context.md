# Feature Context: Set up push notifications

- **Feature**: 196-push-notifications
- **Anchor**: ST-196 "Set up push notifications" — https://app.notion.com/p/3ee607bff0d28156a023d73a7262de80 | terms: push, Web Push, PUSH_SUBSCRIPTION, Brevo, VAPID, service worker
- **Gathered**: 2026-10-05
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok | epic partial (plan row and search only; Query Data Source usage limit reached, sibling statuses taken from each page's own properties) | architecture ok (decisions page full; Technology stack page via search highlights only) | decisions partial (index page and search highlight of "Open decisions" item 6; the page body was not opened)
- **Overall confidence**: medium

## Story

- **ST-196 Set up push notifications** — status Planning, priority Medium, role System, epic Foundations (EP-1), 8 points, labels front end / backend / outside service, PR #119. Page last edited 2026-10-05T10:50Z.
- Scope per the story (Build brief wins over the criteria above it, "current as of 2026-10-03"): Web Push as the second channel of the `notifications` service from the installable web app: ask permission and store PUSH_SUBSCRIPTION; the service worker that shows the notification and opens the right screen on tap; the push adapter in the worker; fallback from push to e-mail; the iPhone Home Screen hint. Any signed-in role manages push for their own devices; another account's subscription answers 404. Nine acceptance scenarios (permission, closed-app push within 60 s, iPhone hint, installed iOS test push, blocked permission, 404/410 deletes and falls back, one NOTIFICATION row for several devices, delete on sign-out *(proposed)*, real-phone test).
- Proposed defaults in the brief: API `POST /api/v1/push-subscriptions` and `DELETE /api/v1/push-subscriptions/:id`; TTL 24 h; urgency "high" for always-sent types, "normal" otherwise; prompt after the first quote request and from Setări; no audit history.
- Comments that moved scope: none. The story and its feature page have no comments (checked with resolved included). The scope moved in the page body: "Decided 2026-10-03" and "Superseded 2026-10-03" lines (push ships at launch, so the task stays in Foundations).

## Decisions

- Launch channels are e-mail, push (Web Push from the installable web app), SMS and WhatsApp, "all sent through Brevo (A18)" — [Architecture decisions, A18; ST-196 Notes; ST-193; feature MF-51 Channels] (2026-10-03 / page edited 2026-10-04, confidence: high)
  - superseded by: the same pages' earlier "e-mail only, or e-mail and push?" question (open until 2026-10-03)
- A19: installable web app with Web Push first, app-store apps later only if needed — [Architecture decisions, A19] (2026-10-03, high)
- Open decision 6 (channels at launch) is decided: push, SMS, WhatsApp ship at launch beside e-mail, through Brevo — [Decide: channels at launch ST-193, status Done; Open decisions item 6] (2026-10-03, high)
- Technology stack names Brevo as sending "SMS, WhatsApp and Web Push (A18, open decision 6)" — [Technology stack, search highlight only, page edited 2026-10-04] (high for the wording, medium because the page was not opened in full)
- Feature rules for push, all from MF-51 Final rules (Build brief, 2026-10-03): fallback "push not possible, or rejected → e-mail" (rule 13, *proposed*); e-mail bounce falls back to push if the person has a subscription (rule 13, belongs to the ST-194 hook); staff choose among e-mail, push and WhatsApp, never SMS (rule 5); always-sent types cannot be turned off but may change channel (rule 6); a message never contains another person's number or plate (rule 8); quiet hours 22:00–08:00 hold non-urgent outside sends, the bell row is written at once (rule 16, A37, X25) — [Notifications and reminders] (2026-10-03, high)
- A31/A34: another account's resource answers 404 (across accounts), 403 only within one garage's staff — [Architecture decisions] (2026-10-03, high) — matches the story's "another account's subscription answers 404".
- A28/A42: errors are RFC 9457 problem details with a lower snake case `code` — [Architecture decisions] (proposed, 2026-10-04, medium)
- A9: background work is BullMQ in a separate worker; A7 events through a transactional outbox — [Architecture decisions] (proposed, medium)

## Constraints

- A subscription belongs to one account; PUSH_SUBSCRIPTION fields per the brief: account_id, endpoint, keys, plus device_label, created_at, last_success_at *(proposed)* — [ST-196 Build brief › Data] (2026-10-05, high)
- Permission is asked only after a tap on a MotorFix button, never on page load — [ST-196 Rules] (2026-10-05, high)
- A push carries a title, a body and a link; no personal data beyond what the ST-195 template allows — [ST-196 Rules] (2026-10-05, high)
- Retries and the fallback follow ST-194: 1, 5, 15, 60 and 240 minutes, then the fallback hook runs; "ST-196 plugs push into it" — [ST-194 scenario 6] (2026-10-04, high)
- Every NOTIFICATION row is one per recipient and channel; the `in_app` row always exists; one push row whatever the device count — [ST-196 scenario 7; MF-51 States] (2026-10-05, high)
- Service worker: ST-286 ships the manifest and the Angular service worker for the app shell, API answers never cached *(proposed)*; "Web Push handling is added in ST-196" — [ST-286 Build brief › Rules] (2026-10-04, high)
- iPhone web push only works from an installed web app (iOS 16.4 or later); outside the Home Screen the hint shows and messages go by e-mail — [ST-196 scenarios 3, 4] (2026-10-05, high)
- Mock shows nothing for the push button or the iPhone hint ("Not designed"); the story proposes Setări · Notificări of every dashboard plus a one-time panel after the first quote request — [ST-196 Notes, Screens] (2026-10-05, high)
- Real-phone tests (iPhone installed app, Android) are tracked in a device-testing story, not here (page `3ee607bff0d281788c6fdb6d60963d80`, not opened) — [ST-196 Tests] (2026-10-05, medium)

## Prior Art

- ST-194 Set up e-mail sending — Done, merged in PR #59 (2026-10-04). Its merge comment records: grouping is leading-edge; the outbox relay is not wired (features call the service directly until ST-257); production sending stays off (`EMAIL_SENDING=off`) until the sending domain S10 is chosen; 9 deferred follow-ups — [ST-194 comment by georgeh, 2026-10-04T19:48Z]
- ST-286 Set up the shared phone layout rules — Done (PR #22): manifest, icons, `display: standalone`, Angular service worker — [ST-286] (2026-10-04)
- ST-193 Decide: channels at launch — Done (2026-10-03).
- ST-195 (templates), ST-197 (preferences), ST-392 (SMS cap), ST-257 (outbox relay) are cited by the story and the spec; their status was not read this run (query tool limit).
- Out of scope per the story: SMS and WhatsApp (page `3ee607bff0d281e088cadac726138cc5`), per-type push choice for drivers and staff, push for media and live streams (release 2).
- The build timeline row (Foundations EP-1, lane D Messaging, wave W3, 2026-10-28 to 2026-11-02) is blocked by two pages and blocks two others — [build timeline row] (2026-10-05)

## Open Decisions

- Brevo vs direct VAPID: "if Brevo cannot send transactional Web Push to an installable web app, may the worker send push directly (standard Web Push with VAPID keys), outside Brevo?" (build team, within A18). The brief says the final audit round (X01–X27) does not answer it, and the plan row says "Answer before the build starts" — blocks: the push adapter, its test double, and the env keys. No page found in the space says push may be sent outside Brevo. — [ST-196 Open; Foundations build timeline row; EP-1 execution plan] (2026-10-05)
- S10 (e-mail sending domain, owner) stays open; it keeps production sending off, and the e-mail fallback depends on it — [ST-194] (2026-10-04)

## Contradictions with spec.md

- **spec.md** (2026-10-05): "Push is sent directly by the worker with the standard Web Push protocol and the server's VAPID keys, not through Brevo: Brevo's transactional API has no Web Push to browser subscriptions. This answers the brief's open question within A18" — **Notion**: A18 (2026-10-03) and the Build brief say push goes "through Brevo [6][A18]", and the VAPID question is recorded as unanswered (build team, 2026-10-05) [ST-196; Architecture decisions A18] — newer: same date. The spec claim about what Brevo's API supports is not in the space, so it cannot be verified from Notion.
- **spec.md**: "FR-014 … a signed-in person MUST be able to send a push-only test to their own devices" (new push-only type, any role) — **Notion**: TEST_MESSAGE is an admin-only API, `POST /api/v1/admin/notifications/test`, and ST-196 "proves it with TEST_MESSAGE"; no self-service test button is in the brief [ST-194 Build brief; ST-196 Notifies] — newer: Notion for the brief (2026-10-04/05), spec.md same date.
- **spec.md**: FR-016 "signing out everywhere MUST delete every push device" and FR-017 re-save on every app start — **Notion**: the brief only says delete on sign-out *(proposed)* and a re-check on app start *(proposed)*; "sign out everywhere" is not mentioned [ST-196 scenario 8, States] — spec extends the brief.
- **spec.md**: FR-018 "Push MUST be off when the server has no push keys" and a UI state "push is not available yet" — **Notion**: nothing in the space about keys or a not-configured state; not a contradiction, but it is new scope [ST-196] — newer: n/a.
- **spec.md**: panel on the garage dashboard's "home view" because it "has no Setări view" — **Notion**: "Put them in Setări · Notificări of every dashboard" [ST-196 Screens, *proposed*] — newer: same date; whether the garage dashboard has Setări is a code fact the space does not settle.

## Proposed Clarifications (this command's proposals, not requirements)

- Ask the owner or build team to answer the VAPID question before planning, or record in `spec.md` that the direct-VAPID adapter is a provisional default awaiting the answer, with the adapter behind an interface so Brevo can replace it — from the Open Decisions and the first contradiction.
- Decide whether the self-service push-only test (FR-014) stays; the brief only calls for the TEST_MESSAGE proof — from the second contradiction.
- Decide whether "sign out everywhere" and the server-keys-missing state belong to this story or are extras — from the third and fourth contradictions.
- Confirm the panel's place on the garage dashboard — from the fifth contradiction.
- Confirm that the e-mail fallback is allowed while production e-mail is off (S10) — from Open Decisions.

## Gaps

- [NEEDS CLARIFICATION: may the worker send push directly with VAPID keys outside Brevo?] — the story's own open question; no page answers it.
- Status of ST-195, ST-197, ST-392, ST-257 and the device-testing story not read (Notion Query Data Source usage limit reached).
- The Technology stack page and the "Open decisions" page (item 6) were read only as search highlights; the Mobile experience decision (7) was not opened.
- The design mock link was not opened (outside Notion); the story says push is "Not shown" in the mock.

## Sources

- Set up push notifications (ST-196) — https://app.notion.com/p/3ee607bff0d28156a023d73a7262de80
- Notifications and reminders (MF-51, feature) — https://app.notion.com/p/3ee607bff0d28162b9b2cc67189317d1
- Architecture decisions — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a
- Technology stack — https://app.notion.com/p/3ee607bff0d2819ab8e3ee6926a249f2
- Decisions and ideas / Open decisions — https://app.notion.com/p/3ee607bff0d281df9485ce97dfa3332d , https://app.notion.com/p/3ee607bff0d2817d95ebd3b142c1de11
- Set up e-mail sending (ST-194) — https://app.notion.com/p/3ee607bff0d281df9c01d35400d5195f
- Set up the shared phone layout rules (ST-286, the manifest and service worker; the URL in the invoking prompt) — https://app.notion.com/p/3ee607bff0d281df9a9ef85c0725362c
- Decide: channels at launch (ST-193) — https://app.notion.com/p/3ee607bff0d2813db104d0107780fef5
- Foundations (EP-1) — build timeline row — https://app.notion.com/p/3ee607bff0d2819da6d1dcfd0d25dae6
- Foundations (epic) — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
