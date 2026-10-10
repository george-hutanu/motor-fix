// The owner's final import only: deleted after it runs (george-hutanu/motor-fix-specs#1119).
// A small Notion API client for the harness scripts: plain fetch, no SDK.
// Checked against developers.notion.com on 2026-10-05: API version
// 2026-03-11, data sources queried with POST /v1/data_sources/{id}/query,
// and a 429 `rate_limited` answer carrying Retry-After in seconds. Request
// limits (developers.notion.com › Request limits): an average of 3 requests a
// second per integration, 2,000 characters per rich-text object, 100 items per
// array, 100 children per append, and a 500 KB body.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseEnv } from "node:util";

export const NOTION_API = "https://api.notion.com/v1";
export const NOTION_VERSION = "2026-03-11";
const MAX_RETRIES = 3;
const TIMEOUT_MS = 30_000;
const MAX_PAGES = 100;
const MAX_WAIT_S = 60;
const PER_SECOND = 3;
const BURST = 3;
const BACKOFF_MS = 500;
const MAX_BODY_BYTES = 500 * 1024;
const MAX_TEXT = 2000;
const MAX_ITEMS = 100;
const RETRIED = new Set([429, 502, 503, 504]);

/** A failed call, named by `short` (`429 rate_limited`, `timeout`); it never carries the token. */
export class NotionError extends Error {
  constructor(short, message) {
    super(message);
    this.name = "NotionError";
    this.short = short;
  }
}

const tokenFrom = (file) => {
  try {
    return existsSync(file) ? (parseEnv(readFileSync(file, "utf8")).NOTION_TOKEN ?? "") : "";
  } catch {
    return "";
  }
};

