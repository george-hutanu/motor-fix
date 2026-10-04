---
feature: 194-email-sending
date: 2026-10-04
verdict: accepted-with-open-items
---

# Retrospective: 194-email-sending

## Verdict

Accepted with open items, judged against the spec's seven success criteria.
SC-005 is covered by `catalogue.spec.ts` and `catalogue.adversary.spec.ts`.
SC-006, including the clock change on 25 October 2026, is covered by
`quiet-hours.spec.ts`. SC-007 is covered by `email-config.spec.ts`.
SC-001 to SC-004 are covered by `notifications.api.integration.spec.ts` and
`notifications.service.integration.spec.ts`, against the recorded Brevo mock
(`brevo-mock.testing.ts`). All of these spec files are in
`libs/domain/src/notifications/`.

PR #59 merged as `b016b2f` on green CI, with `agent-review` passing on
`777880e`. In QA lap 5:

- 90 flow checks passed;
- the domain suites passed, 41 suites and 1367 tests;
- e2e passed, 213 of 213.

Two things are still owed: the deferred durability findings, and turning
sending on in staging.

## Evidence

From `node .claude/scripts/retro-evidence.mjs specs/194-email-sending`:

- **Tasks:** 17 done, 0 open.
- **Requirements:** 20 declared, 0 retired.
- **Spec Delta:** `notifications` +20.
- **Commits:** 4 on the feature, from `3d03f46` to `5fad0d7`.
- **Diff:** the script's "173 files" counts from an older base and includes
  later work merged to `main`.
- **Deferred:** 8 open, each filed in Notion with its task URL.
- **Trace matrix:** 0 of 20 requirements show as covered. That is true of
  every feature in the repo, because no test carries an `@traces` tag yet;
  ST-194 did not cause it.

## What accumulated across the feature

The three fix commits (`ef2f9ec`, `5992ffa`, `5fad0d7`) all close gaps on the
edges of a send: the switch is checked before each send, a bounce is recorded
once per grouped row, and the pre-send refusals are tested. Most of the
deferred findings are on those same edges, in
`notifications.service.ts:98,183,198,316` and `notifications.processor.ts:133`:
a row saved but its job lost, a database error after Brevo accepts, and the
order of grouping windows. Delivery is correct along the happy path. It is
not yet proven when the database and Brevo fail at the same time.

## Where the implementation diverged from the spec

None found. The grouping behaviour the owner was told about (3 quotes send
2 e-mails) is FR-009 and SC-004 as written. Whether the worker should crash
or keep retrying when Brevo is unreachable at start-up is an open owner
question, not a divergence: FR-016 as written is met.

## Carried in

None of the five carried items is in this feature's scope: the 050 theme
approval, the two 157 drawer items, and the two 159 items. The 159 item
"sign-up with a taken e-mail" e2e has since shipped in ST-494, so it closes
in its own feature's records.

## Action items

- [ ] Turn on `EMAIL_SENDING` on staging (worker and api) now that ST-194 has
      deployed; production stays off until the sending domain (S10) is chosen
      (owner)
- [ ] Owner decides whether the worker crashes or keeps retrying when Brevo
      is unreachable at start-up (`notifications.module.ts:104`) (owner)
