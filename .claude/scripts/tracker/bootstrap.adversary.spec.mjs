import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CHECKLIST, reconcile, SCHEMA } from "./bootstrap.mjs";
import { fakeGitHub } from "./fixtures/github.mjs";
import { GitHubError, githubClient } from "./github.mjs";

const TOKEN = "ghp_SECRET_never_print_me";
const TODAY = new Date("2026-10-09T12:00:00Z");
const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function formsDir(files = { "story.yml": 'name: Story\nlabels: ["type: story"]\nprojects: ["george-hutanu/<number>"]\n' }) {
  const dir = mkdtempSync(join(tmpdir(), "forms-"));
  dirs.push(dir);
  for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, n), c);
  return dir;
}
async function run(gh, opts = {}) {
  const lines = [];
  const github = githubClient({ token: TOKEN, fetchImpl: opts.fetchImpl ?? gh.fetchImpl, sleep: async () => {}, now: () => 0 });
  const result = await reconcile(github, { today: TODAY, formsDir: opts.formsDir ?? formsDir(), log: (l) => lines.push(l), ...opts });
  return { ...result, lines };
}

describe("bootstrap idempotence", () => {
  it("writes nothing at all on a third run", async () => {
    const gh = fakeGitHub();
    const dir = formsDir();
    await run(gh, { formsDir: dir });
    await run(gh, { formsDir: dir });
    const before = gh.writes().length;
    const third = await run(gh, { formsDir: dir });
    assert.equal(gh.writes().length, before);
    assert.equal(third.exit, 0);
  });

  it("creates exactly one Project even when two runs follow each other", async () => {
    const gh = fakeGitHub();
    const dir = formsDir();
    await run(gh, { formsDir: dir });
    await run(gh, { formsDir: dir });
    assert.equal(gh.state.projects.filter((p) => p.title === "MotorFix").length, 1);
  });

  it("does not duplicate a label that exists under another letter case", async () => {
    const gh = fakeGitHub({ labels: ["ep-1", "Type: Story"] });
    await run(gh);
    const names = gh.state.labels.map((l) => l.name.toLowerCase());
    assert.equal(new Set(names).size, names.length);
  });

  it("keeps an existing label's colour", async () => {
    const gh = fakeGitHub({ labels: [{ name: "EP-1", color: "123456" }] });
    await run(gh);
    assert.equal(gh.state.labels.find((l) => l.name === "EP-1").color, "123456");
  });

  it("does not create a second milestone when one exists closed", async () => {
    const gh = fakeGitHub({ milestones: ["1 - Launch"] });
    gh.state.milestones[0].state = "closed";
    await run(gh);
    assert.equal(gh.state.milestones.filter((m) => m.title === "1 - Launch").length, 1);
  });

  it("reuses an existing Project of the same title that is already linked", async () => {
    const gh = fakeGitHub({ projects: [{ title: "MotorFix", linked: true }] });
    await run(gh);
    assert.equal(gh.state.projects.length, 1);
  });
});

describe("bootstrap dry run", () => {
  it("sends no mutation and no REST write against an empty account", async () => {
    const gh = fakeGitHub();
    const dir = formsDir();
    const r = await run(gh, { dryRun: true, formsDir: dir });
    assert.equal(gh.writes().length, 0);
    assert.equal(r.exit, 0);
    assert.equal(readFileSync(join(dir, "story.yml"), "utf8").includes("<number>"), true, "a dry run must not rewrite the forms");
  });

  it("sends no write against a half-built Project either", async () => {
    const gh = fakeGitHub({ projects: [{ title: "MotorFix", linked: false, itemCount: 2 }], labels: ["EP-1"] });
    await run(gh, { dryRun: true });
    assert.equal(gh.writes().length, 0);
  });

  it("still prints the owner checklist", async () => {
    const r = await run(fakeGitHub(), { dryRun: true });
    for (const item of CHECKLIST) assert.ok(r.lines.some((l) => l.includes(item.replace(/^- /, "").slice(0, 20))), item);
  });
});

describe("bootstrap against odd states", () => {
  it("leaves a Status field with items alone and exits 2", async () => {
    const gh = fakeGitHub({ projects: [{ title: "MotorFix", linked: true, itemCount: 1 }] });
    const r = await run(gh);
    assert.equal(r.exit, 2);
    assert.deepEqual(gh.requests.filter((x) => x.op === "SetOptions"), []);
  });

  it("rewrites the number in a form that already holds an old one, once", async () => {
    const dir = formsDir({ "story.yml": 'name: Story\nprojects: ["george-hutanu/7"]\n' });
    const gh = fakeGitHub();
    await run(gh, { formsDir: dir });
    const n = gh.state.projects[0].number;
    assert.match(readFileSync(join(dir, "story.yml"), "utf8"), new RegExp(`projects: \\["george-hutanu/${n}"\\]`));
  });

  it("writes no stray file next to the forms", async () => {
    const dir = formsDir();
    await run(fakeGitHub(), { formsDir: dir });
    assert.deepEqual(readdirSync(dir), ["story.yml"]);
  });

  it("stops with a GitHubError and no further write when the API fails midway, without the token", async () => {
    const gh = fakeGitHub();
    let attempts = 0;
    const sent = [];
    const fetchImpl = async (url, init) => {
      const body = init?.body ? JSON.parse(init.body) : null;
      const mutation = body?.query?.match(/^\s*mutation\s+(\w+)/)?.[1];
      if (mutation) sent.push(mutation);
      else if (init?.method && init.method !== "GET" && !body?.query) sent.push(`${init.method} ${new URL(url).pathname}`);
      if (/^\s*mutation\b/.test(body?.query ?? "") && ++attempts >= 2) return new Response(JSON.stringify({ message: `boom ${TOKEN}` }), { status: 500 });
      return gh.fetchImpl(url, init);
    };
    await assert.rejects(run(gh, { fetchImpl }), (e) => e instanceof GitHubError && e.type === "500" && !e.message.includes(TOKEN));
    // The first mutation went through; the second failed, was retried once, and nothing was sent after it.
    assert.deepEqual(sent, ["CreateProject", "LinkRepo", "LinkRepo"]);
    assert.equal(gh.writes().length, 1);
  });

  it("exposes the Status options in the order To do, Planning, Implementing, Blocked, QA, Done", () => {
    const status = SCHEMA.fields?.find?.((f) => f.name === "Status") ?? SCHEMA.Status;
    const names = (status.options ?? []).map((o) => o.name ?? o);
    assert.deepEqual(names, ["To do", "Planning", "Implementing", "Blocked", "QA", "Done"]);
  });
});

describe("the Project schema after the import path", () => {
  it("has no import-only field, imported-page line or old-id line", () => {
    const names = SCHEMA.fields.map((f) => f.name.toLowerCase());
    assert.equal(names.some((n) => n.startsWith("created in")), false);
    assert.equal(/imported|old id|next/i.test(SCHEMA.readme), false);
  });
});
