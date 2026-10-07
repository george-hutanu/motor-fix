# Auto run: 114-save-draft

## Log

- 2026-10-07 · phase 2 Specify · spec written from Notion ST-114 (Build brief of 2026-10-03 wins; decision: account at the end) and the repo (`list-your-garage.ts` holds no field yet; LISTING_CONTINUE_LINK and LISTING_REMINDER exist in the catalogue without templates; the notifications direct send is for accounts only).
- 2026-10-07 · autonomous answer · reminder: one e-mail 3 days after the last change, only to unsent drafts with an e-mail not yet reminded (the brief's proposed default).
- 2026-10-07 · autonomous answer · the continue link opens `/<lang>/list-your-garage?draft=<token>`, the repo's path, not the brief's `…/listeaza-service`.
- 2026-10-07 · autonomous answer · past 5 link e-mails per hour the save still succeeds; the send answers 429 and the form says the link was already sent, with the time it can be sent again.
- 2026-10-07 · autonomous answer · the browser that created the server copy keeps the draft's key, so its own saves reach the server; the link is for another device.
- 2026-10-07 · autonomous answer · the `sent` status is stored and honoured here (409 on save, "listing was sent" page); the sending-and-account story sets it.
- 2026-10-07 · autonomous answer · every "proposed" default of the brief taken as written (1 s / 5 s saves, 256 KB, 32-byte hashed token in `X-Listing-Token`, older tokens valid until sent, 90-day retention pending the lawyer, texts and subject).
- 2026-10-07 · autonomous answer · the direct send to an address with no account is added to the notifications capability for the two listing types only (Spec Delta, Principle I).
- Phase 2: after_specify design check left to phase 5 (before_plan), where speckit-auto runs it; git.commit and agent-context.update hooks not run (no commits this phase).
- Phase 2: Ready to work review — ST-788, ST-796, ST-800 ticked; ST-202 (lawyer), ST-245 (owner approves the lists), ST-789 (owner decision) and the ST-787/792/795/799/801 tech debt (each waits on a later story) held.
