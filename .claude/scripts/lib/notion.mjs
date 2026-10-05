// A small Notion API client for the harness scripts: plain fetch, no SDK.
// Checked against developers.notion.com on 2026-10-05: API version
// 2026-03-11, data sources queried with POST /v1/data_sources/{id}/query,
// and a 429 `rate_limited` answer carrying Retry-After in seconds.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseEnv } from "node:util";

export const NOTION_API = "https://api.notion.com/v1";
export const NOTION_VERSION = "2026-03-11";
const MAX_RETRIES = 3;
const TIMEOUT_MS = 30_000;

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

export function notionClient({ token, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), timeoutMs = TIMEOUT_MS }) {
  const scrub = (text) => String(text).replaceAll(token, "[token]");

  async function once(method, path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(`${NOTION_API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new NotionError("timeout", `${method} ${path} timed out after ${timeoutMs} ms`);
      throw new NotionError("network error", scrub(`${method} ${path}: ${error?.message ?? error}`));
    } finally {
      clearTimeout(timer);
    }
  }

  async function request(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      const response = await once(method, path, body);
      const data = await response.json().catch(() => ({}));
      if (response.ok) return data;
      const short = `${response.status} ${data.code ?? "error"}`;
      if (response.status === 429 && attempt < MAX_RETRIES) {
        await sleep((Number(response.headers.get("Retry-After")) || 1) * 1000);
        continue;
      }
      throw new NotionError(short, scrub(`${method} ${path}: ${short}: ${data.message ?? ""}`));
    }
  }

  /** Every page of a data source query. */
  async function query(dataSource, body = {}) {
    const results = [];
    let cursor;
    do {
      const page = await request("POST", `/data_sources/${dataSource}/query`, cursor ? { ...body, start_cursor: cursor } : body);
      results.push(...page.results);
      cursor = page.has_more ? page.next_cursor : undefined;
    } while (cursor);
    return results;
  }

  return { request, query };
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

/** The request shape that writes `value` into a property of `type`. */
export function writeProp(type, value) {
  switch (type) {
    case "select":
    case "status":
      return { [type]: { name: value } };
    case "title":
    case "rich_text":
      return { [type]: [{ type: "text", text: { content: value } }] };
    case "relation":
      return { relation: value.map((id) => ({ id })) };
    default:
      return { [type]: value };
  }
}
