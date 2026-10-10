import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readyLogged } from "./notion-ready.mjs";
import { SCHEMA } from "./tracker/bootstrap.mjs";
import { fakeGitHub } from "./tracker/fixtures/github.mjs";
import { main } from "./tracker-sync.mjs";

// Every run injects fetch and gh: nothing here reaches GitHub or Notion.
const TOKEN = "ghp_SECRET_never_print_me";
const FEATURE = "specs/1036-github-tracker-lifecycle";
const PR_URL = "https://github.com/george-hutanu/motor-fix/pull/335";
const ISSUES = "https://github.com/george-hutanu/motor-fix-specs/issues/";
const TODAY = "2026-10-10";
const STATUS = ["To do", "Planning", "Implementing", "Blocked", "QA", "Done"];
const TEMPLATE_BODY = [
  "## Why",
  "",
  "x",
  "",
  "## Story",
  "",
  "_(fill in: the story link, e.g. https://github.com/george-hutanu/motor-fix-specs/issues/<n> (ST-n))_",
  "",
  "Closes george-hutanu/motor-fix-specs#",
  "",
].join("\n");

const issue = (number, title, labels, extra = {}) => ({ number, title, labels, ...extra });

/**
 * EP-6 (#691) with feature #740 and stories: ST-1036 (#60, the one this
 * feature runs), ST-313 (#61, ticked ready yet blocked by the Blocked ST-290),
 * ST-290 (#62), ST-330 (#63, To do, its only blocker #64 closed and Done) and
 * ST-12 (#64).
 */
function world({ story = "To do", epic = "To do", items = {}, issues = [], pr = {}, blockedBy = {}, subIssues = {}, ...rest } = {}) {
  const status = {
    691: epic,
    740: "Implementing",
    60: story,
    61: "To do",
    62: "Blocked",
    63: "To do",
    64: "Done",
    ...items,
  };
  return fakeGitHub({
    projects: [
      {
        title: "MotorFix",
        number: 11,
        statusOptions: STATUS,
        fields: SCHEMA.fields.filter((f) => f.name !== "Status"),
        linked: true,
        items: Object.entries(status)
          .filter(([, s]) => s !== null)
          .map(([number, s]) => ({ number: Number(number), values: { Status: s, ...(typeof s === "object" ? s : {}) } })),
      },
    ],
    issues: [
      issue(691, "EP-6 Garages", ["epic"]),
      issue(740, "Garage profile", ["type: feature", "EP-6"]),
      issue(60, "ST-1036 Harness: run the task lifecycle on GitHub", ["type: story", "EP-6"]),
      issue(61, "ST-313 Garage photos", ["type: story", "EP-6", "ready to work"]),
      issue(62, "ST-290 Garage hours", ["type: story", "EP-6"]),
      issue(63, "ST-330 Garage map", ["type: story", "EP-6"]),
      issue(64, "ST-12 Garage list", ["type: story", "EP-6"], { state: "closed", state_reason: "completed" }),
      ...issues,
    ],
    blockedBy: { 61: [62], 63: [64], ...blockedBy },
    subIssues: { 691: [740], 740: [60, 61, 62, 63, 64], ...subIssues },
    pulls: [{ number: 335, body: TEMPLATE_BODY, ...pr }],
    ...rest,
  });
}

function repoWith({ deferred, comment } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "tracker-sync-"));
  mkdirSync(join(repo, FEATURE), { recursive: true });
  mkdirSync(join(repo, ".specify"), { recursive: true });
  writeFileSync(join(repo, FEATURE, "spec.md"), "# Spec\n");
  writeFileSync(join(repo, ".specify", "feature.json"), JSON.stringify({ feature_directory: FEATURE }));
  if (deferred) writeFileSync(join(repo, FEATURE, "deferred.md"), deferred);
  if (comment) writeFileSync(join(repo, "comment.md"), comment);
  return repo;
}

