# Feature Specification: Notion client keeps to Notion's API limits

**Feature Branch**: `745-notion-api-limits`

**Created**: 2026-10-06

**Status**: Archived (2026-10-06)

**Input**: User description: "ST-745 "Make the Notion client keep to Notion's API limits" https://app.notion.com/p/3f1607bff0d2813ca3a7ded4339646b6"

**Story**: ST-745 — https://app.notion.com/p/3f1607bff0d2813ca3a7ded4339646b6 (the
acceptance criteria below are the story page's, read on 2026-10-06).

**Scope**: the shared harness client `.claude/scripts/lib/notion.mjs` and its
callers (`.claude/scripts/notion-sync.mjs`, `.claude/scripts/level.mjs`) keep to
Notion's documented request limits, so a burst of calls or a long text never
fails a sync. Out of scope: the connector (MCP) path and its query quota; any
caller outside those three files; any new sync behaviour.

**Test constraint** (story, Constitution II): every behaviour below gets a
vitest spec first, with an injected `fetchImpl` and `sleep` and no real
network; the harness specs stay green and `node .claude/scripts/doctor.mjs`
passes (bless only after reading the diff).

## Clarifications

### Session 2026-10-06

- Q: Does the over-2,000 fallback also apply to the `markdown` body of `POST /pages` (the `debt` task)? → A: No; the story names `writeProp` and comments only, so the page body keeps `markdown` and gets only the 500 KB check (owner: scope as the story, no extras).
- Q: When the client's own computed backoff exceeds `NOTION_SYNC_MAX_WAIT_S`, does it clamp or give up? → A: Clamp the computed backoff to the cap and keep retrying; give up at once only when a server `Retry-After` exceeds the cap. `NOTION_SYNC_MAX_WAIT_S=0` retries without waiting.
- Q: What is the token bucket's capacity? → A: 3 (one second's allowance): of 10 requests at once, 3 go out without a sleep and the requested sleeps total at least 7/3 s.
- Q: Which unit does the 2,000-character limit count? → A: Unicode code points (`Array.from(text)`), so a surrogate pair is never cut.
- Q: How is the jitter made testable? → A: `random` is injectable like `sleep` (default `Math.random`), and so is the clock `now` (default `Date.now`); a backoff wait for attempt *a* is `500 ms · 2^a · (1 + random())`, i.e. within [500·2^a, 1000·2^a] ms, then clamped to the cap.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A burst of syncs is paced, and transient failures are retried (Priority: P1)

Several story runs sync Notion at once (`start`, `pr`, `qa`, `finish`, `debt`,
`notion-ready`). Today each request goes out immediately and only a 429 is
retried; a 502/503/504 or a 409 conflict fails the sync outright, and a burst
of 429s can exhaust the retries. The client should pace its own requests to
Notion's average of 3 per second per integration (bursts allowed) and retry
the transient answers with backoff, within the caps the owner already sets.

**Why this priority**: every lifecycle step writes to Notion; a sync that fails
on a transient answer leaves the tracker behind the build and is retried by
hand on the next run.

**Independent Test**: with an injected `fetchImpl` and `sleep`, fire 10
requests at once and read the sleep calls; answer 503 then 200 and read the
retry; answer 429 with `Retry-After` and read the wait.

**Acceptance Scenarios**:

