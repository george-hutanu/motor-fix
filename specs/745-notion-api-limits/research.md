# Research: Notion client keeps to Notion's API limits

No `NEEDS CLARIFICATION` remained in Technical Context: the stack is the
harness's own (plain ESM on Node, vitest), and every figure is fixed by the
story and the spec's Clarifications. The decisions below are the design the
plan commits to, each read from the code it changes.

## R1. Pacing: GCRA (virtual scheduling) over a counted token bucket

- Decision: pace `request()` with a GCRA — one `tat` (theoretical arrival
  time, ms) per client, emission interval `T = 1000 / 3` ms, burst tolerance
  `(3 - 1) · T` so capacity is 3. On each request:
  `t = now(); tat = max(tat, t); wait = max(0, tat - 2T - t); tat += T;
  if (wait > 0) await sleep(wait)`. `now` is injectable (default `Date.now`),
  like `sleep`.
- Rationale: it is the token bucket of FR-001 in four lines with no refill
  loop, and it never re-reads the clock after sleeping: the wait is computed
  once from the virtual schedule. With a `sleep` stub that only records
  (the pattern every existing spec uses:
  `.claude/scripts/lib/notion.spec.mjs:63`, `notion-sync.spec.mjs:139`) a
  counted bucket that re-checks tokens after each sleep would spin for ever,
  because a stubbed clock never refills it; the GCRA cannot. 10 requests
  issued at once compute waits of 0, 0, 0, T, 2T … 7T before any sleep
  resolves (each `request` runs synchronously to its first `await`), which
  is SC-001: 3 without a sleep, sleeps totalling 28T ≈ 9.3 s ≥ 7/3 s.
- Alternatives considered: a counted bucket with `tokens += (now - last) · 3/1000`
  on each call (rejected: needs a clock that advances on sleep in every
  spec, see R2); `setInterval` refill (rejected: a timer keeps the process
  alive and is untestable without fake timers).
- Evidence: `.claude/scripts/lib/notion.mjs:99-115` (`request`, where the
  pacing goes, before `once`); spec Clarifications (capacity 3, `now`
  injectable).

## R2. Existing specs and the pacing sleeps

- Decision: existing specs keep their `sleep: async (ms) => waits.push(ms)`
  stubs. None issues more than 3 requests from one client in a test that
  asserts on `waits`, so the burst absorbs them (`notion.spec.mjs:140-150`
  asserts `waits.length === 1` after one 429 retry: 2 requests, no pacing
  sleep; `:164-175` asserts `[]` with one request; `notion-sync.spec.mjs:571`
  asserts `[]` for `NOTION_SYNC_MAX_RETRIES=0`, which fails on its first
  answer). A new spec that issues 4 or more requests and asserts on the
  sleeps either (a) asserts the pacing sleeps explicitly (the SC-001 test) or
  (b) injects a clock that advances on sleep —
  `let t = 0; now: () => t; sleep: async (ms) => { t += ms; waits.push(ms) }`
  — so a retry after a `Retry-After` wait finds its token again and the
  retry sleeps stay distinguishable from the pacing ones.
  The `notion-sync` run fixture (`notion-sync.spec.mjs:125-148`) gains no
  assertion on sleep counts beyond line 571; its other tests issue more than
  3 calls and will record pacing sleeps they do not read.
- Rationale: nothing hangs (R1), and the tests that read `waits` stay
  truthful without rewriting them; the clock-advancing stub is the one tool
  a test needs when both kinds of sleep occur.
- Alternatives considered: making the stub advance time in every spec
  (rejected: churn in tests that do not care); exposing a `pace: false`
  knob (rejected: Principle I, a knob only tests would use).
- Evidence: `.claude/scripts/lib/notion.spec.mjs:57-80,140-175`;
  `.claude/scripts/notion-sync.spec.mjs:125-148,567-572`;
  `.claude/scripts/level.mjs:520-535` (`readStory` passes `fetchImpl` but no
  `sleep`, so a `level` spec with 4 or more requests pays a real
  333 ms wait at most once or twice; acceptable, noted for `/speckit-tests`).

## R3. Retry policy

- Decision: an answer is retryable when its status is 429, 502, 503 or 504,
  or 409 with `data.code === "conflict_error"`; `attempt < maxRetries` gates
  every retry. `Retry-After` is read as a number only when the header matches
  `/^\d+(\.\d+)?$/` (not a number → absent, per Edge Cases). With a numeric
  `Retry-After`: above `maxWaitS` → throw at once (today's behaviour,
  `notion.mjs:109`); else `sleep(ra · 1000)`. Without it:
  `wait = min(500 · 2^attempt · (1 + random()), maxWaitS · 1000)`; a wait of
  0 (`maxWaitS = 0`) skips the sleep call. `random` is injectable (default
  `Math.random`). The thrown `NotionError` keeps `short = "<status> <code>"`.
