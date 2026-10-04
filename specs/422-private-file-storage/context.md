# Feature Context: Private file storage with signed uploads and downloads

- **Feature**: 422-private-file-storage
- **Anchor**: ST-422 Set up private file storage with signed uploads and downloads — https://app.notion.com/p/3ee607bff0d2815393e8ffeeca814408 (epic Foundations EP-1 https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707) | terms: storage, signed upload, signed download, private bucket, incoming
- **Gathered**: 2026-10-04
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok (none: the story has no feature relation; Features table not used) | epic ok | architecture ok | decisions ok (Architecture decisions only; the Decisions and ideas page was not read, see Gaps)
- **Overall confidence**: medium (Backend architecture could only be read as search excerpts; Query Data Source quota was exhausted, so sibling statuses are not read)

## Story

- **ST-422 Set up private file storage with signed uploads and downloads** — status In progress, priority High, role System, epic Foundations (EP-1), 3 points, labels backend and front end
- Scope per the story: "So that garages can upload photos and documents and drivers can see photos sent to them, we need private file storage with short-lived signed addresses for upload and download." Acceptance criteria: private EU buckets, nothing public by default; browser uploads straight to storage with an address the API issues after checking who may upload; downloads use short-lived signed addresses only for people allowed to see the file; the `storage` platform module is shared by listing photos, legal documents, message photos, repair invoices and job media. The Build brief states "Where this section and anything above disagree, this section wins."
- Comments that moved scope: none (page-level and block-level discussions, resolved included, returned empty). Story page last edited 2026-10-04T05:25Z.

## Decisions

- Files go straight from the browser to object storage with signed addresses; uploading through the API is the rejected alternative — [Architecture decisions, A12] (2026-10-03, confidence: high; status Proposed)
- Object storage is S3-compatible with private buckets and short-lived signed addresses; the provider is part of the hosting decision — [Technology stack, Backend, Files] (2026-10-03, confidence: high)
- Errors are RFC 9457 problem details with a stable lower snake case `code` (for example `file_too_large`) — [Architecture decisions, A28, A42] (2026-10-03, confidence: high)
- Hosting is Railway in an EU region (A16, A25, Given); every provider touching personal data needs a data processing agreement — [Architecture decisions; Security, Privacy] (2026-10-03, confidence: high)
- Hostile files: files are served "from a separate storage domain, never from the app's own"; the download address points at the provider's domain — [Security, Hostile files; story Build brief scenario 7] (2026-10-03, confidence: high)
  - superseded in part: Security says type and size are checked "again by the worker"; the Build brief puts the second check (existence, size, first-bytes signature) in the confirm call, and the worker re-check only for clips (ST-333) — [story Build brief, Rules and validation] (2026-10-04, newer)