1. **Given** a client with a fresh token bucket (capacity 3), **When** 10 requests are issued at once, **Then** the first 3 go out immediately (the burst) and the rest are delayed so that the sustained rate is at most 3 per second, with no 429 needed to slow down.
2. **Given** a request answered 429 with `Retry-After: 2`, **When** retries remain, **Then** the client sleeps 2 s and sends the request again.
3. **Given** a request answered 503 (or 502, 504, or 409 `conflict_error`) with no `Retry-After`, **When** retries remain, **Then** the client waits `500 ms · 2^attempt · (1 + random())` (clamped to `NOTION_SYNC_MAX_WAIT_S`; `attempt` counts retries already made, so it is 0 before the first retry) and sends it again.
4. **Given** `NOTION_SYNC_MAX_RETRIES=1`, **When** a request is answered 503 twice, **Then** the second answer surfaces as a `NotionError` named `503 …`.
5. **Given** a server `Retry-After` above `NOTION_SYNC_MAX_WAIT_S`, **When** the answer is retryable, **Then** the client does not wait and raises the `NotionError` at once (today's behaviour, kept); a computed backoff above the cap is clamped to it instead.
6. **Given** a `GET` that times out or fails on the network, **When** retries remain, **Then** it is sent again; **Given** a `POST`, `PATCH` or `DELETE` that times out or fails on the network, **Then** it is not sent again and the `NotionError` (`timeout` / `network error`) surfaces.
7. **Given** a request answered 400, 401, 403, 404 or 500, **When** it fails, **Then** it is not retried (unchanged).

---

### User Story 2 - A long text or a big relation never breaks a write (Priority: P2)

A finish comment or a long property value can exceed
Notion's 2,000 characters per rich-text object, and an epic's story list can
exceed 100 relation ids. Today such a write is sent as one object and refused
by Notion. The client should split text into objects of at most 2,000
characters (at most 100 per array), refuse a relation over 100 ids locally,
append block children 100 per request, and refuse a body over 500 KB before
sending it.

**Why this priority**: it is the second way a sync fails (after transient
answers), and it fails deterministically on the longest texts, which are the
finish comments the owner reads.

**Independent Test**: call `writeProp("rich_text", 5,000 chars)` and count
the objects and their lengths; post a comment of 3,000 characters through
`notion-sync` with an injected `fetchImpl` and read the body it sent; call
`writeProp("relation", 101 ids)` and read the error.

**Acceptance Scenarios**:

1. **Given** a `title` or `rich_text` value of 5,000 characters, **When** `writeProp` shapes it, **Then** the array holds 3 objects of 2,000, 2,000 and 1,000 characters, in order, whose concatenation is the original text.
2. **Given** a text that would need more than 100 objects (over 200,000 characters), **When** `writeProp` shapes it, **Then** it raises a `NotionError` naming the limit rather than sending a truncated array.
3. **Given** a comment body of 3,000 characters, **When** `notion-sync` posts it, **Then** the request carries `rich_text` objects of at most 2,000 code points each, in order; **Given** a body of at most 2,000 code points, **Then** it is posted as `markdown` as today.
4. **Given** a relation value of 101 ids, **When** `writeProp` shapes it, **Then** it raises a `NotionError` naming the 100-id limit; **Given** 100 ids, **Then** all 100 are sent.
5. **Given** 250 block children handed to the client's append helper, **When** it runs, **Then** it sends three requests of 100, 100 and 50 children, in order, to the same block.
6. **Given** a request whose JSON body is over 500 KB (500 × 1024 bytes, UTF-8), **When** it is issued, **Then** no call reaches `fetchImpl` and a `NotionError` names the size limit.

---

### User Story 3 - Reads page explicitly (Priority: P3)

A data-source query or a block-children read should ask for Notion's maximum
page of 100 explicitly, so a sync over a large epic takes the fewest calls and
the paging cap (`NOTION_SYNC_MAX_PAGES`) means a known number of rows.

**Why this priority**: it is a one-line change per call; it reduces the
request count the rate limit is spent on.

**Independent Test**: run `query()` with an injected `fetchImpl` and read the
body of each page request.

**Acceptance Scenarios**:

1. **Given** a `query()` over a data source, **When** each page is requested, **Then** the body carries `page_size: 100` alongside the caller's filter and the cursor.
2. **Given** a caller that passes its own `page_size` (today `page_size: 1` for the smoke check), **When** the request is sent, **Then** the caller's value wins.
3. **Given** a block-children read in `level.mjs`, **When** it is sent, **Then** it carries `page_size=100` (already true today; kept under test).

---

### Edge Cases

- A 429 without `Retry-After`: backed off like a 503 (exponential with jitter), not a fixed 1 s.
- `Retry-After` present but not a number (an HTTP date included) or negative: treated as absent; `Retry-After: 0` retries at once, still through the pacing.
- `NOTION_SYNC_MAX_RETRIES=0`: no retry of any kind; the first failing answer surfaces.
- A multi-byte character at a 2,000-character boundary: the split counts Unicode code points, never cutting a surrogate pair.
- An empty text or an empty relation: one empty object / an empty array, as today.
- The token bucket is per client instance (one process, one integration token); two processes still share Notion's quota and rely on the 429 retry for that.
- Every retry and every chunk still passes through the pacing, so a retried burst does not exceed the rate.
- The 500 KB check runs on the serialised body before any wait, so a refused body costs no bucket token.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The client MUST pace its outgoing requests with a shared token bucket so that the sustained rate is at most 3 requests per second per client, allowing a burst up to the bucket's capacity of 3, independent of any 429 answer; the clock (`now`) is injectable.
- **FR-002**: The client MUST retry an answer of 429, 502, 503, 504, or 409 with code `conflict_error`, honouring a numeric `Retry-After` when present (raising at once when it exceeds `NOTION_SYNC_MAX_WAIT_S`, as today) and otherwise waiting `500 ms · 2^attempt · (1 + random())` clamped to `NOTION_SYNC_MAX_WAIT_S`, with `random` injectable; `NOTION_SYNC_MAX_RETRIES` caps the attempts.
- **FR-003**: The client MUST retry a timeout or network error on `GET` under the same caps, and MUST NOT retry one on `POST`, `PATCH` or `DELETE`.
- **FR-004**: `writeProp` MUST split a `title` or `rich_text` value into objects of at most 2,000 Unicode code points, at most 100 objects per array, and MUST raise a `NotionError` for a text that cannot fit; the same splitter is exported for comments.
- **FR-005**: `notion-sync` MUST post a comment body over 2,000 code points as `rich_text` objects produced by the shared splitter, and MAY keep posting a body of at most 2,000 code points as `markdown`.
- **FR-006**: `writeProp` MUST raise a `NotionError` for a relation of more than 100 ids, never truncating it.
- **FR-007**: The client MUST expose a block-children append helper that sends at most 100 children per request, in order, and MUST refuse locally, with a `NotionError` and no call, any request whose UTF-8 JSON body exceeds 500 × 1024 bytes.
- **FR-008**: `query()` MUST send `page_size: 100` on every page request unless the caller supplies its own `page_size`; the block-children read in `level.mjs` MUST keep sending `page_size=100`.

### Key Entities

- **Token bucket**: the client's pacing state — capacity (the allowed burst), refill rate (3 per second), and the current token count; one per client instance.
- **Retry policy**: which answers are retried (status, code, method), the wait between attempts (`Retry-After`, else backoff with jitter), and the caps (`NOTION_SYNC_MAX_RETRIES`, `NOTION_SYNC_MAX_WAIT_S`).
- **Text chunk**: one rich-text object of at most 2,000 characters; an array holds at most 100 of them.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 10 requests issued at once by one client complete without a 429 being needed to pace them: 3 go out without a sleep and the requested sleeps total at least 7/3 s (verified with injected `sleep` and `now`).
- **SC-002**: A sync whose one request is answered 503, 502, 504, 409 `conflict_error` or 429 once and then 200 completes with no error, within the existing retry and wait caps.
- **SC-003**: A comment of 3,000 characters and a property of 5,000 characters reach Notion as objects of at most 2,000 characters each; no sync fails on text length.
- **SC-004**: A relation of over 100 ids and a body over 500 KB are refused locally with a named `NotionError` and zero calls sent.
- **SC-005**: Every page request of a query carries `page_size: 100`; the harness specs and `doctor.mjs` pass on the branch.

## Assumptions

- (autonomous default) Comments: a body of at most 2,000 characters is still posted as `markdown` (the finish comment is a markdown list the owner reads in Notion); a longer body is posted as `rich_text` split by the shared splitter, since whether Notion's `markdown` comment field carries the same 2,000-character limit is unverified and `rich_text` is documented. Markdown formatting degrades to plain text only for bodies over 2,000 characters.
- (autonomous default) A relation over 100 ids is refused with a `NotionError` rather than silently truncated: a partial epic link is worse than a visible failure.
- (autonomous default) A timeout or network error on `POST`, `PATCH` or `DELETE` is not retried (the write may have landed); on `GET` it is retried under the same caps.
- (autonomous default) The block-children append helper chunks by 100 and is exported from the client for callers; none calls it today, so its test is the only consumer in this feature.
- (autonomous default) 500 KB means 500 × 1024 bytes of the UTF-8 JSON body; the check runs before pacing and before any call.
- (autonomous default) Token-bucket capacity 3 and backoff base 500 ms (see Clarifications); the sustained rate (3/s), the retry set, and the two existing caps are fixed by the story.
- (autonomous default) The page-create call in `notion-sync` (`POST /pages` with a `markdown` body for a deferred task) is unchanged apart from the 500 KB body check; its property writes go through `writeProp` and get the splitter.
- The 2,000-character, 100-object, 100-id, 100-children and 500 KB figures are Notion's documented request limits; the rate of 3 per second is Notion's documented average.

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008
- **Modifies**: none
- **Removes**: none

The capability holds no requirement on the Notion client's request limits today: the client of ST-687 paced nothing and retried only a 429.
