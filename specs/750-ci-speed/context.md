# Feature Context: CI speed

- **Feature**: 750-ci-speed
- **Anchor**: ST-750 — https://app.notion.com/p/3f1607bff0d2816784b9c0634b1a5b83 (epic Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707) | terms: CI, GitHub Actions, release pipeline, Railway, e2e, runners
- **Gathered**: 2026-10-06
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story no | feature no | epic no | architecture no | decisions no
- **Overall confidence**: low (nothing was read)

[UNAVAILABLE: notion — no Notion tool in this agent; run node .claude/scripts/notion-agent-tools.mjs detect, then add <id>]

No Notion search, fetch, get-comments or query tool was present in this agent's tool list, and no ToolSearch was available to load one. Nothing was searched. This is not "nothing found": the space was not read, so no finding below is evidence.

## Sources

- none read. Pages still to read once a Notion tool is available:
  - Story ST-750 — https://app.notion.com/p/3f1607bff0d2816784b9c0634b1a5b83 (and all its comments)
  - Epic Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
  - Architecture (Technology stack, operations) — https://app.notion.com/p/3ee607bff0d2813d83d0c50d0addb0d6
  - Architecture decisions — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a
  - Decisions and ideas — https://app.notion.com/p/3ee607bff0d281df9485ce97dfa3332d

## Constraints

- none found (not read). The only CI/release statements available are in the repo's AGENTS.md, which is not a Notion source and is not cited here.

## Contradictions

- none found (not read).

## Proposed Clarifications

- none from Notion. Next step: run `node .claude/scripts/notion-agent-tools.mjs detect`, add the reported connector id to the org-researcher agent, then re-run this digest in `full` mode.

## Refresh 2026-10-06

Mode: refresh, no earlier baseline (the digest above read nothing, so everything below is new). Notion was reachable this time (connector `mcp__fd62790a-…__notion-*`). The block above is kept as written and is superseded by this section.