- Leaked documents: addresses signed for a few minutes, for one file, after a permission check; opening a legal document is logged. The log is the owning use case's job; `storage` writes no audit — [Security, Leaked documents or media; story Build brief, Data] (2026-10-04, confidence: high)
- Backups: object storage has versioning on; old versions of a deleted file go after 30 days (proposed; the lawyer's answer may change it) — [Security, Backups; story Build brief] (2026-10-04, confidence: medium)
- Build brief defaults that bind the plan: purposes and limits in one `FILE_RULES` table in `libs/contracts` (all five at 10 MB); keys are random ids under a purpose prefix and never hold a file name or personal data; lifetimes upload 15 min, download 5 min, public images 60 min (`UPLOAD_URL_MINUTES`, `DOWNLOAD_URL_MINUTES`, `PUBLIC_IMAGE_URL_MINUTES`); config names `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`; interface `createUpload`, `confirmUpload`, `createDownloadUrl`, `putObject`, `deleteObject`, plus the ready check, in `libs/domain`; upload helper in `libs/media`; the AWS SDK S3 client and signing helpers are the only new dependencies — [story Build brief, Rules and validation] (2026-10-04, confidence: medium: every name is marked proposed)

## Constraints

- The browser, never the API, carries file bytes ("photos and video never pass through the API"); the worker writes straight to object storage — [System overview, What MotorFix is made of; How it grows] (2026-10-03, confidence: high)
- `storage` has no tables: file keys live on the owning rows, and it emits no events and sends no notifications — [Backend architecture search excerpt ("No tables. File keys live on the owning rows"); story Build brief, Data, Events] (2026-10-03, confidence: medium: excerpt only)
- The front end shared library `media` holds upload, player and live video, used by the driver, garage and mechanic areas — [Front end architecture, Structure] (2026-10-03, confidence: medium)
- Local development runs "a local object store" under Docker Compose; the brief names MinIO and a CI service container so the API tests run "against a real store, not a mock" — [System overview, Environments; story Build brief scenario 13] (2026-10-04, confidence: high)
- Staging and production never share a bucket or keys; secrets stay in the host's secret store; browser uploads are allowed only from the environment's own web address — [story Build brief scenario 11; Security, Secrets] (2026-10-04, confidence: high)
- Readiness: `GET /health/ready` on `api` and `worker` checks the bucket within 2 seconds and answers 503 naming `storage`; the monitoring story expects it, and health checks include storage — [story Build brief scenario 12; Security, Watching production] (2026-10-04, confidence: high)
- A profile is cached 5 minutes at the CDN, so public images need the 60-minute address — [Security, What is cached; story Build brief scenario 8] (2026-10-03, confidence: high)
- Media and photos are kept 90 days, legal documents while active plus 5 years: all pending the lawyer. The purge is not this story — [Security, Privacy; Architecture decisions, T10] (2026-10-03, confidence: high)

## Prior Art

- ST-421 (monorepo, `libs/domain`, configuration module, Railway staging and production, CI service containers) is the stated dependency; the repo archived it as 421-monorepo-platform — [story Build brief, Depends on; git log] (2026-10-04)
- ST-333 (job media) "now covers only the media-specific part"; it adds its own purposes and limits to `FILE_RULES` later — [story Notes and Build brief] (2026-10-03)
- First consumer: the listing-form workshop photo story in EP-2 (end-to-end test of the first real upload); the epic's Build plan puts ST-422 "early" in slice 1 — [story Build brief, Needed by; epic Foundations, Story order] (2026-10-03)

## Open Decisions

- Which S3-compatible EU provider holds the files, if Railway's own storage is not used (a provider outside Railway needs its own data processing agreement) — blocks: the provisioning in the plan; code stays provider-neutral. Owner with the build lead. [story Build brief, Open] (2026-10-04)
- T10, lawyer: retention for files and old versions (media 90 days; documents active plus 5 years, proposed) — blocks: the 30-day old-version rule and any purge. [Architecture decisions, T10] (2026-10-03)

## Contradictions with spec.md

- **spec.md** (2026-10-04): "Tests run against an in-process S3-protocol store over HTTP ... not against MinIO", and "SC-001 ... against an S3-protocol store over HTTP" — **Notion**: tests run "against MinIO", with MinIO in Docker Compose and as a CI service container, "so the API tests run against a real store, not a mock" [story Build brief, scenario 13 and Tests] (2026-10-04) — newer: same date. The spec records this as a deliberate deviation (no Docker on this machine).
- **spec.md** (2026-10-04): the helper retries only; "the brief's 'keeps the file queued while the page stays open' is read as the owning screen's choice" — **Notion**: "the helper keeps the file queued and retries while the page stays open" [story Build brief, States and errors] and "On a poor connection uploads wait in a queue and retry" [Front end architecture, Uploads] (2026-10-04 and 2026-10-03) — newer: same date; the brief says it wins over anything else.
- **spec.md** (2026-10-04): "Address lifetimes ... are constants next to the rules table, not environment variables" — **Notion**: names `UPLOAD_URL_MINUTES`, `DOWNLOAD_URL_MINUTES`, `PUBLIC_IMAGE_URL_MINUTES` and the five `STORAGE_*` config names; the brief does not say whether the three are environment variables, so this may be no conflict (low confidence) [story Build brief] (2026-10-04) — newer: same date.
- **spec.md** (2026-10-04) does not place the helper or the rules table; **Notion** puts `FILE_RULES` in `libs/contracts` and the helper in `libs/media` [story Build brief] (2026-10-04). Check the plan follows (low confidence: names are proposed).

## Proposed Clarifications (this command's proposals, not requirements)

- Confirm whether the in-process S3 store satisfies "against a real store, not a mock", or add a MinIO test path in CI to meet scenario 13 — from the first contradiction.
- Decide whether the upload helper keeps a queue and retries while the page is open, or whether the owning screen re-calls it — from the second contradiction.
- Decide whether the three lifetimes are environment variables, and use the brief's constant names either way — from the third contradiction.
- Note in the plan that the second check lives in the confirm call (not the worker), since the Security page still says "again by the worker" — from the Hostile files supersession.
- State in the plan that the provider stays a configuration value until the owner picks one (Railway storage or an EU provider with its own data processing agreement) — from Open Decisions.

## Gaps

- [NEEDS CLARIFICATION: which S3-compatible EU provider holds the files] (story Build brief, Open)
- Backend architecture (the "data model" page) could only be read as search excerpts; the storage module's row and any sequence for "Can go wrong" were not read in full.
- Decisions and ideas page and the Glossary were not read (too big or not needed); Query Data Source quota was spent, so sibling story statuses are not recorded.
- No feature page exists for this story, so nothing was read there.

## Sources

- Story ST-422 — https://app.notion.com/p/3ee607bff0d2815393e8ffeeca814408
- Foundations (EP-1) — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
- Technology stack — https://app.notion.com/p/3ee607bff0d2819ab8e3ee6926a249f2
- System overview — https://app.notion.com/p/3ee607bff0d28161a43cc77282ccc8c1
- Security, performance and operations — https://app.notion.com/p/3ee607bff0d2810d852efa0a9346afd3
- Front end architecture — https://app.notion.com/p/3ee607bff0d2811688cde6508dfcd09a
- Backend architecture (search excerpts only) — https://app.notion.com/p/3ee607bff0d281dfa162cd4b9983dd2e
- Architecture decisions — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a
