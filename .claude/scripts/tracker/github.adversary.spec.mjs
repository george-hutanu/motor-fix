import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { fakeClock } from "./fixtures/github.mjs";
import { GitHubError, githubClient } from "./github.mjs";

const TOKEN = "ghp_SECRET_never_print_me";
const json = (data, status = 200, headers = {}) => new Response(data === null ? null : JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

function client(clock, answers, extra = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init, at: clock.t });
    const next = answers.length > 1 ? answers.shift() : answers[0];
    return typeof next === "function" ? next(url, init) : next.clone();
  };
  return { calls, github: githubClient({ token: TOKEN, fetchImpl, sleep: clock.sleep, now: clock.now, ...extra }) };
}
const noToken = (e) => ![e.message, String(e.stack), JSON.stringify(e)].some((s) => s.includes(TOKEN));

describe("the token never leaves the client", () => {
  it("scrubs it from an HTTP error body that echoes it", async () => {
    const { github } = client(fakeClock(), [json({ message: `Bad credentials for ${TOKEN}` }, 401)]);
    await assert.rejects(github.rest("GET", "labels"), (e) => e instanceof GitHubError && noToken(e));
  });

  it("scrubs it from a GraphQL error message", async () => {
    const { github } = client(fakeClock(), [json({ errors: [{ type: "X", message: `denied ${TOKEN} ${TOKEN}` }] })]);
    await assert.rejects(github.graphql("query Q { a }"), (e) => noToken(e));
  });

  it("scrubs it from a non-JSON error page", async () => {
    const { github } = client(fakeClock(), [new Response(`<html>${TOKEN}</html>`, { status: 400 })]);
    await assert.rejects(github.rest("GET", "labels"), (e) => noToken(e));
  });

  it("scrubs it from the error of a rate limit that outlasts the cap", async () => {
    const { github } = client(fakeClock(), [json({ message: TOKEN }, 429, { "retry-after": "9999" })]);
    await assert.rejects(github.rest("GET", "labels"), (e) => noToken(e));
  });

  it("scrubs it from a thrown network error with a cause", async () => {
    const github = githubClient({ token: TOKEN, fetchImpl: async () => { throw new Error("x", { cause: new Error(TOKEN) }); }, sleep: async () => {}, now: () => 0 });
    await assert.rejects(github.rest("GET", "labels"), (e) => e instanceof GitHubError && noToken(e));
  });
});

describe("rate-limit waits", () => {
  it("waits exactly the cap when Retry-After equals it", async () => {
    const clock = fakeClock();
    const { github, calls } = client(clock, [json({}, 429, { "retry-after": "120" }), json([])]);
    await github.rest("GET", "labels");
    assert.deepEqual(clock.waits, [120_000]);
    assert.equal(calls.length, 2);
  });

  it("honours maxWaitS passed by the caller", async () => {
    const { github } = client(fakeClock(), [json({}, 429, { "retry-after": "11" })], { maxWaitS: 10 });
    await assert.rejects(github.rest("GET", "labels"), GitHubError);
  });

  it("does not sleep a negative time when the reset is already past", async () => {
    const clock = fakeClock();
    clock.t = 5_000_000;
    const { github } = client(clock, [json({}, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "100" }), json([])]);
    await github.rest("GET", "labels");
    assert.ok(clock.waits.every((w) => w >= 0));
  });

  it("keeps the same body when it resends a throttled write", async () => {
    const clock = fakeClock();
    const { github, calls } = client(clock, [json({}, 403, { "retry-after": "1" }), json({ number: 1 }, 201)]);
    await github.rest("POST", "issues", { title: "ST-1 x" });
    assert.equal(calls[0].init.body, calls[1].init.body);
  });

  it("counts a throttled-then-resent write once toward the budget", async () => {
    const { github } = client(fakeClock(), [json({}, 429, { "retry-after": "1" }), json({}, 201)]);
    await github.rest("POST", "issues", {});
    assert.equal(github.stats.content, 1);
  });

  it("waits again for a second throttle in a row", async () => {
    const clock = fakeClock();
    const { github } = client(clock, [json({}, 429, { "retry-after": "2" }), json({}, 429, { "retry-after": "3" }), json([])]);
    await github.rest("GET", "labels");
    assert.deepEqual(clock.waits, [2000, 3000]);
  });

  it("ignores a Retry-After that is an HTTP date by failing, not by hanging or sleeping NaN", async () => {
    const clock = fakeClock();
    const { github } = client(clock, [json({}, 429, { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" })]);
    await assert.rejects(github.rest("GET", "labels"), GitHubError);
    assert.ok(clock.waits.every((w) => Number.isFinite(w)));
  });
});

describe("pacing", () => {
  it("does not pace a GraphQL query but paces a mutation after a REST write", async () => {
    const clock = fakeClock();
    const { github, calls } = client(clock, [json({ data: {} })]);
    await github.rest("POST", "labels", {});
    await github.graphql("query Q { a }");
    await github.graphql("mutation M { a }");
    assert.deepEqual(calls.map((c) => c.at), [0, 0, 7200]);
  });

  it("does not count a failed read toward the content stats", async () => {
    const { github } = client(fakeClock(), [json({ message: "no" }, 404)]);
    await assert.rejects(github.rest("GET", "labels"));
    assert.equal(github.stats.content, 0);
  });
});

describe("pages", () => {
  it("returns an empty list for an empty first page", async () => {
    const { github } = client(fakeClock(), [json([])]);
    assert.deepEqual(await github.pages("issues?per_page=100"), []);
  });

  it("follows a thousand-item listing to the last page", async () => {
    const { github, calls } = client(fakeClock(), [
      (url) => {
        const p = Number(new URL(url).searchParams.get("page") ?? 1);
        const items = Array.from({ length: 100 }, (_, i) => (p - 1) * 100 + i);
        return json(items, 200, p < 10 ? { link: `<https://api.github.com/repos/george-hutanu/motor-fix/issues?per_page=100&page=${p + 1}>; rel="next"` } : {});
      },
    ]);
    const all = await github.pages("issues?per_page=100");
    assert.equal(all.length, 1000);
    assert.equal(calls.length, 10);
  });

  it("never sends the token to a host other than api.github.com named in a Link header", async () => {
    const { github, calls } = client(fakeClock(), [json([1], 200, { link: '<https://evil.example/x>; rel="next"' }), json([2])]);
    await github.pages("issues").catch(() => {});
    for (const c of calls.filter((x) => !x.url.startsWith("https://api.github.com/"))) {
      assert.equal(c.init.headers?.Authorization, undefined, `token sent to ${c.url}`);
    }
  });
});