async function run(argv, { repo = repoWith(), gh = world(), env = { GH_PROJECT_TOKEN: TOKEN }, tokenRun, fetchImpl, ghFails = () => false } = {}) {
  const out = [];
  const err = [];
  const ghCalls = [];
  const urls = [];
  const code = await main(argv, {
    repo,
    env,
    fetchImpl: async (url, init) => {
      urls.push(String(url));
      return (fetchImpl ?? gh.fetchImpl)(url, init);
    },
    sleep: async () => {},
    run: tokenRun ?? (() => ({ code: 1, stdout: "", stderr: "" })),
    gh: (args) => {
      ghCalls.push(args);
      if (ghFails(args)) throw new Error(`gh ${args.join(" ")}: HTTP 502`);
      if (args[0] === "pr" && args[1] === "view") return args.includes(".url") ? `${PR_URL}\n` : "335\n";
      return "";
    },
    now: () => new Date(2026, 9, 10, 12),
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
  });
  let log = "";
  try {
    log = readFileSync(join(repo, FEATURE, "tracker-sync.md"), "utf8");
  } catch {}
  return {
    code,
    out,
    err,
    gh: ghCalls,
    urls,
    log,
    lines: log.split("\n").filter((l) => l.startsWith("- ")),
    repo,
    json: out.at(-1)?.startsWith("{") ? JSON.parse(out.at(-1)) : null,
  };
}

const labelsOf = (gh, number) => gh.state.issues.find((i) => i.number === number).labels.map((l) => l.name);
const issueOf = (gh, number) => gh.state.issues.find((i) => i.number === number);
const prEdits = (r) => r.gh.filter((a) => a[0] === "pr" && a[1] === "edit");

// @traces 1036-FR-001 1036-FR-002 1036-FR-003 1036-FR-011
describe("status events move the story's issue in Project #11", () => {
  it("start: To do → Planning, Started today, the planning label, one log line", async () => {
    const gh = world();
    const r = await run(["start", "--pr", "335"], { gh });
    assert.equal(r.code, 0, r.err.join("\n"));
    assert.equal(gh.itemValues(60).Status, "Planning");
    assert.equal(gh.itemValues(60).Started, TODAY);
    assert.ok(prEdits(r).some((a) => a.includes("335") && a.join(" ").includes("--add-label planning")));
    assert.ok(r.lines.includes(`- ${TODAY} · start · ST-1036 · To do → Planning`), r.log);
    assert.equal(r.json.status, "Planning");
    assert.equal(r.json.issue, 60);
  });

  it("implement: Planning → Implementing and the in development label", async () => {
    const gh = world({ story: "Planning" });
    const r = await run(["implement", "--pr", "335"], { gh });
    assert.equal(gh.itemValues(60).Status, "Implementing");
    assert.ok(prEdits(r).some((a) => a.join(" ").includes("--add-label in development") && a.join(" ").includes("--remove-label planning")));
  });

  it("qa and its review alias: QA, QA from today, the QA label", async () => {
    for (const event of ["qa", "review"]) {
      const gh = world({ story: "Implementing" });
      const r = await run([event, "--pr", "335"], { gh });
      assert.equal(gh.itemValues(60).Status, "QA", event);
      assert.equal(gh.itemValues(60)["QA from"], TODAY, event);
      assert.ok(prEdits(r).some((a) => a.join(" ").includes("--add-label QA")), event);
    }
  });

  it("a Done issue never moves", async () => {
    const gh = world({ story: "Done" });
    const r = await run(["start", "--pr", "335"], { gh });
    assert.equal(r.code, 0);
    assert.equal(gh.itemValues(60).Status, "Done");
    assert.equal(gh.itemValues(60).Started, undefined);
  });

  it("a story with no Project item is added to Project #11 first", async () => {
    const gh = world({ items: { 60: null } });
    const r = await run(["start", "--pr", "335"], { gh });
    assert.equal(r.code, 0, r.err.join("\n"));
    assert.equal(gh.itemValues(60).Status, "Planning");
  });
});

// @traces 1036-FR-004
describe("blocked and unblock", () => {
  it("posts the reason once on the issue and the PR, and unblock returns to the status it left", async () => {
    const gh = world({ story: "QA" });
    const repo = repoWith();
    const first = await run(["blocked", "CI", "red", "--pr", "335"], { gh, repo });
    assert.equal(gh.itemValues(60).Status, "Blocked");
    assert.deepEqual(
      gh.state.comments.get(60).map((c) => c.body),
      ["Blocked: CI red"],
    );
    assert.ok(first.gh.some((a) => a[0] === "pr" && a[1] === "comment" && a.includes("Blocked: CI red")));
    assert.ok(prEdits(first).some((a) => a.join(" ").includes("--add-label QA --add-label blocked")));

    const again = await run(["blocked", "CI", "red", "--pr", "335"], { gh, repo });
    assert.equal(gh.state.comments.get(60).length, 1, "the same reason is posted once");
    assert.ok(!again.gh.some((a) => a[1] === "comment"));

    await run(["unblock", "--pr", "335"], { gh, repo });
    assert.equal(gh.itemValues(60).Status, "QA");
  });
});

