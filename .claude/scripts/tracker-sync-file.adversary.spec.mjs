import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SCHEMA } from "./tracker/bootstrap.mjs";
import { fakeGitHub } from "./tracker/fixtures/github.mjs";
import { main } from "./tracker-sync.mjs";

const FEATURE = "specs/1036-github-tracker-lifecycle";
const STATUS = ["To do", "Planning", "Implementing", "Blocked", "QA", "Done"];

function world() {
  return fakeGitHub({
    projects: [
      {
        title: "MotorFix",
        number: 11,
        statusOptions: STATUS,
        fields: SCHEMA.fields.filter((f) => f.name !== "Status"),
        linked: true,
        items: [{ number: 691, values: { Status: "To do" } }],
      },
    ],
    issues: [{ number: 691, title: "EP-6 Garages", labels: ["epic"] }],
    blockedBy: {},
    subIssues: {},
    pulls: [],
  });
}

function repoWith() {
  const repo = mkdtempSync(join(tmpdir(), "tracker-adv-"));
  mkdirSync(join(repo, FEATURE), { recursive: true });
  mkdirSync(join(repo, ".specify"), { recursive: true });
  writeFileSync(join(repo, FEATURE, "spec.md"), "# Spec\n");
  writeFileSync(join(repo, ".specify", "feature.json"), JSON.stringify({ feature_directory: FEATURE }));
  writeFileSync(join(repo, "body.md"), "body\n");
  return repo;
}

async function run(argv, { repo, gh }) {
  const out = [];
  const err = [];
  const urls = [];
  const ghCalls = [];
  const code = await main(argv, {
    repo,
    env: { GH_PROJECT_TOKEN: "ghp_x" },
    fetchImpl: async (url, init) => {
      urls.push(String(url));
      return gh.fetchImpl(url, init);
    },
    sleep: async () => {},
    run: () => ({ code: 1, stdout: "", stderr: "" }),
    gh: (args) => {
      ghCalls.push(args);
      return "";
    },
    now: () => new Date(2026, 9, 10, 12),
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
  });
  return { code, out, err, urls, ghCalls, json: out.at(-1)?.startsWith("{") ? JSON.parse(out.at(-1)) : null };
}

async function file(type, title) {
  const gh = world();
  const repo = repoWith();
  const r = await run(["file", "--type", type, "--title", title, "--body-file", join(repo, "body.md")], { gh, repo });
  assert.equal(r.code, 0, r.err.join("\n"));
  const made = gh.state.issues.find((i) => i.number === r.json.issue);
  return { made, r };
}

const TYPES = ["story", "task", "bug", "tech debt", "decision"];

describe("file titles every type with its own id", () => {
  for (const type of TYPES) {
    it(`numbers a ${type} issue and labels it type: ${type}`, async () => {
      const { made } = await file(type, "Plain title");
      assert.equal(made.title, `ST-${made.number} Plain title`);
      assert.deepEqual(made.labels.map((l) => l.name), [`type: ${type}`]);
    });
  }

  for (const [title, why] of [
    ["st-12 lower case", "lower-case st- is not an id"],
    ["Tech debt (ST-500): later in the text", "a mid-title reference is not an id"],
    ["XST-12 glued prefix", "a longer word ending in ST- is not an id"],
    ["ST- no digits", "ST- without digits is not an id"],
    ["ST12 no dash", "ST12 is not an id"],
    ["EP-x not numeric", "EP- without digits is not an id"],
  ]) {
    it(`prefixes the new number when ${why}: ${JSON.stringify(title)}`, async () => {
      const { made } = await file("tech debt", title);
      assert.equal(made.title, `ST-${made.number} ${title}`);
    });
  }

  it("trims a filed title before the check, so an id after leading spaces is kept", async () => {
    const { made } = await file("tech debt", "  ST-12 leading spaces");
    assert.equal(made.title, "ST-12 leading spaces");
  });

  for (const title of ["ST-1177c sub-id kept", "EP-6 epic-prefixed kept", "ST-7 kept", "EP-12: colon kept", "ST-1177c"]) {
    it(`keeps ${JSON.stringify(title)} as given`, async () => {
      const { made } = await file("decision", title);
      assert.equal(made.title, title);
    });
  }

  it("does not double the id when a title is a bare ST id with digits only", async () => {
    const { made } = await file("task", "ST-99");
    assert.equal(made.title, "ST-99");
  });

  it("keeps unicode and a long title intact after the id", async () => {
    const title = `Șoferi în București ${"é".repeat(300)} 🚗`;
    const { made } = await file("bug", title);
    assert.equal(made.title, `ST-${made.number} ${title}`);
  });

  it("filing two titles-without-id gives each its own distinct number", async () => {
    const gh = world();
    const repo = repoWith();
    const a = await run(["file", "--type", "task", "--title", "One", "--body-file", join(repo, "body.md")], { gh, repo });
    const b = await run(["file", "--type", "task", "--title", "Two", "--body-file", join(repo, "body.md")], { gh, repo });
    assert.notEqual(a.json.issue, b.json.issue);
    assert.equal(gh.state.issues.find((i) => i.number === b.json.issue).title, `ST-${b.json.issue} Two`);
  });

  it("refuses a missing title without creating an issue", async () => {
    const gh = world();
    const repo = repoWith();
    const before = gh.state.issues.length;
    const r = await run(["file", "--type", "task", "--body-file", join(repo, "body.md")], { gh, repo });
    assert.notEqual(r.code, 0);
    assert.equal(gh.state.issues.length, before);
  });

  it("refuses an empty title without creating an issue", async () => {
    const gh = world();
    const repo = repoWith();
    const before = gh.state.issues.length;
    const r = await run(["file", "--type", "task", "--title", "", "--body-file", join(repo, "body.md")], { gh, repo });
    assert.notEqual(r.code, 0);
    assert.equal(gh.state.issues.length, before);
  });

  it("refuses a type with different case as a usage error", async () => {
    const r = await run(["file", "--type", "Tech Debt", "--title", "x", "--body-file", "/nope"], { gh: world(), repo: repoWith() });
    assert.equal(r.code, 64);
  });
});

describe("retired debt event", () => {
  for (const extra of [[], ["--story", "ST-500"], ["--pr", "335", "--type", "tech debt"], ["--title", "x"]]) {
    it(`exits 1 before any GitHub call and writes no deferred.md for ${JSON.stringify(extra)}`, async () => {
      const repo = repoWith();
      const r = await run(["debt", ...extra], { gh: world(), repo });
      assert.equal(r.code, 1);
      assert.deepEqual(r.err, ["tracker-sync: tech-debt tickets are retired; fix it in this task"]);
      assert.deepEqual(r.urls, []);
      assert.deepEqual(r.ghCalls, []);
      assert.equal(existsSync(join(repo, FEATURE, "deferred.md")), false);
    });
  }

  it("file of every type writes no deferred.md", async () => {
    for (const type of TYPES) {
      const gh = world();
      const repo = repoWith();
      await run(["file", "--type", type, "--title", "x", "--body-file", join(repo, "body.md")], { gh, repo });
      assert.equal(existsSync(join(repo, FEATURE, "deferred.md")), false, type);
    }
  });

  it("leaves an existing deferred.md byte for byte unchanged", async () => {
    const repo = repoWith();
    const text = "# Deferred\n\n- **low** `a.mjs` — x (r)\n";
    writeFileSync(join(repo, FEATURE, "deferred.md"), text);
    await run(["debt", "--pr", "335"], { gh: world(), repo });
    assert.equal(readFileSync(join(repo, FEATURE, "deferred.md"), "utf8"), text);
  });
});
