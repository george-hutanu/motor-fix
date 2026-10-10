// A small GitHub client for the tracker scripts: REST under the repository,
// GraphQL, pacing of content-creating requests under GitHub's secondary
// limits (500 an hour), and the waits GitHub asks for when it throttles.
// A relative REST path resolves under the issue repository (repos.mjs).

import { NOTION_URL } from "./notion-markdown.mjs";
import { ISSUE_REPO, OWNER } from "./repos.mjs";

/** Each Notion address in a request's JSON, whole, so one held address cannot stand in for another. */
const notionAddresses = (json) => (json.match(/[^\s"\\<>()[\]]+/g) ?? []).filter((t) => NOTION_URL.test(t));

/** Whether `json` names a Notion address beyond those `kept` (text GitHub already holds) names. */
function addsNotion(json, kept) {
  const held = notionAddresses(JSON.stringify(kept));
  for (const address of notionAddresses(json)) {
    const at = held.indexOf(address);
    if (at === -1) return true;
    held.splice(at, 1);
  }
  return false;
}

const API = "https://api.github.com";
export const PACE_MS = 7200;
const SERVER_RETRY_MS = 2000;
/** Each try of a request, the answer's body included. */
export const TIMEOUT_MS = 60_000;
/** Tries of one request on a timeout, a network error or a 5xx. */
export const TRIES = 3;
const SECONDARY_WAIT_MS = 60_000;
const MAX_THROTTLES = 5;
/** The most pages one list is followed through: a Link or cursor that never ends stops here. */
export const MAX_PAGES = 50;

export class GitHubError extends Error {
  constructor(type, message) {
    super(message);
    this.type = type;
  }

  /** A failure that a later try may not meet: no answer, a dropped connection or a server error. */
  get transient() {
    return this.type === "network" || this.type === "timeout" || /^5\d\d$/.test(this.type);
  }
}

/** `work(signal)` raced against a timer that aborts it: a stalled socket cannot hang the run. */
async function timed(ms, label, work) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new GitHubError("timeout", `${label}: no answer within ${Math.round(ms / 1000)} s`));
    }, ms);
  });
  try {
    return await Promise.race([work(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function githubClient({
  token,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
  owner = OWNER,
  repo = ISSUE_REPO,
  maxWaitS = 120,
  timeoutMs = TIMEOUT_MS,
  paceMs = PACE_MS,
  log,
}) {
  const scrub = (text) => String(text).replaceAll(token, "[token]");
  const stats = { content: 0 };
  let lastContent = Number.NEGATIVE_INFINITY;

  /** The URL for a path; an absolute URL only on api.github.com, so the token never goes elsewhere. */
  function urlOf(path) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
      if (!path.startsWith(`${API}/`)) throw new GitHubError("host", `refused to follow ${new URL(path).origin}: only ${API} is called`);
      return path;
    }
    return path.startsWith("/") ? `${API}${path}` : `${API}/repos/${owner}/${repo}/${path}`;
  }

  /** The wait GitHub asks for in ms, or null when the response is no rate limit. */
  function throttleWait(response, data) {
    if (response.status !== 403 && response.status !== 429) return null;
    const after = response.headers.get("retry-after");
    if (after !== null && /^\d+$/.test(after.trim())) return Number(after) * 1000;
    if (response.headers.get("x-ratelimit-remaining") === "0") {
      return Math.max(0, Number(response.headers.get("x-ratelimit-reset")) * 1000 - now());
    }
    // A secondary limit without Retry-After: GitHub's docs say wait at least a minute.
    if (after === null && /secondary rate limit/i.test(data?.message ?? "")) return SECONDARY_WAIT_MS;
    return null;
  }

  /**
   * `idempotent`: a write that is safe to send again (a PATCH, a field set, an
   * add that GitHub refuses with 422 once it holds it), so a network error, a
   * timeout or a 5xx is tried TRIES times like a read. A 422 to a try after one
   * whose answer was lost means the earlier try landed.
   */
  async function send(method, path, body, content, idempotent = !content, kept = "") {
    const label = `${method} ${path}`;
    if (body !== undefined && addsNotion(JSON.stringify(body), kept)) throw new GitHubError("notion", `${label}: refused, the request names a Notion address`);
    const url = urlOf(path);
    if (content) stats.content++;
    let lost = false;
    for (let failures = 0, throttles = 0; ; ) {
      if (content) {
        const wait = lastContent + paceMs - now();
        if (wait > 0) await sleep(wait);
        lastContent = now();
      }
      let response;
      let text;
      try {
        ({ response, text } = await timed(timeoutMs, label, (signal) =>
          fetchImpl(url, {
            method,
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
              "User-Agent": "motor-fix-tracker",
              ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal,
          }).then(async (r) => ({ response: r, text: await r.text() })),
        ));
      } catch (error) {
        const timedOut = error instanceof GitHubError;
        const failure = timedOut ? error : new GitHubError("network", scrub(`${label}: ${error?.message ?? error}`));
        // A write that timed out may have landed: only a read (or a GraphQL query) is sent again; a resumed run replans from GitHub.
        if (!idempotent || ++failures >= TRIES) throw failure;
        lost = true;
        await sleep(SERVER_RETRY_MS * 2 ** (failures - 1));
        continue;
      }
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        // An HTML error page from a proxy: no data, and the status decides.
        if (response.ok) throw new GitHubError("parse", scrub(`${label}: ${response.status}, the answer is not JSON`));
      }
      if (response.ok) return { data, response };
      if (lost && content && idempotent && response.status === 422) return { data: null, response };
      const wait = throttleWait(response, data);
      if (wait !== null) {
        if (++throttles > MAX_THROTTLES) throw new GitHubError("rate limit", scrub(`${label}: ${response.status}, still throttled after ${MAX_THROTTLES} waits`));
        if (wait > maxWaitS * 1000) throw new GitHubError("rate limit", scrub(`${label}: ${response.status}, GitHub asks to wait ${Math.ceil(wait / 1000)} s (over ${maxWaitS} s)`));
        if (wait > 10_000) log?.(`wait      ${Math.ceil(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      // A write that failed with a 5xx may still have landed: it is sent once more at most, a read up to TRIES times.
      if (response.status >= 500 && ++failures < (content && !idempotent ? 2 : TRIES)) {
        lost = true;
        const after = response.headers.get("retry-after");
        await sleep(after !== null && /^\d+$/.test(after.trim()) ? Math.min(Number(after), maxWaitS) * 1000 : SERVER_RETRY_MS * 2 ** (failures - 1));
        continue;
      }
      throw new GitHubError(String(response.status), scrub(`${label}: ${response.status} ${data?.message ?? ""}`.trim()));
    }
  }

  /**
   * A REST call; a PATCH is idempotent, a POST only when the caller says so (`{ idempotent: true }`).
   * `kept`: text GitHub already holds that the call sends back (a PR body), whose Notion addresses may go back; none may be added.
   */
  const rest = async (method, path, body, { idempotent = method === "GET" || method === "PATCH", kept = "" } = {}) =>
    (await send(method, path, body, method !== "GET", idempotent, kept)).data;

  /** Every page of a REST list, following the Link header. */
  async function pages(path) {
    const all = [];
    for (let next = path, page = 0; next; ) {
      if (++page > MAX_PAGES) throw new GitHubError("pages", scrub(`GET ${path}: more than ${MAX_PAGES} pages`));
      const { data, response } = await send("GET", next, undefined, false);
      all.push(...data);
      next = response.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
    }
    return all;
  }

  async function graphql(query, variables, { idempotent = false } = {}) {
    const mutation = /^\s*mutation\b/.test(query);
    const { data } = await send("POST", "/graphql", { query, variables }, mutation, !mutation || idempotent);
    if (data?.errors?.length) {
      throw new GitHubError(data.errors[0].type ?? "GRAPHQL", scrub(data.errors.map((e) => `${e.type ?? "error"}: ${e.message}`).join("; ")));
    }
    if (!data?.data) throw new GitHubError("parse", scrub(`POST /graphql: ${data === null ? "an empty answer" : "an answer with no data"}`));
    return data.data;
  }

  return { rest, pages, graphql, stats };
}