/** The token from the environment, the repo's .env, or (in a worktree) the main checkout's .env. */
export function notionToken(repo, env = process.env) {
  if (env.NOTION_TOKEN) return env.NOTION_TOKEN;
  const own = tokenFrom(join(repo, ".env"));
  if (own) return own;
  try {
    const common = execFileSync("git", ["-C", repo, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return basename(common) === ".git" ? tokenFrom(join(dirname(common), ".env")) : "";
  } catch {
    return "";
  }
}

const whole = (value, fallback, min) => (/^\d+$/.test(String(value ?? "")) && Number(value) >= min ? Number(value) : fallback);

/** The client's limits from NOTION_SYNC_TIMEOUT_MS, _MAX_RETRIES, _MAX_PAGES and _MAX_WAIT_S, or the defaults. */
export function clientLimits(env = process.env) {
  return {
    timeoutMs: whole(env.NOTION_SYNC_TIMEOUT_MS, TIMEOUT_MS, 1),
    maxRetries: whole(env.NOTION_SYNC_MAX_RETRIES, MAX_RETRIES, 0),
    maxPages: whole(env.NOTION_SYNC_MAX_PAGES, MAX_PAGES, 1),
    maxWaitS: whole(env.NOTION_SYNC_MAX_WAIT_S, MAX_WAIT_S, 0),
  };
}

const UNPARSED = Symbol("unparsed");

export function notionClient({
  token,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
  random = Math.random,
  timeoutMs = TIMEOUT_MS,
  maxRetries = MAX_RETRIES,
  maxPages = MAX_PAGES,
  maxWaitS = MAX_WAIT_S,
  version = NOTION_VERSION,
}) {
  const scrub = (text) => String(text).replaceAll(token, "[token]");
  const interval = 1000 / PER_SECOND;
  let due = 0;

  /** A slot every third of a second, BURST of them at once (GCRA); the wait is reckoned once, before sleeping. */
  async function pace() {
    const t = now();
    due = Math.max(due, t);
    const wait = due - (BURST - 1) * interval - t;
    due += interval;
    if (wait > 0) await sleep(wait);
  }

  const backoff = (attempt) => Math.min(BACKOFF_MS * 2 ** attempt * (1 + random()), maxWaitS * 1000);
  const retryAfter = (response) => {
    const raw = String(response.headers?.get?.("Retry-After") ?? "").trim();
    return /^\d+$/.test(raw) ? Number(raw) : null;
  };

  /** One call, the body read included: the timeout covers both. */
  async function once(method, path, payload) {
    const controller = new AbortController();
    const aborted = new Promise((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    aborted.catch(() => {});
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const call = fetchImpl(`${NOTION_API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Notion-Version": version, "Content-Type": "application/json" },
        body: payload,
        signal: controller.signal,
      });
      const response = await Promise.race([call, aborted]);
      const data = await Promise.race([response.json().catch(() => UNPARSED), aborted]);
      return { response, data };
    } catch (error) {
      if (controller.signal.aborted) throw new NotionError("timeout", `${method} ${path} timed out after ${timeoutMs} ms`);
      throw new NotionError("network error", scrub(`${method} ${path}: ${error?.message ?? error}`));
    } finally {
      clearTimeout(timer);
    }
  }

  async function request(method, path, body) {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const bytes = payload === undefined ? 0 : Buffer.byteLength(payload);
    if (bytes > MAX_BODY_BYTES) {
      throw new NotionError("body too large", `${method} ${path}: a ${bytes}-byte body is over Notion's 500 KB limit`);
    }
    for (let attempt = 0; ; attempt++) {
      await pace();
      let answer;
      try {
        answer = await once(method, path, payload);
      } catch (error) {
        // A write that timed out may have landed: only a read is sent again.
        if (method !== "GET" || attempt >= maxRetries) throw error;
        const wait = backoff(attempt);
        if (wait > 0) await sleep(wait);
        continue;
      }
      const { response, data: parsed } = answer;
      if (response.ok && (parsed === UNPARSED || parsed === null || typeof parsed !== "object")) {
        throw new NotionError("bad response", `${method} ${path}: ${response.status} with a body that is not a JSON object`);
      }
      if (response.ok) return parsed;
      const data = parsed === UNPARSED || parsed === null || typeof parsed !== "object" ? {} : parsed;
      const short = `${response.status} ${data.code ?? "error"}`;
      const retryable = RETRIED.has(response.status) || (response.status === 409 && data.code === "conflict_error");
      const after = retryAfter(response);
      if (retryable && attempt < maxRetries && (after === null || after <= maxWaitS)) {
        const wait = after === null ? backoff(attempt) : after * 1000;
        if (wait > 0) await sleep(wait);
        continue;
      }
      throw new NotionError(short, scrub(`${method} ${path}: ${short}: ${data.message ?? ""}`));
    }
  }

  /** Every page of a list, `maxPages` at most. */
  async function paged(label, pageAt) {
    const results = [];
    let cursor;
    let pages = 0;
    do {
      if (++pages > maxPages) throw new NotionError("too many pages", `${label} passed ${maxPages} pages`);
      const page = await pageAt(cursor);
      if (!Array.isArray(page.results)) throw new NotionError("bad response", `${label} answered without a results list`);
      results.push(...page.results);
      cursor = page.has_more ? page.next_cursor : undefined;
    } while (cursor);
    return results;
  }

  /** Every row of a data source query, 100 a page unless the body asks otherwise. */
  const query = (dataSource, body = {}) =>
    paged(`${dataSource} query`, (cursor) =>
      request("POST", `/data_sources/${dataSource}/query`, { page_size: MAX_ITEMS, ...body, ...(cursor ? { start_cursor: cursor } : {}) }),
    );

  /** Every child block of a block or page, 100 a page. */
  const children = (blockId) =>
    paged(`${blockId} children`, (cursor) =>
      request("GET", `/blocks/${blockId}/children?page_size=${MAX_ITEMS}${cursor ? `&start_cursor=${cursor}` : ""}`),
    );

  /** Appends `blocks` under a block, 100 a request, in order. */
  async function appendChildren(blockId, blocks) {
    const results = [];
    for (let i = 0; i < blocks.length; i += MAX_ITEMS) {
      const answer = await request("PATCH", `/blocks/${blockId}/children`, { children: blocks.slice(i, i + MAX_ITEMS) });
      results.push(...(answer.results ?? []));
    }
    return results;
  }

  return { request, query, children, appendChildren };
}

const text = (parts) => (parts ?? []).map((p) => p.plain_text ?? p.text?.content ?? "").join("");

/** A property's value in plain form, or null when the page lacks it. */
export function readProp(page, name) {
  const prop = page?.properties?.[name];
  if (!prop) return null;
  switch (prop.type) {
    case "select":
    case "status":
      return prop[prop.type]?.name ?? null;
    case "unique_id":
      return prop.unique_id.prefix ? `${prop.unique_id.prefix}-${prop.unique_id.number}` : String(prop.unique_id.number);
    case "title":
    case "rich_text":
      return text(prop[prop.type]);
    case "relation":
      return prop.relation.map((r) => r.id);
    default:
      return prop[prop.type] ?? null;
  }
}

/** A text as rich-text objects of at most 2,000 code points each, 100 at most. */
export function richText(value) {
  const points = Array.from(String(value));
  const parts = [];
  for (let i = 0; i < points.length; i += MAX_TEXT) parts.push(points.slice(i, i + MAX_TEXT).join(""));
  if (parts.length > MAX_ITEMS) throw new NotionError("text too long", `a ${points.length}-character text needs more than ${MAX_ITEMS} objects of ${MAX_TEXT}`);
  return (parts.length ? parts : [""]).map((content) => ({ type: "text", text: { content } }));
}

/** The request shape that writes `value` into a property of `type`. */
export function writeProp(type, value) {
  switch (type) {
    case "select":
    case "status":
      return { [type]: { name: value } };
    case "title":
    case "rich_text":
      return { [type]: richText(value) };
    case "relation":
      if (value.length > MAX_ITEMS) throw new NotionError("relation too long", `a relation of ${value.length} ids is over Notion's ${MAX_ITEMS}`);
      return { relation: value.map((id) => ({ id })) };
    default:
      return { [type]: value };
  }
}
