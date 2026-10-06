# Data Model: Notion client keeps to Notion's API limits

No stored data. The three entities of the spec are in-memory state and shapes
inside `.claude/scripts/lib/notion.mjs`.

## Token bucket (pacer)

- Fields: `tat` (ms, theoretical arrival time of the next request; starts at
  0), constants `T = 1000 / 3` (emission interval) and burst tolerance `2T`
  (capacity 3).
- Rules: one per `notionClient()` instance; every request, retry and chunk
  passes it; a wait is `max(0, tat - 2T - now())` computed before `tat += T`.
- Transitions: idle (`tat <= now`) → bursting (up to 3 requests without a
  sleep) → paced (each further request sleeps until its slot).

## Retry policy

- Fields: `maxRetries` (`NOTION_SYNC_MAX_RETRIES`, default 3), `maxWaitS`
  (`NOTION_SYNC_MAX_WAIT_S`, default 60), `random` (injected), `attempt` (retries already made; 0 before the first retry).
- Retryable answer: status 429, 502, 503, 504, or 409 with code
  `conflict_error`; a `timeout` or `network error` only on `GET`.
- Wait: numeric `Retry-After` seconds (above `maxWaitS` → raise at once);
  otherwise `min(500 · 2^attempt · (1 + random()), maxWaitS · 1000)` ms.
- Validation: a non-numeric `Retry-After` counts as absent; `attempt >=
  maxRetries` → the answer surfaces as `NotionError("<status> <code>")`.

## Text chunk

- Shape: `{ type: "text", text: { content } }` with `content` of at most
  2,000 Unicode code points; an array holds at most 100 chunks.
- Validation: more than 100 chunks → `NotionError("text too long")`; the empty
  string → one empty chunk.

## Local refusals (no call sent)

| Check | Limit | Error `short` |
| --- | --- | --- |
| relation ids in `writeProp` | 100 | `relation too long` |
| rich-text chunks | 100 × 2,000 code points | `text too long` |
| UTF-8 JSON body | 500 × 1024 bytes | `body too large` |

## Client surface after the change

`notionClient({ token, fetchImpl, sleep, now, random, timeoutMs, maxRetries, maxPages, maxWaitS })`
→ `{ request, query, children, appendChildren }`; module exports gain
`richText`. `query(dataSource, body)` sends `page_size: 100` unless `body`
has one; `children(blockId)` pages with `page_size=100` under `maxPages`;
`appendChildren(blockId, children)` sends 100 per `PATCH`, in order.