- Rationale: FR-002 and the Clarifications verbatim; the current `|| 1`
  default (`notion.mjs:108`) is the one line that changes, into the backoff.
- Alternatives considered: `Retry-After` as an HTTP date (rejected: Notion
  documents seconds; the story asks for the numeric form only).
- Evidence: `.claude/scripts/lib/notion.mjs:106-113`; header comment
  `:2-4` (429 carries `Retry-After` in seconds, checked 2026-10-05).

## R4. Timeouts and network errors retried on GET only

- Decision: `once()` keeps throwing `NotionError("timeout" | "network error")`
  (`notion.mjs:91-93`); `request()` catches it and, when
  `method === "GET"` and `attempt < maxRetries`, waits the computed backoff
  (R3, no `Retry-After`) and continues; any other method rethrows.
- Rationale: FR-003; a `POST`/`PATCH`/`DELETE` may have landed.
- Evidence: `.claude/scripts/lib/notion.mjs:76-97,101`.

## R5. Rich text splitting by code points

- Decision: export `richText(text)` from the client: `Array.from(text)` into
  chunks of 2,000 code points, each `{ type: "text", text: { content } }`;
  more than 100 chunks → `NotionError("text too long", …)`; the empty string
  → one empty object (as today). `writeProp("title" | "rich_text", v)` uses
  it; `writeProp("relation", ids)` throws `NotionError("relation too long")`
  past 100 ids. `notion-sync` posts a comment through one local
  `comment(client, pageId, body)` helper: `Array.from(body).length <= 2000`
  → `{ markdown: body }` as today; else `{ rich_text: richText(body) }`.
- Rationale: FR-004 to FR-006 and the code-point Clarification;
  `Array.from` iterates by code point, so a surrogate pair is never cut.
  Three call sites post comments (`notion-sync.mjs:270,326,392`), which is
  what the helper removes.
- Alternatives considered: splitting the `markdown` body itself (rejected by
  the Clarification: the story names `writeProp` and comments; `markdown`'s
  limit is unverified while `rich_text`'s is documented).
- Evidence: `.claude/scripts/lib/notion.mjs:157-171`;
  `.claude/scripts/notion-sync.mjs:270,326,392,419,422`.

## R6. Block children: append in chunks, read with `page_size=100` from the client

- Decision: add `appendChildren(blockId, children)` to the client: slices of
  100, each `PATCH /blocks/{id}/children { children }`, in order, results
  concatenated. Move `level.mjs`'s `childrenOf` into the client as
  `children(blockId)`: the same loop as `query()` (cursor, `maxPages`,
  `"too many pages"`), over `GET /blocks/{id}/children?page_size=100`;
  `level.mjs` calls `client.children(id)` and drops the `paging` object it
  threads through `briefOf`. `query()` sends `{ page_size: 100, ...body }`
  so a caller's own `page_size` wins (the smoke check at
  `notion-sync.mjs:226` goes through `request` directly and is untouched).
- Rationale: FR-007 and FR-008; moving the read removes a second paging loop
  and the `{ maxPages, NotionError }` parameter from `level.mjs:483-535`,
  which is the duplication the story names. No caller appends children
  today, so the helper's spec is its only consumer (spec Assumptions).
- Alternatives considered: leaving `childrenOf` in `level.mjs` (rejected:
  two paging loops with two caps once `query` is the model).
- Evidence: `.claude/scripts/level.mjs:483-494,502,526,535`;
  `.claude/scripts/lib/notion.mjs:117-130`.

## R7. 500 KB body check before pacing

- Decision: in `request()`, before the pacer:
  `if (body !== undefined && Buffer.byteLength(JSON.stringify(body)) > 500 * 1024) throw new NotionError("body too large", …)`;
  the serialised string is passed down so `once()` does not serialise twice.
- Rationale: FR-007 and the Edge Case: a refused body costs no token and no
  call.
- Evidence: `.claude/scripts/lib/notion.mjs:85` (the one `JSON.stringify`).

## R8. Test runner and the doctor

- Decision: specs are vitest (`vitest` 5.0.3, `package-lock.json:28376`),
  run with `npm run test:harness` (`package.json:101`,
  `.claude/vitest.config.ts`: `**/*.spec.mjs` under `.claude/`). Node is
  26.5.0 locally, `engines.node >= 24` (`package.json:84-85`).
  `notion.mjs`, `notion-sync.mjs` and `level.mjs` are not hook scripts, so
  `doctor.mjs` needs no `--bless-hooks`; it runs anyway at the end of
  implement (SC-005) and is blessed only if it names a fingerprint.
- Evidence: `package.json:78-101`, `package-lock.json:28376-28378`,
  `.claude/vitest.config.ts`, `.claude/hooks/registry.json` (no entry for
  the three files; checked by `grep -c notion .claude/hooks/registry.json`
  during implement).
