import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fakeGitHub } from "./fixtures/github.mjs";
import { githubClient } from "./github.mjs";
import { assertProjectScope, projectToken, TokenError } from "./token.mjs";

const SECRET = "ghp_SECRET_never_print_me";
const clientOf = (gh) => githubClient({ token: SECRET, fetchImpl: gh.fetchImpl, sleep: async () => {}, now: () => 0 });

describe("projectToken under hostile input", () => {
  it("treats an empty GH_PROJECT_TOKEN as unset and asks gh", () => {
    const calls = [];
    const token = projectToken({ env: { GH_PROJECT_TOKEN: "", HOME: "/h" }, run: (...a) => (calls.push(a), { code: 0, stdout: `${SECRET}\n`, stderr: "" }) });
    assert.equal(token, SECRET);
    assert.equal(calls.length, 1);
  });

  it("treats a whitespace-only GH_PROJECT_TOKEN as no token", () => {
    const run = () => ({ code: 1, stdout: "", stderr: "" });
    assert.throws(() => projectToken({ env: { GH_PROJECT_TOKEN: "   \n", HOME: "/h" }, run }), TokenError);
  });

  it("trims a token that arrives with a trailing newline", () => {
    assert.equal(projectToken({ env: { GH_PROJECT_TOKEN: `${SECRET}\n`, HOME: "/h" }, run: () => assert.fail("gh must not run") }), SECRET);
  });

  it("rejects gh exiting 0 with empty output", () => {
    assert.throws(() => projectToken({ env: { HOME: "/h" }, run: () => ({ code: 0, stdout: "\n", stderr: "" }) }), TokenError);
  });

  it("never leaks gh's stderr, which may echo a token, into the error", () => {
    const run = () => ({ code: 1, stdout: "", stderr: `bad credentials ${SECRET}` });
    assert.throws(
      () => projectToken({ env: { HOME: "/h" }, run }),
      (e) => e instanceof TokenError && !e.message.includes(SECRET) && !String(e.stack).includes(SECRET),
    );
  });

  it("does not pass GITHUB_TOKEN, a blank GH_TOKEN or a config directory to gh", () => {
    let seen;
    projectToken({ env: { HOME: "/h", GITHUB_TOKEN: "other", GH_TOKEN: " " }, run: (_f, _a, o) => ((seen = o.env), { code: 0, stdout: SECRET, stderr: "" }) });
    assert.equal(seen.GITHUB_TOKEN, undefined);
    assert.equal(seen.GH_TOKEN, undefined);
    assert.equal(seen.GH_CONFIG_DIR, undefined);
  });

  it("includes the refresh command naming the project scope", () => {
    assert.throws(
      () => projectToken({ env: { HOME: "/h" }, run: () => ({ code: 1, stdout: "", stderr: "" }) }),
      (e) => /gh auth refresh -h github.com -u george-hutanu -s project,read:project/.test(e.message),
    );
  });
});

describe("assertProjectScope", () => {
  it("returns the login when the probe succeeds", async () => {
    assert.equal(await assertProjectScope(clientOf(fakeGitHub())), "george-hutanu");
  });

  it("throws a TokenError when the scope is missing and sends no write", async () => {
    const gh = fakeGitHub({ scoped: false });
    await assert.rejects(assertProjectScope(clientOf(gh)), (e) => e instanceof TokenError && !e.message.includes(SECRET));
    assert.equal(gh.writes().length, 0);
  });

  it("does not take another GraphQL failure for a missing scope", async () => {
    const github = { graphql: async () => { throw Object.assign(new Error("boom"), { type: "SOMETHING_ELSE" }); } };
    await assert.rejects(assertProjectScope(github), (e) => !(e instanceof TokenError));
  });
});

describe("the command line without a token", () => {
  it("bootstrap.mjs exits 1 on stderr naming where it looked and prints no token", () => {
    const home = mkdtempSync(join(tmpdir(), "home-"));
    try {
      const r = spawnSync(process.execPath, [new URL("./bootstrap.mjs", import.meta.url).pathname, "--dry-run"], {
        env: { PATH: "/nonexistent", HOME: home },
        encoding: "utf8",
      });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /GH_PROJECT_TOKEN/);
      assert.match(r.stderr, /GH_TOKEN/);
      assert.ok(!r.stderr.includes("gh-motorfix"), "the owner's gh-motorfix login is never named or read");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