// @traces 1036-FR-003 1036-FR-011
describe("a failed PR write", () => {
  const prWrite = (args) => args[0] === "pr" && (args[1] === "edit" || args[1] === "comment");

  it("logs the label edit PENDING instead of logging the label as set, and the next run retries it", async () => {
    const gh = world({ story: "Implementing" });
    const repo = repoWith();
    const down = await run(["qa", "--pr", "335"], { gh, repo, ghFails: prWrite });
    assert.equal(down.code, 0);
    assert.equal(gh.itemValues(60).Status, "QA", "the issue write still lands");
    assert.ok(!down.lines.some((l) => l.includes("· labels · PR #335")), down.log);
    assert.ok(down.log.includes('[TRACKER-SYNC PENDING: labels PR #335'), down.log);
    assert.ok(down.log.includes('retry: ["qa","--pr","335"]'), down.log);
    assert.ok(down.json.pending, "the result names what is pending");

    const next = await run(["review", "--pr", "335"], { gh, repo });
    assert.ok(next.log.includes("[TRACKER-SYNC RETRIED 2026-10-10: labels PR #335"), next.log);
  });

  it("retries a failed Blocked: PR comment without posting the issue comment twice", async () => {
    const gh = world({ story: "QA" });
    const repo = repoWith();
    const down = await run(["blocked", "CI", "red", "--pr", "335"], { gh, repo, ghFails: (a) => a[0] === "pr" && a[1] === "comment" });
    assert.equal(down.code, 0);
    assert.ok(down.log.includes("[TRACKER-SYNC PENDING: blocked PR #335"), down.log);

    const again = await run(["blocked", "CI", "red", "--pr", "335"], { gh, repo });
    assert.equal(gh.state.comments.get(60).length, 1, "the issue comment is posted once");
    assert.ok(again.gh.some((a) => a[0] === "pr" && a[1] === "comment" && a.includes("Blocked: CI red")), "the PR comment is retried");
    assert.ok(again.log.includes("[TRACKER-SYNC RETRIED 2026-10-10: blocked PR #335"), again.log);

    const third = await run(["blocked", "CI", "red", "--pr", "335"], { gh, repo });
    assert.ok(!third.gh.some((a) => a[1] === "comment"), "posted once it went through");
  });
});

// @traces 1036-FR-002 1036-FR-006 1036-FR-007
describe("finish", () => {
  it("sets Done and Merged at, closes the issue as completed and posts the comment once", async () => {
    const gh = world({ story: "QA", epic: "Implementing" });
    const repo = repoWith({ comment: "- deviation: none\n- deferred: one\n" });
    const r = await run(["finish", "--pr", "335", "--body-file", join(repo, "comment.md")], { gh, repo });
    assert.equal(r.code, 0, r.err.join("\n"));
    assert.equal(gh.itemValues(60).Status, "Done");
    assert.equal(gh.itemValues(60)["Merged at"], TODAY);
    assert.equal(issueOf(gh, 60).state, "closed");
    assert.equal(issueOf(gh, 60).state_reason, "completed");
    assert.deepEqual(gh.state.comments.get(60).map((c) => c.body), ["- deviation: none\n- deferred: one\n"]);
    assert.ok(r.lines.some((l) => l.includes("· comment · ST-1036 · posted (2 items)")), r.log);
    assert.ok(r.lines.some((l) => l.includes("· EP-6 · Implementing (unchanged)")), "other stories are still open: the epic stays");

    await run(["finish", "--pr", "335", "--body-file", join(repo, "comment.md")], { gh, repo });
    assert.equal(gh.state.comments.get(60).length, 1, "a rerun posts nothing twice");
  });

  it("--no-comment logs that there was nothing to record", async () => {
    const r = await run(["finish", "--pr", "335", "--no-comment"], { gh: world({ story: "QA" }) });
    assert.ok(r.lines.some((l) => l.endsWith("· comment · ST-1036 · nothing to record")));
  });

  it("closes the epic as Done when every other issue of it is closed or Done, its feature aside", async () => {
    const gh = world({ story: "QA", epic: "Implementing", items: { 61: "Done", 62: "Done", 63: "Done" } });
    await run(["finish", "--pr", "335", "--no-comment"], { gh });
    assert.equal(gh.itemValues(691).Status, "Done");
    assert.equal(issueOf(gh, 691).state, "closed");
  });
});

