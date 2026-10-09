import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { fakeClock } from "./fixtures/github.mjs";
import { GitHubError, githubClient, PACE_MS } from "./github.mjs";

const TOKEN = "ghp_SECRET_never_print_me";
const json = (data, status = 200, headers = {}) =>
  new Response(data === null ? null : JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

/** A fetch that answers from a queue (the last answer repeats) and records each call with the clock's time. */
function scripted(clock, answers) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init, at: clock.t });
    const next = answers.length > 1 ? answers.shift() : answers[0];
    return typeof next === "function" ? next(url, init) : next.clone();
  };
  return { calls, fetchImpl };
}

const client = (clock, answers, extra = {}) => {
  const f = scripted(clock, answers);
  return { ...f, github: githubClient({ token: TOKEN, fetchImpl: f.fetchImpl, sleep: clock.sleep, now: clock.now, ...extra }) };
};

// @traces 1017-FR-013
// @traces 1017-FR-014
describe("requests", () => {
  it("sends the bearer token and GitHub's headers to the repository path", async () => {
    const clock = fakeClock();
    const { github, calls } = client(clock, [json([{ name: "bug" }])]);
    assert.deepEqual(await github.rest("GET", "labels?per_page=100"), [{ name: "bug" }]);
    assert.equal(calls[0].url, "https://api.github.com/repos/george-hutanu/motor-fix/labels?per_page=100");
    const h = calls[0].init.headers;
    assert.equal(h.Authorization, `Bearer ${TOKEN}`);
    assert.equal(h.Accept, "application/vnd.github+json");
    assert.equal(h["X-GitHub-Api-Version"], "2022-11-28");
    assert.equal(h["User-Agent"], "motor-fix-tracker");
  });

  it("follows the Link header through every page", async () => {
    const clock = fakeClock();
    const { github, calls } = client(clock, [
      json([1, 2], 200, { link: '<https://api.github.com/repos/george-hutanu/motor-fix/issues?page=2>; rel="next", <x>; rel="last"' }),
      json([3]),
    ]);
    assert.deepEqual(await github.pages("issues?state=all&per_page=100"), [1, 2, 3]);
    assert.equal(calls[1].url, "https://api.github.com/repos/george-hutanu/motor-fix/issues?page=2");
  });

  it("posts GraphQL with its variables and returns the data", async () => {
    const clock = fakeClock();
    const { github, calls } = client(clock, [json({ data: { viewer: { login: "george-hutanu" } } })]);
    const data = await github.graphql("query Probe { viewer { login } }", { a: 1 });
    assert.equal(data.viewer.login, "george-hutanu");
    assert.equal(calls[0].url, "https://api.github.com/graphql");
    assert.deepEqual(JSON.parse(calls[0].init.body), { query: "query Probe { viewer { login } }", variables: { a: 1 } });
  });

  it("turns GraphQL errors into a typed error", async () => {
    const clock = fakeClock();
    const { github } = client(clock, [json({ errors: [{ type: "NOT_FOUND", message: "Could not resolve" }] })]);
    await assert.rejects(github.graphql("query X { a }"), (e) => e instanceof GitHubError && e.type === "NOT_FOUND" && /Could not resolve/.test(e.message));
  });

  it("names a failed REST call by method, path and status, with the token scrubbed", async () => {
    const clock = fakeClock();
    const { github } = client(clock, [json({ message: `bad credentials ${TOKEN}` }, 401)]);
    await assert.rejects(github.rest("POST", "issues", { title: "t" }), (e) => {
      assert.ok(e instanceof GitHubError);
      assert.match(e.message, /POST issues: 401/);
      assert.ok(!e.message.includes(TOKEN));
      return true;
    });
  });
});

describe("pacing", () => {
  it("spaces content-creating requests at least the pace apart and leaves reads alone", async () => {
    const clock = fakeClock();
    const { github, calls } = client(clock, [json({ data: { ok: 1 } })]);
    await github.graphql("mutation A { a }");
    await github.graphql("query B { b }");
    await github.graphql("mutation C { c }");
    await github.rest("PATCH", "issues/1", {});
    assert.equal(PACE_MS, 7200);
    assert.deepEqual(
      calls.map((c) => c.at),
      [0, 0, PACE_MS, 2 * PACE_MS],
    );
    assert.equal(github.stats.content, 3);
  });

  it("does not wait again when the pace has already passed", async () => {
    const clock = fakeClock();
    const { github } = client(clock, [json({})]);
    await github.rest("POST", "labels", {});
    clock.t += 10_000;
    await github.rest("POST", "labels", {});
    assert.deepEqual(clock.waits, []);
  });
});

describe("waits GitHub asks for", () => {
  it("sleeps for Retry-After and sends the request again", async () => {
    const clock = fakeClock();
    const { github, calls } = client(clock, [json({ message: "secondary rate limit" }, 403, { "retry-after": "60" }), json({ number: 7 }, 201)]);
    assert.deepEqual(await github.rest("POST", "issues", { title: "t" }), { number: 7 });
    assert.equal(calls.length, 2);
    assert.ok(clock.waits.includes(60_000));
    assert.equal(github.stats.content, 1);
  });

  it("sleeps until the reset when the remaining quota is zero", async () => {
    const clock = fakeClock();
    clock.t = 1_000_000;
    const { github } = client(clock, [json({ message: "rate limit" }, 429, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1030" }), json([])]);
    await github.rest("GET", "labels");
    assert.deepEqual(clock.waits, [30_000]);
  });

  it("gives up on a wait longer than the cap", async () => {
    const clock = fakeClock();
    const { github } = client(clock, [json({ message: "slow down" }, 429, { "retry-after": "121" })]);
    await assert.rejects(github.rest("GET", "labels"), (e) => e instanceof GitHubError && /121/.test(e.message));
    assert.deepEqual(clock.waits, []);
  });

  it("retries a server error once after two seconds", async () => {
    const clock = fakeClock();
    const { github, calls } = client(clock, [json({ message: "oops" }, 502), json([])]);
    await github.rest("GET", "labels");
    assert.equal(calls.length, 2);
    assert.deepEqual(clock.waits, [2000]);
  });

  it("fails on a second server error", async () => {
    const clock = fakeClock();
    const { github, calls } = client(clock, [json({ message: "oops" }, 502)]);
    await assert.rejects(github.rest("GET", "labels"), (e) => e instanceof GitHubError && /502/.test(e.message));
    assert.equal(calls.length, 2);
  });

  it("does not take a plain 403 for a rate limit", async () => {
    const clock = fakeClock();
    const { github, calls } = client(clock, [json({ message: "Resource not accessible" }, 403)]);
    await assert.rejects(github.rest("POST", "issues", {}), (e) => e instanceof GitHubError && /403/.test(e.message));
    assert.equal(calls.length, 1);
  });

  it("reports a network failure without the token", async () => {
    const clock = fakeClock();
    const github = githubClient({
      token: TOKEN,
      fetchImpl: async () => {
        throw new Error(`connect failed for ${TOKEN}`);
      },
      sleep: clock.sleep,
      now: clock.now,
    });
    await assert.rejects(github.rest("GET", "labels"), (e) => e instanceof GitHubError && !e.message.includes(TOKEN));
  });
});
