import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { fakeClock } from "./fixtures/github.mjs";
import { GitHubError, githubClient, MAX_PAGES, PACE_MS } from "./github.mjs";

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
  it("sends the bearer token and GitHub's headers to the issue repository path", async () => {
    const clock = fakeClock();
    const { github, calls } = client(clock, [json([{ name: "bug" }])]);
    assert.deepEqual(await github.rest("GET", "labels?per_page=100"), [{ name: "bug" }]);
    assert.equal(calls[0].url, "https://api.github.com/repos/george-hutanu/motor-fix-specs/labels?per_page=100");
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

// @traces 1119-FR-005
describe("request bodies", () => {
  it("sends a body that links an outside tracker page unchanged, with no refusal", async () => {
    const clock = fakeClock();
    const { github, calls } = client(clock, [json({ number: 7 }, 201)]);
    const body = { title: "ST-1 import", body: "Was https://www.example.so/Old-story-0123456789abcdef0123456789abcdef and https://app.example.com/p/abc" };
    assert.deepEqual(await github.rest("POST", "issues", body), { number: 7 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(JSON.parse(calls[0].init.body), body);
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

  it("fails a read on a third server error, a write on a second", async () => {
    const clock = fakeClock();
    const { github, calls } = client(clock, [json({ message: "oops" }, 502)]);
    await assert.rejects(github.rest("GET", "labels"), (e) => e instanceof GitHubError && /502/.test(e.message));
    assert.equal(calls.length, 3);
    const write = client(fakeClock(), [json({ message: "oops" }, 502)]);
    await assert.rejects(write.github.rest("POST", "issues", {}), (e) => e instanceof GitHubError && /502/.test(e.message));
    assert.equal(write.calls.length, 2);
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

describe("hostile answers", () => {
  const html = (status) => new Response("<html><body>Bad gateway</body></html>", { status, headers: { "content-type": "text/html" } });

  it("refuses a Link rel=next to another host, sending it nothing and naming no token", async () => {
    const clock = fakeClock();
    const { github, calls } = client(clock, [json([1], 200, { link: '<https://evil.example/x?t=1>; rel="next"' }), json([2])]);
    await assert.rejects(github.pages("issues"), (e) => e instanceof GitHubError && e.type === "host" && /evil\.example/.test(e.message) && !e.message.includes(TOKEN));
    assert.deepEqual(
      calls.map((c) => new URL(c.url).host),
      ["api.github.com"],
    );
  });

  it("refuses a plain-http api.github.com link too", async () => {
    const { github, calls } = client(fakeClock(), [json([1], 200, { link: '<http://api.github.com/repos/x/y/issues?page=2>; rel="next"' })]);
    await assert.rejects(github.pages("issues"), GitHubError);
    assert.equal(calls.length, 1);
  });

  it("stops after five throttle waits with a rate limit error", async () => {
    const clock = fakeClock();
    const { github, calls } = client(clock, [json({ message: "slow down" }, 429, { "retry-after": "1" })]);
    await assert.rejects(github.rest("GET", "labels"), (e) => e instanceof GitHubError && e.type === "rate limit");
    assert.deepEqual(clock.waits, [1000, 1000, 1000, 1000, 1000]);
    assert.equal(calls.length, 6);
  });

  it("retries an HTML 502 with backoff and then fails with a GitHubError, not a SyntaxError", async () => {
    const clock = fakeClock();
    const { github, calls } = client(clock, [html(502)]);
    await assert.rejects(github.rest("GET", "labels"), (e) => e instanceof GitHubError && e.type === "502");
    assert.equal(calls.length, 3);
    assert.deepEqual(clock.waits, [2000, 4000]);
  });

  it("recovers from an HTML 502 followed by JSON", async () => {
    const { github } = client(fakeClock(), [html(502), json([{ name: "a" }])]);
    assert.deepEqual(await github.rest("GET", "labels"), [{ name: "a" }]);
  });

  it("fails a 200 that is not JSON with a GitHubError", async () => {
    const { github } = client(fakeClock(), [html(200)]);
    await assert.rejects(github.rest("GET", "labels"), (e) => e instanceof GitHubError && e.type === "parse");
  });

  it("stops a Link rel=next that keeps pointing at the same page after the page cap", async () => {
    const { github, calls } = client(fakeClock(), [json([1], 200, { link: '<https://api.github.com/repos/george-hutanu/motor-fix/issues?page=2>; rel="next"' })]);
    await assert.rejects(github.pages("issues"), (e) => e instanceof GitHubError && e.type === "pages");
    assert.equal(calls.length, MAX_PAGES);
  });

  it("fails a GraphQL 200 with an empty body with a GitHubError, not a TypeError", async () => {
    const { github } = client(fakeClock(), [new Response("", { status: 200 })]);
    await assert.rejects(github.graphql("query Q { a }"), (e) => e instanceof GitHubError && e.type === "parse");
  });

  it("waits a minute on a secondary rate limit 403 with no Retry-After and quota left", async () => {
    const clock = fakeClock();
    const { github } = client(clock, [json({ message: "You have exceeded a secondary rate limit." }, 403, { "x-ratelimit-remaining": "4000" }), json({ number: 3 }, 201)]);
    assert.deepEqual(await github.rest("POST", "issues", {}), { number: 3 });
    assert.deepEqual(clock.waits, [60_000]);
  });
});

describe("a request that stalls", () => {
  const stall = () => new Promise(() => {});
  it("aborts a read after the timeout and sends it again", async () => {
    const clock = fakeClock();
    const { github, calls } = client(clock, [stall, stall, json([{ name: "bug" }])], { timeoutMs: 20 });
    assert.deepEqual(await github.rest("GET", "labels"), [{ name: "bug" }]);
    assert.equal(calls.length, 3);
    assert.ok(calls[0].init.signal.aborted);
  });

  it("fails a read after three tries, and never sends a write twice", async () => {
    const clock = fakeClock();
    const read = client(clock, [stall], { timeoutMs: 20 });
    await assert.rejects(read.github.rest("GET", "labels"), (e) => e instanceof GitHubError && e.type === "timeout");
    assert.equal(read.calls.length, 3);
    const write = client(fakeClock(), [stall], { timeoutMs: 20 });
    await assert.rejects(write.github.rest("POST", "issues", { title: "x" }), (e) => e instanceof GitHubError && e.type === "timeout");
    assert.equal(write.calls.length, 1);
  });

  it("sends an idempotent write again after a dropped connection: a PATCH, a field set, an add", async () => {
    const drop = () => Promise.reject(new TypeError("fetch failed"));
    const patch = client(fakeClock(), [drop, drop, json({ number: 10 })]);
    assert.deepEqual(await patch.github.rest("PATCH", "issues/10", { body: "x" }), { number: 10 });
    assert.equal(patch.calls.length, 3);
    const fields = client(fakeClock(), [drop, json({ data: { f0: {} } })]);
    assert.deepEqual(await fields.github.graphql("mutation SetFields { x }", {}, { idempotent: true }), { f0: {} });
    assert.equal(fields.calls.length, 2);
    // The first add landed but its answer was lost: the second meets 422 and that is success.
    const add = client(fakeClock(), [drop, json({ message: "Sub-issue already exists" }, 422)]);
    assert.equal(await add.github.rest("POST", "issues/1/sub_issues", { sub_issue_id: 2 }, { idempotent: true }), null);
    assert.equal(add.calls.length, 2);
    // A 422 on the first try is a real refusal.
    const refused = client(fakeClock(), [json({ message: "Validation Failed" }, 422)]);
    await assert.rejects(refused.github.rest("POST", "issues/1/sub_issues", {}, { idempotent: true }), (e) => e.type === "422" && !e.transient);
  });

  it("never sends a create or a plain mutation twice after a dropped connection", async () => {
    const drop = () => Promise.reject(new TypeError("fetch failed"));
    const create = client(fakeClock(), [drop, json({ number: 1 })]);
    await assert.rejects(create.github.rest("POST", "issues", { title: "x" }), (e) => e.type === "network" && e.transient);
    assert.equal(create.calls.length, 1);
    const mutation = client(fakeClock(), [drop, json({ data: {} })]);
    await assert.rejects(mutation.github.graphql("mutation M { x }", {}), (e) => e.transient);
    assert.equal(mutation.calls.length, 1);
  });

  it("tries a 5xx three times, honouring Retry-After", async () => {
    const clock = fakeClock();
    const { github, calls } = client(clock, [json({}, 502, { "retry-after": "3" }), json({}, 500), json({ ok: 1 })]);
    assert.deepEqual(await github.rest("GET", "labels"), { ok: 1 });
    assert.equal(calls.length, 3);
    assert.equal(calls[1].at - calls[0].at, 3000);
  });
});