// @traces 1036-FR-006
describe("the epic at start", () => {
  it("moves the epic's issue from To do to Implementing", async () => {
    const gh = world({ epic: "To do" });
    const r = await run(["start", "--pr", "335"], { gh });
    assert.equal(gh.itemValues(691).Status, "Implementing");
    assert.ok(r.lines.some((l) => l.endsWith("· start · EP-6 · To do → Implementing")), r.log);
  });

  it("leaves an epic already in progress", async () => {
    const gh = world({ epic: "Implementing" });
    await run(["start", "--pr", "335"], { gh });
    assert.equal(gh.itemValues(691).Status, "Implementing");
  });
});

// @traces 1036-FR-005
describe("pr links the PR and the issue both ways", () => {
  it("writes the PR field, fills the Closes line and the story link once, and labels the PR with the epic", async () => {
    const gh = world();
    const repo = repoWith();
    const r = await run(["pr", "335"], { gh, repo });
    assert.equal(r.code, 0, r.err.join("\n"));
    assert.equal(gh.itemValues(60).PR, PR_URL);
    const body = gh.state.pulls.get(335).body;
    assert.match(body, /^Closes george-hutanu\/motor-fix-specs#60$/m);
    assert.ok(body.includes(`${ISSUES}60 (ST-1036)`), body);
    assert.ok(!body.includes("_(fill in: the story link"));
    assert.ok(r.gh.some((a) => a.join(" ") === "pr edit 335 --add-label EP-6"));
    assert.ok(r.lines.some((l) => l.includes(`· pr · ST-1036 · PR #335 ${PR_URL}`)), r.log);

    await run(["pr", "335"], { gh, repo });
    assert.equal(gh.state.pulls.get(335).body.match(/Closes george-hutanu\/motor-fix-specs#60/g).length, 1);
  });

  it("appends the Closes line to a body that has none", async () => {
    const gh = world({ pr: { body: "## Why\n\nx\n" } });
    await run(["pr", "335"], { gh });
    assert.match(gh.state.pulls.get(335).body, /\nCloses george-hutanu\/motor-fix-specs#60\n?$/);
  });

  it("keeps another PR already in the field and comments a follow-up", async () => {
    const gh = world({ items: { 60: { Status: "QA", PR: "https://github.com/george-hutanu/motor-fix/pull/300" } } });
    const r = await run(["pr", "335"], { gh });
    assert.equal(gh.itemValues(60).PR, "https://github.com/george-hutanu/motor-fix/pull/300");
    assert.deepEqual(gh.state.comments.get(60).map((c) => c.body), [`Follow-up PR: ${PR_URL}`]);
    assert.ok(r.lines.some((l) => l.includes("(follow-up; PR keeps https://github.com/george-hutanu/motor-fix/pull/300)")));
  });
});

// @traces 1036-FR-008
describe("Ready to work is computed from the real state of each dependency", () => {
  it("unticks a story whose dependency is Blocked and only reports a candidate whose dependency is closed (ST-313, ST-330)", async () => {
    const gh = world();
    const r = await run(["start", "--pr", "335"], { gh });
    assert.ok(!labelsOf(gh, 61).includes("ready to work"), "ST-313 waits on the Blocked ST-290");
    assert.ok(!labelsOf(gh, 63).includes("ready to work"), "a candidate waits for the hold review");
    assert.deepEqual(r.json.ready.review, ["ST-330"]);
    assert.ok(r.json.ready.held.some((h) => h.id === "ST-313" && h.reason.includes("ST-290 (Blocked)")), JSON.stringify(r.json.ready));
    assert.ok(r.lines.some((l) => l.includes("· ready · EP-6 · −ST-313, review: ST-330")), r.log);
  });

  it("counts an open dependency at To do as blocking, and an open sub-issue too", async () => {
    const gh = world({
      issues: [issue(65, "ST-400 Garage reviews", ["type: story", "EP-6", "ready to work"]), issue(66, "ST-401 Review form", ["type: task"])],
      items: { 65: "To do", 66: "To do" },
      subIssues: { 65: [66] },
    });
    const r = await run(["ready"], { gh });
    assert.ok(!labelsOf(gh, 65).includes("ready to work"));
    assert.ok(r.json.ready.untick.includes("ST-400"));
  });

  it("ready --tick labels only what the hold review confirmed, and --hold keeps one back", async () => {
    const gh = world();
    const r = await run(["ready", "--tick", "ST-330"], { gh });
    assert.ok(labelsOf(gh, 63).includes("ready to work"));
    assert.deepEqual(r.json.ready.tick, ["ST-330"]);

    const gh2 = world();
    await run(["ready", "--hold", "ST-330=waits on the owner"], { gh: gh2 });
    assert.ok(!labelsOf(gh2, 63).includes("ready to work"));
  });

  it("never labels the epic or a feature issue, and removes the started story's own label", async () => {
    const gh = world({ issues: [], items: {} });
    issueOf(gh, 60).labels.push({ name: "ready to work" });
    await run(["start", "--pr", "335"], { gh });
    assert.ok(!labelsOf(gh, 60).includes("ready to work"));
    assert.ok(!labelsOf(gh, 740).includes("ready to work"));
    assert.ok(!labelsOf(gh, 691).includes("ready to work"));
  });

  it("refreshes a story with no epic alone and still logs its ready line", async () => {
    const gh = world();
    issueOf(gh, 60).labels = [{ name: "type: story" }];
    const r = await run(["finish", "--pr", "335", "--no-comment"], { gh });
    assert.ok(r.lines.some((l) => l.includes("· ready · ST-1036 · ") && l.endsWith("(the story has no epic)")), r.log);
    assert.equal(readyLogged(r.log).ok, true);
  });
});

// @traces 1036-FR-009
describe("debt files each deferred bullet as a To do issue", () => {
  const DEFERRED = "# Deferred\n\n- **medium** `lib/x.mjs` — retry loop has no cap (code-reviewer)\n";

  it("creates the issue under the epic, in Project #11 at To do, and marks the bullet so a rerun files nothing", async () => {
    const gh = world();
    const repo = repoWith({ deferred: DEFERRED });
    const r = await run(["debt", "--pr", "335"], { gh, repo });
    assert.equal(r.code, 0, r.err.join("\n"));
    const made = gh.state.issues.find((i) => /retry loop has no cap/.test(i.title));
    assert.ok(made, "the issue exists");
    assert.ok(made.title.startsWith("Tech debt (ST-1036): "), made.title);
    assert.deepEqual(made.labels.map((l) => l.name).sort(), ["EP-6", "type: tech debt"]);
    assert.ok(made.body.includes(`${ISSUES}60`), made.body);
    assert.equal(gh.itemValues(made.number).Status, "To do");
    assert.equal(gh.itemValues(made.number)["Work type"], "Tech debt");
    assert.equal(gh.itemValues(made.number).Epic, "EP-6");
    assert.equal(gh.itemValues(made.number).Priority, "Medium");
    assert.ok(gh.state.subIssues.get(691).includes(made.id), "a sub-issue of the epic");
    const marked = readFileSync(join(repo, FEATURE, "deferred.md"), "utf8");
    assert.ok(marked.includes(`— Issue: ${ISSUES}${made.number}`), marked);

    const count = gh.state.issues.length;
    await run(["debt", "--pr", "335"], { gh, repo });
    assert.equal(gh.state.issues.length, count);
  });

  it("a failure after the issue was created leaves it pending, and the rerun reuses that issue instead of filing a second", async () => {
    const gh = world();
    const repo = repoWith({ deferred: DEFERRED });
    const refuse = async (url, init) =>
      /\/sub_issues$/.test(new URL(url).pathname) && init.method === "POST"
        ? new Response(JSON.stringify({ message: "Forbidden" }), { status: 403, headers: { "content-type": "application/json" } })
        : gh.fetchImpl(url, init);
    const first = await run(["debt", "--pr", "335"], { gh, repo, fetchImpl: refuse });
    assert.equal(first.code, 0, first.err.join("\n"));
    const count = gh.state.issues.length;
    assert.ok(first.log.includes("[TRACKER-SYNC PENDING: debt"), first.log);
    const again = await run(["debt", "--pr", "335"], { gh, repo });
    assert.equal(again.code, 0, again.err.join("\n"));
    assert.equal(gh.state.issues.length, count, "no second issue");
    const made = gh.state.issues.find((i) => /retry loop has no cap/.test(i.title));
    assert.ok(readFileSync(join(repo, FEATURE, "deferred.md"), "utf8").includes(`— Issue: ${ISSUES}${made.number}`));
  });
});

// @traces 1036-FR-010
describe("file", () => {
  it("creates an issue with its form's type label and adds it to Project #11 at To do", async () => {
    const gh = world();
    const repo = repoWith();
    writeFileSync(join(repo, "body.md"), "## Goal\n\nA thing.\n");
    const r = await run(["file", "--type", "task", "--title", "Harness: drop the Notion sync", "--epic", "EP-6", "--priority", "High", "--body-file", join(repo, "body.md")], { gh, repo });
    assert.equal(r.code, 0, r.err.join("\n"));
    const made = issueOf(gh, r.json.issue);
    assert.equal(made.title, "Harness: drop the Notion sync");
    assert.deepEqual(made.labels.map((l) => l.name).sort(), ["EP-6", "type: task"]);
    assert.equal(gh.itemValues(made.number).Status, "To do");
    assert.equal(gh.itemValues(made.number)["Work type"], "Task");
    assert.equal(gh.itemValues(made.number).Priority, "High");
    assert.equal(r.json.url, `${ISSUES}${made.number}`);
  });

  it("refuses an unknown type as a usage error", async () => {
    const r = await run(["file", "--type", "chore", "--title", "x", "--body-file", "/nope"]);
    assert.equal(r.code, 64);
  });
});

// @traces 1036-FR-001 1036-FR-011 1036-FR-012
describe("failures never stop the build", () => {
  it("skips a story with no issue, writing nothing", async () => {
    const gh = world();
    const r = await run(["start", "--story", "ST-9999", "--pr", "335"], { gh });
    assert.equal(r.code, 0);
    assert.match(r.json.skipped, /no issue titled ST-9999/);
    assert.equal(gh.writes().length, 0);
  });

  it("a token without the project scope gives one line naming the fix and logs the step PENDING", async () => {
    const gh = world({ scoped: false });
    const r = await run(["start", "--pr", "335"], { gh });
    assert.equal(r.code, 0);
    assert.equal(r.err.length, 1, r.err.join("\n"));
    assert.match(r.err[0], /gh auth refresh -h github\.com -u george-hutanu -s project/);
    assert.ok(!r.err[0].includes("\n"), "one line");
    assert.ok(r.log.includes('[TRACKER-SYNC PENDING: start ST-1036'), r.log);
    assert.ok(!r.log.includes(TOKEN) && !r.out.join("").includes(TOKEN));
  });

  it("with no token anywhere: the same one line, never a crash", async () => {
    const r = await run(["start", "--pr", "335"], { env: {} });
    assert.equal(r.code, 0);
    assert.equal(r.err.length, 1);
    assert.match(r.err[0], /gh auth refresh/);
    assert.ok(r.log.includes("[TRACKER-SYNC PENDING: start ST-1036"));
  });

  it("GitHub unreachable: PENDING with the argv, replayed first on the next run", async () => {
    const gh = world();
    const repo = repoWith();
    const down = await run(["start", "--pr", "335"], { gh, repo, fetchImpl: async () => { throw new TypeError("fetch failed"); } });
    assert.equal(down.code, 0);
    assert.ok(down.log.includes('retry: ["start","--pr","335"]'), down.log);
    const next = await run(["implement", "--pr", "335"], { gh, repo });
    assert.equal(next.code, 0, next.err.join("\n"));
    assert.ok(next.log.includes("[TRACKER-SYNC RETRIED 2026-10-10: start ST-1036"), next.log);
    assert.equal(gh.itemValues(60).Status, "Implementing");
  });

  it("check reports the login and the Project", async () => {
    const r = await run(["check"]);
    assert.equal(r.code, 0);
    assert.equal(r.json.check, "ok");
    assert.equal(r.json.project, 11);
  });
});

// SC-001: the GitHub path calls GitHub only.
describe("no Notion request", () => {
  it("a whole lifecycle reaches api.github.com and nothing else", async () => {
    const gh = world();
    const repo = repoWith({ comment: "- done\n" });
    const urls = [];
    for (const argv of [["start", "--pr", "335"], ["pr", "335"], ["implement", "--pr", "335"], ["qa", "--pr", "335"], ["finish", "--pr", "335", "--body-file", join(repo, "comment.md")]]) {
      const r = await run(argv, { gh, repo, env: { GH_PROJECT_TOKEN: TOKEN, NOTION_TOKEN: "ntn_x" } });
      assert.equal(r.code, 0, `${argv[0]}: ${r.err.join("\n")}`);
      urls.push(...r.urls);
    }
    assert.ok(urls.length > 0);
    assert.ok(urls.every((u) => u.startsWith("https://api.github.com/")), urls.filter((u) => !u.startsWith("https://api.github.com/")).join("\n"));
    assert.equal(gh.itemValues(60).Status, "Done");
  });
});
