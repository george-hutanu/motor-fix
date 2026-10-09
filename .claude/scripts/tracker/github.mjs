// A small GitHub client for the tracker scripts: REST under the repository,
// GraphQL, pacing of content-creating requests under GitHub's secondary
// limits (500 an hour), and the waits GitHub asks for when it throttles.

const API = "https://api.github.com";
export const PACE_MS = 7200;
const SERVER_RETRY_MS = 2000;

export class GitHubError extends Error {
  constructor(type, message) {
    super(message);
    this.type = type;
  }
}

export function githubClient({
  token,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
  owner = "george-hutanu",
  repo = "motor-fix",
  maxWaitS = 120,
  log,
}) {
  const scrub = (text) => String(text).replaceAll(token, "[token]");
  const stats = { content: 0 };
  let lastContent = Number.NEGATIVE_INFINITY;

  const urlOf = (path) => (path.startsWith("http") ? path : path.startsWith("/") ? `${API}${path}` : `${API}/repos/${owner}/${repo}/${path}`);

  /** The wait GitHub asks for in ms, or null when the response is no rate limit. */
  function throttleWait(response) {
    if (response.status !== 403 && response.status !== 429) return null;
    const after = response.headers.get("retry-after");
    if (after !== null && /^\d+$/.test(after.trim())) return Number(after) * 1000;
    if (response.headers.get("x-ratelimit-remaining") === "0") {
      return Math.max(0, Number(response.headers.get("x-ratelimit-reset")) * 1000 - now());
    }
    return null;
  }

  async function send(method, path, body, content) {
    const label = `${method} ${path}`;
    if (content) stats.content++;
    for (let serverRetried = false; ; ) {
      if (content) {
        const wait = lastContent + PACE_MS - now();
        if (wait > 0) await sleep(wait);
        lastContent = now();
      }
      let response;
      try {
        response = await fetchImpl(urlOf(path), {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "motor-fix-tracker",
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (error) {
        throw new GitHubError("network", scrub(`${label}: ${error?.message ?? error}`));
      }
      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      if (response.ok) return { data, response };
      const wait = throttleWait(response);
      if (wait !== null) {
        if (wait > maxWaitS * 1000) throw new GitHubError("rate limit", scrub(`${label}: ${response.status}, GitHub asks to wait ${Math.ceil(wait / 1000)} s (over ${maxWaitS} s)`));
        if (wait > 10_000) log?.(`wait      ${Math.ceil(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      if (response.status >= 500 && !serverRetried) {
        serverRetried = true;
        await sleep(SERVER_RETRY_MS);
        continue;
      }
      throw new GitHubError(String(response.status), scrub(`${label}: ${response.status} ${data?.message ?? ""}`.trim()));
    }
  }

  const rest = async (method, path, body) => (await send(method, path, body, method !== "GET")).data;

  /** Every page of a REST list, following the Link header. */
  async function pages(path) {
    const all = [];
    for (let next = path; next; ) {
      const { data, response } = await send("GET", next, undefined, false);
      all.push(...data);
      next = response.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
    }
    return all;
  }

  async function graphql(query, variables) {
    const { data } = await send("POST", "/graphql", { query, variables }, /^\s*mutation\b/.test(query));
    if (data?.errors?.length) {
      throw new GitHubError(data.errors[0].type ?? "GRAPHQL", scrub(data.errors.map((e) => `${e.type ?? "error"}: ${e.message}`).join("; ")));
    }
    return data.data;
  }

  return { rest, pages, graphql, stats };
}
