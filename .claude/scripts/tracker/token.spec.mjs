import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { githubClient } from "./github.mjs";
import { fakeGitHub } from "./fixtures/github.mjs";
import { assertProjectScope, projectToken, TokenError } from "./token.mjs";

const SECRET = "ghp_SECRET_never_print_me";

// @traces 1017-FR-014
describe("projectToken", () => {
  it("takes GH_PROJECT_TOKEN without running gh", () => {
    const calls = [];
    const token = projectToken({ env: { GH_PROJECT_TOKEN: SECRET, HOME: "/home/me" }, run: (...a) => calls.push(a) });
    assert.equal(token, SECRET);
    assert.equal(calls.length, 0);
  });

  it("asks gh for the token of the motor-fix config directory otherwise", () => {
    const calls = [];
    const run = (file, args, opts) => {
      calls.push({ file, args, opts });
      return { code: 0, stdout: `${SECRET}\n`, stderr: "" };
    };
    assert.equal(projectToken({ env: { HOME: "/home/me", GH_TOKEN: "other" }, run }), SECRET);
    assert.equal(calls[0].file, "gh");
    assert.deepEqual(calls[0].args, ["auth", "token"]);
    assert.equal(calls[0].opts.env.GH_CONFIG_DIR, "/home/me/.config/gh-motorfix");
    assert.equal(calls[0].opts.env.GH_TOKEN, undefined, "the session's own token must not shadow the config directory");
  });

  it("stops with a message naming both places when neither has a token", () => {
    const run = () => ({ code: 1, stdout: "", stderr: "no oauth token" });
    assert.throws(
      () => projectToken({ env: { HOME: "/home/me" }, run }),
      (e) => e instanceof TokenError && e.message.includes("GH_PROJECT_TOKEN") && e.message.includes("/home/me/.config/gh-motorfix"),
    );
  });
});

describe("assertProjectScope", () => {
  it("passes a token that can read projects and returns the login", async () => {
    const gh = fakeGitHub();
    const github = githubClient({ token: SECRET, fetchImpl: gh.fetchImpl, sleep: async () => {} });
    assert.equal(await assertProjectScope(github), "george-hutanu");
  });

  it("stops a token without the project scope with the refresh command and no token", async () => {
    const gh = fakeGitHub({ scoped: false });
    const github = githubClient({ token: SECRET, fetchImpl: gh.fetchImpl, sleep: async () => {} });
    await assert.rejects(assertProjectScope(github), (e) => {
      assert.ok(e instanceof TokenError);
      assert.match(e.message, /gh auth refresh -h github\.com -u george-hutanu -s project,read:project/);
      assert.match(e.message, /INSUFFICIENT_SCOPES/);
      assert.ok(!e.message.includes(SECRET));
      return true;
    });
    assert.equal(gh.writes().length, 0);
  });
});