- **Read**: story ok | feature n/a (ST-750 has no Feature relation) | epic partial (fetch exceeded the tool's size limit; seen only through search highlights, siblings found by search, not by a data-source query) | architecture ok (Architecture, Technology stack, Security/performance/operations) | decisions partial (Architecture decisions ok; "Decisions and ideas" not fetched, no hit for CI or runners in search)
- **Overall confidence**: medium

### Story changes

- **ST-750 "CI finishes faster and queues less on the free runner cap"** — Status Implementing, priority High, role System, type Task, 3 points, epic Foundations, PR https://github.com/george-hutanu/motor-fix/pull/157, Ready to work unticked. Page last edited 2026-10-06T15:46Z. [ST-750 page]
- **Comments: 0** (`notion-get-comments` returned none), so no comment moves scope. Scope per the card is its User story and "Direction": more Playwright workers on the 4-vCPU runner, small checks folded into shared jobs so `npm ci` runs fewer times, Docker layer cache shared from `main`, stacked releases collapsed to the latest, "No check is removed", runner labels and a Node matrix add no slots. [ST-750 page] (2026-10-06, high)
- The card has no Build brief, no Screens and no acceptance criteria; its evidence numbers (14 jobs, ~11 min E2E, workers 1, 178 tests, UTC 19–20 queue average 144 s and longest 30 min, ~20 own jobs running) equal spec.md's, so the spec adds nothing the card contradicts. The card and `spec.md` carry the same date (2026-10-06); no ordering between them can be shown.

### New decisions

- Railway in an EU region hosts staging and production (A16, A25, given 2026-10-03); build and release is "GitHub Actions: test, build images, deploy to staging, then to production on approval" (Proposed). Nothing on either page speaks of runner counts, caching or CI speed. [Architecture decisions; Technology stack] (page edits 2026-10-04, high)
- Promotion rule: production receives only images that passed every check and the staging end-to-end run for that same commit; a failed or skipped staging run blocks promotion. This matches FR-006 and the spec's Clarification on `images`/`staging`/`production`. [ST-421, Build brief, CI steps] (2026-10-04, high)

### New constraints

- ST-421 (Done, PR #1) fixed the release shape: images built per app, tagged with the commit SHA and "pushed to the repository's container registry (proposed: GitHub's)", then staging, then staging e2e, then production on the same digests. spec.md's cache choice (`type=gha`, no registry login) does not alter this, but the plan should not break digest promotion. [ST-421] (2026-10-04, medium)
- ST-421: "One release runs at a time, in commit order (proposed)". FR-006 (collapse to the newest pending) departs from this; see Contradictions. [ST-421] (2026-10-04, medium)
- ST-436 (Done, PR #25): docs-only PRs skip every job except the detector and `CI OK`; "If the detection job fails, `CI OK` fails: it never skips work by mistake"; on every `workflow_call` run from `release.yml` "every job runs exactly as today". Constrains FR-007/FR-009 and the edge case on `release.yml`. [ST-436] (2026-10-04, high)
- ST-663 (Done, PR #135, comment by georgeh@qlog.co 2026-10-05T14:40Z): staging e2e failed because seed accounts were missing; the release's staging job now seeds staging; "Never fixed by skipping or retrying tests, or by loosening the staging gate." Its deferred follow-up: the release and the hand-started reset use different concurrency groups, so a reset can empty staging between the release's seed and its e2e step (https://app.notion.com/p/3f0607bff0d2814f8803f741f7e0401c, 2026-10-05). Directly relevant to the new release concurrency group in FR-006: a new group must not widen that race. [ST-663; tech-debt page] (2026-10-05, high)
- ST-436/ST-435 name `CI OK` as the aggregating check, and ST-435 leaves "making CI OK a required status" to the owner. FR-007's `CI OK` and the merge gate stay compatible. [ST-435, Out of scope] (2026-10-04, high)
- Shared-state hazard for parallel runs: the mutation-score story records that the projects' tests "truncate shared tables, so parallel runners would kill each other's mutants" (ST-431 set that). It concerns Stryker, not Playwright, but it is the same class as the spec's own edge case (shared seeded account/mailbox in parallel E2E). [Measure every project's mutation score…, https://app.notion.com/p/3ef607bff0d28123bf09dc9243e3570d] (2026-10-06, low)

### Prior art

- ST-435 (Done, PR #18, High, 5 pts) created today's 14-job `ci.yml`: separate parallel jobs, `concurrency` cancelling superseded PR runs, `timeout-minutes`, `CI OK` needing every job, `nx affected` on PRs, `workflow_call` from `release.yml` running every project, mutation in its own workflow. ST-750 reshapes this layout. [ST-435] (2026-10-04)
- ST-436 (Done, PR #25): docs-only skip, see Constraints. ST-421 (Done, PR #1): monorepo, Railway, release pipeline. ST-663 (Done): staging e2e fix. "No agent holds its context across the CI and QA wait" (ST-673, 2026-10-05) depends on the CI wait and the QA run; no story found that already changes E2E workers, Docker cache scope or release concurrency. [pages above] (2026-10-05)

### New contradictions with spec.md

- **spec.md** (2026-10-06): FR-002 and Story 2 fold the quick checks into shared jobs (at most 8 jobs) — **Notion**: ST-435's acceptance criterion says `ci.yml` "runs as separate parallel jobs, each its own check: Biome, typecheck, unit tests, … dependency audit", with the user story "a reviewer sees at a glance which kind of check failed". ST-750 is newer (2026-10-06 vs 2026-10-04), so the folded layout stands and ST-435's wording is the superseded side. The spec's one-check-per-group, step-named design is the only thing preserving that "at a glance" intent. [ST-435] — newer: spec.md / ST-750.
- **spec.md** (2026-10-06): FR-006 "Of several releases waiting for their checks on `main`, only the newest MUST run its checks" — **Notion**: ST-421 "One release runs at a time, in commit order (proposed)" and "Every merge into `main`: the same checks on every project … Build one image per app". A superseded commit's checks never run and it is never deployed. ST-750 is newer and ST-421's line is only Proposed, so the spec stands; but it narrows the earlier rule from "every merge is built and staged" to "the newest pending merge is". [ST-421] — newer: spec.md.
- **spec.md** (2026-10-06): the PR-level E2E job and its "reject E2E only after merge" rationale — **Notion**: Security, performance and operations, Testing table: End to end runs "Before every release, on staging"; Technology stack: "covered end to end before every release". ST-435 (2026-10-04) later put Playwright into PR CI, so that page is stale for PRs and the spec stands. The Notion pages do not mention Principle II; that is repo-side. [Security, performance and operations (2026-10-03); ST-435] — newer: ST-435 / spec.md.
- **spec.md**: no contradiction on out-of-scope Node versions or runner labels: Technology stack and Architecture decisions fix no Node version beyond "the current long-term-support release" (ST-421 says `.nvmrc`), which agrees with "CI runs one Node, `.nvmrc` = 24". (2026-10-04, high)
- Not a contradiction with the spec, but stale in Notion: ST-421 scenario 9 and Technology stack say production deploys "on approval" of a required reviewer of the GitHub `production` environment, while AGENTS.md (repo, not a Notion source) says "no manual approval". FR-006's "production still waits for its own green staging" holds either way. [ST-421; Technology stack] (2026-10-04)

### Open decisions

- No numbered open decision or T1–T12 touches CI speed, runners or release collapsing; T10–T12 (lawyer, build team thresholds) are unrelated. [Architecture decisions] (2026-10-04)

### Proposed Clarifications (this command's proposals, not requirements)

- Should the plan note that ST-435's "each its own check" criterion is deliberately replaced by grouped jobs with one named step per check, so the next reader of ST-435 is not misled? — from ST-435 contradiction.
- Does "newest pending release" also skip the build and staging for the superseded commit, so a defect introduced by a skipped merge is first seen on the next commit's release? Is that acceptable against ST-421's "every merge runs the checks"? — from ST-421 contradiction.
- Should the release concurrency group be checked against the `reset-staging` workflow's group (the ST-663 deferred debt) so collapsing does not widen the reset race? — from ST-663 tech-debt page.
- Follow-up for the owner (not done here, this agent cannot write to Notion): comment on ST-750 pointing at spec.md's clarifications, and mark the Testing table's "before every release, on staging" line as superseded for PR CI.

### Gaps

- Epic page body not read (59 000 characters exceeded the tool limit); sibling stories were found by search, not by a stories data-source query, so an in-flight sibling touching `ci.yml` or `release.yml` could be missed.
- "Decisions and ideas" (https://app.notion.com/p/3ee607bff0d281df9485ce97dfa3332d) was not fetched.
- No Notion page holds the runner-cap evidence beyond the ST-750 card; the numbers are not independently checkable from the space.

### Sources (refresh)

- ST-750 — https://app.notion.com/p/3f1607bff0d2816784b9c0634b1a5b83
- ST-435 Run PR CI as parallel standard checks — https://app.notion.com/p/3ef607bff0d2818992b3cd348695ed53
- ST-436 Skip the build and test jobs on documentation-only PRs — https://app.notion.com/p/3ef607bff0d281aabbd3f7430ecaac0c
- ST-421 Set up the monorepo, staging and production on Railway, and the release pipeline — https://app.notion.com/p/3ee607bff0d2815a8fede068cbfbad58
- ST-663 Release fails at the staging end-to-end step — https://app.notion.com/p/3f0607bff0d281bba354c9455b804b9d
- Tech debt (ST-663) concurrency groups — https://app.notion.com/p/3f0607bff0d2814f8803f741f7e0401c
- Measure every project's mutation score… — https://app.notion.com/p/3ef607bff0d28123bf09dc9243e3570d
- Architecture — https://app.notion.com/p/3ee607bff0d2813d83d0c50d0addb0d6
- Technology stack — https://app.notion.com/p/3ee607bff0d2819ab8e3ee6926a249f2
- Architecture decisions — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a
- Security, performance and operations — https://app.notion.com/p/3ee607bff0d2810d852efa0a9346afd3
