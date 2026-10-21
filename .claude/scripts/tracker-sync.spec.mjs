import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SCHEMA } from "./tracker/bootstrap.mjs";
import { fakeGitHub } from "./tracker/fixtures/github.mjs";
import { main } from "./tracker-sync.mjs";

// Every run injects fetch and gh: nothing here reaches GitHub.
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
      issue(61, "ST-313 Garage photos", ["type: story", "EP-6"]),
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

async function run(argv, { repo = repoWith(), gh = world(), env = { GH_PROJECT_TOKEN: TOKEN }, tokenRun, fetchImpl, ghFails = () => false, realGh = false } = {}) {
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
    gh: realGh ? undefined : (args) => {
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

  it("refuses to guess when two issues start with the story's id, and moves neither", async () => {
    const gh = world({ story: "Planning", issues: [issue(70, "ST-1036 follow-up: delete the import", ["type: tech debt"])] });
    const r = await run(["implement", "--pr", "335"], { gh });
    assert.equal(gh.itemValues(60).Status, "Planning");
    assert.notEqual(gh.itemValues(70)?.Status, "Implementing");
    assert.match([...r.out, ...r.err].join("\n"), /#60.*#70|#70.*#60/);
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

// @traces 1036-FR-004 1360-FR-003
describe("blocked and unblock", () => {
  it("posts the reason once on the issue and the PR, and unblock returns to the status it left", async () => {
    const gh = world({ story: "QA" });
    const repo = repoWith();
    const first = await run(["blocked", "CI", "red", "--pr", "335"], { gh, repo });
    assert.equal(gh.itemValues(60).Status, "Blocked");
    assert.deepEqual(
      gh.state.comments.get(60).map((c) => c.body),
      ["Blocked: CI red\n\n<!-- tracker-sync prior: QA -->"],
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

  it("logs a failed epic label on the PR PENDING, and the next run retries it", async () => {
    const gh = world();
    const repo = repoWith();
    const down = await run(["pr", "335"], { gh, repo, ghFails: (a) => a[0] === "pr" && a[1] === "edit" });
    assert.equal(down.code, 0);
    assert.equal(gh.itemValues(60).PR, PR_URL, "the issue write still lands");
    assert.ok(down.log.includes("[TRACKER-SYNC PENDING: epic label PR #335"), down.log);
    assert.ok(down.json.pending, "the result names what is pending");

    const next = await run(["review", "--pr", "335"], { gh, repo });
    assert.ok(next.gh.some((a) => a.join(" ") === "pr edit 335 --add-label EP-6"), "the label edit is retried");
    assert.ok(next.log.includes("[TRACKER-SYNC RETRIED 2026-10-10: epic label PR #335"), next.log);
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

// @traces 1324-FR-005
// @traces 1324-FR-008
describe("debt and ready are retired", () => {
  for (const [event, message] of [
    ["debt", "tech-debt tickets are retired; fix it in this task"],
    ["ready", "the ready refresh is retired; pick the next task with tracker-sync.mjs next"],
  ]) {
    it(`${event} refuses before any GitHub call or log write`, async () => {
      const repo = repoWith({ deferred: "# Deferred\n\n- **medium** `lib/x.mjs` — retry loop has no cap (code-reviewer)\n" });
      const r = await run([event, "--pr", "335"], { repo });
      assert.equal(r.code, 1);
      assert.deepEqual(r.err, [`tracker-sync: ${message}`]);
      assert.deepEqual(r.out, []);
      assert.deepEqual(r.urls, []);
      assert.deepEqual(r.gh, []);
      assert.equal(r.log, "");
      assert.ok(!readFileSync(join(repo, FEATURE, "deferred.md"), "utf8").includes("Issue:"));
    });
  }
});

// @traces 1036-FR-010
describe("file", () => {
  it("creates an issue with its form's type label and adds it to Project #11 at To do", async () => {
    const gh = world();
    const repo = repoWith();
    writeFileSync(join(repo, "body.md"), "## Goal\n\nA thing.\n");
    const r = await run(["file", "--type", "task", "--title", "Harness: drop the old sync", "--epic", "EP-6", "--priority", "High", "--body-file", join(repo, "body.md")], { gh, repo });
    assert.equal(r.code, 0, r.err.join("\n"));
    const made = issueOf(gh, r.json.issue);
    assert.equal(made.title, `ST-${made.number} Harness: drop the old sync`);
    assert.deepEqual(made.labels.map((l) => l.name).sort(), ["EP-6", "type: task"]);
    assert.equal(gh.itemValues(made.number).Status, "To do");
    assert.equal(gh.itemValues(made.number)["Work type"], "Task");
    assert.equal(gh.itemValues(made.number).Priority, "High");
    assert.equal(r.json.url, `${ISSUES}${made.number}`);
  });

  // @traces 1132-FR-003 1132-FR-004
  it("titles the new issue with its ST id, and a rerun finds the retitled issue instead of filing again", async () => {
    const gh = world();
    const repo = repoWith();
    writeFileSync(join(repo, "body.md"), "## Goal\n\nA thing.\n");
    const argv = ["file", "--type", "task", "--title", "Harness: drop the old sync", "--body-file", join(repo, "body.md")];
    const r = await run(argv, { gh, repo });
    assert.equal(r.code, 0, r.err.join("\n"));
    assert.equal(issueOf(gh, r.json.issue).title, `ST-${r.json.issue} Harness: drop the old sync`);

    const again = await run(argv, { gh, repo });
    assert.equal(again.json.issue, r.json.issue);
  });

  // @traces 1132-FR-003
  it("keeps a title that already carries an ST or EP id", async () => {
    const gh = world();
    const repo = repoWith();
    writeFileSync(join(repo, "body.md"), "body\n");
    const r = await run(["file", "--type", "story", "--title", "ST-77 Old story, refiled", "--body-file", join(repo, "body.md")], { gh, repo });
    assert.equal(issueOf(gh, r.json.issue).title, "ST-77 Old story, refiled");
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

  // @traces 1323-FR-006
  it("next lists the To do issues over REST search, with no feature and no Project scan", async () => {
    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(String(url));
      if (String(url).includes("/search/issues"))
        return new Response(JSON.stringify({ items: [{ number: 77, node_id: "I_77", title: "ST-77 x", html_url: `${ISSUES}77`, labels: [] }] }), { status: 200 });
      return new Response(JSON.stringify({ data: { nodes: [{ id: "I_77", projectItems: { nodes: [{ project: { title: "MotorFix" }, status: { name: "To do" }, priority: { name: "High" } }] }, blockedBy: { nodes: [] } }] } }), { status: 200 });
    };
    const repo = mkdtempSync(join(tmpdir(), "tracker-sync-next-"));
    const r = await run(["next"], { repo, fetchImpl });
    assert.equal(r.code, 0, r.err.join("\n"));
    assert.deepEqual(r.json.next, [{ id: "ST-77", number: 77, title: "ST-77 x", url: `${ISSUES}77`, priority: "High" }]);
    assert.equal(urls.length, 2, urls.join("\n"));
    assert.equal(r.gh.length, 0);
  });

  // @traces 1323-FR-006
  it("next that cannot read GitHub exits 1 and queues nothing to replay", async () => {
    const repo = repoWith();
    const fetchImpl = async () => new Response(JSON.stringify({ message: "Validation Failed" }), { status: 422 });
    const r = await run(["next"], { repo, fetchImpl });
    assert.equal(r.code, 1);
    assert.match(r.err.join("\n"), /tracker-sync: next: .*422/);
    assert.ok(!r.log.includes("PENDING"), r.log);
  });

  // @traces 1323-FR-006
  it("next with an --epic that is not EP-<n> is a usage error", async () => {
    const r = await run(["next", "--epic", "1"]);
    assert.equal(r.code, 64);
    assert.match(r.err.join("\n"), /next: --epic is EP-<n>/);
  });
});

// SC-001: the GitHub path calls GitHub only.
describe("GitHub only", () => {
  it("a whole lifecycle reaches api.github.com and nothing else", async () => {
    const gh = world();
    const repo = repoWith({ comment: "- done\n" });
    const urls = [];
    for (const argv of [["start", "--pr", "335"], ["pr", "335"], ["implement", "--pr", "335"], ["qa", "--pr", "335"], ["finish", "--pr", "335", "--body-file", join(repo, "comment.md")]]) {
      const r = await run(argv, { gh, repo, env: { GH_PROJECT_TOKEN: TOKEN } });
      assert.equal(r.code, 0, `${argv[0]}: ${r.err.join("\n")}`);
      urls.push(...r.urls);
    }
    assert.ok(urls.length > 0);
    assert.ok(urls.every((u) => u.startsWith("https://api.github.com/")), urls.filter((u) => !u.startsWith("https://api.github.com/")).join("\n"));
    assert.equal(gh.itemValues(60).Status, "Done");
  });
});

// @traces 1360-FR-001 1360-FR-002 1360-FR-003 1360-FR-005
describe("an event for another story, run from this feature's worktree", () => {
  // This worktree runs ST-1036 (#60), Implementing, with its own prior recorded; ST-290 (#62) is the Blocked dependent.
  const worktree = (log) => {
    const repo = repoWith();
    writeFileSync(join(repo, ".specify", "run-state.json"), JSON.stringify({ status: "in-progress", prior_status: "Planning" }));
    if (log) {
      mkdirSync(join(repo, "specs", "1290-garage-hours"), { recursive: true });
      writeFileSync(join(repo, "specs", "1290-garage-hours", "tracker-sync.md"), log);
    }
    return repo;
  };
  const runState = (repo) => JSON.parse(readFileSync(join(repo, ".specify", "run-state.json"), "utf8"));
  const prCalls = (r) => r.gh.filter((a) => a[0] === "pr");

  it("unblock returns the dependent to the status its own log says it left, and touches nothing of this worktree", async () => {
    const gh = world({ story: "Implementing" });
    const repo = worktree("# Tracker sync — 1290-garage-hours\n\n- 2026-10-01 · blocked · ST-290 · To do → Blocked — waits on ST-12\n- 2026-10-03 · unblock · ST-290 · Blocked → To do\n- 2026-10-04 · blocked · ST-290 · Planning → Blocked — waits on ST-1036\n");
    const r = await run(["unblock", "--story", "ST-290"], { gh, repo });
    assert.equal(r.code, 0, r.err.join("\n"));
    assert.equal(gh.itemValues(62).Status, "Planning");
    assert.equal(gh.itemValues(60).Status, "Implementing", "this worktree's story is not moved");
    assert.deepEqual(prCalls(r), [], "no read of, label on or comment to this branch's PR");
    assert.equal(runState(repo).prior_status, "Planning", "this worktree's recorded prior is kept");
  });

  it("unblock reads the prior from the dependent's Blocked comment when no log has it", async () => {
    const gh = world({ story: "Implementing" });
    gh.state.comments.set(62, [{ id: "IC_1", body: "Blocked: x\n\n<!-- tracker-sync prior: Implementing -->" }, { id: "IC_2", body: "Blocked: y\n\n<!-- tracker-sync prior: QA -->" }]);
    const r = await run(["unblock", "--story", "ST-290"], { gh, repo: worktree() });
    assert.equal(r.code, 0, r.err.join("\n"));
    assert.equal(gh.itemValues(62).Status, "QA", "the newest Blocked comment wins");
    assert.deepEqual(prCalls(r), []);
  });

  it("the Blocked comment's marker wins over an older block cycle in a stale log", async () => {
    const gh = world({ story: "Implementing" });
    gh.state.comments.set(62, [{ id: "IC_1", body: "Blocked: y\n\n<!-- tracker-sync prior: Planning -->" }]);
    const repo = worktree("# Tracker sync — 1290-garage-hours\n\n- 2026-10-01 · blocked · ST-290 · To do → Blocked — waits on ST-12\n");
    const r = await run(["unblock", "--story", "ST-290"], { gh, repo });
    assert.equal(r.code, 0, r.err.join("\n"));
    assert.equal(gh.itemValues(62).Status, "Planning");
  });

  it("unblock with no recorded prior returns the dependent to To do, not this worktree's status", async () => {
    const gh = world({ story: "Implementing" });
    const repo = worktree();
    const r = await run(["unblock", "--story", "ST-290"], { gh, repo });
    assert.equal(r.code, 0, r.err.join("\n"));
    assert.equal(gh.itemValues(62).Status, "To do");
    assert.deepEqual(prCalls(r), []);
    assert.equal(runState(repo).prior_status, "Planning");
  });

  it("blocked on another story records its prior in the comment, not in this worktree, and leaves this PR alone", async () => {
    const gh = world({ story: "Implementing" });
    const repo = worktree();
    const r = await run(["blocked", "waits", "on", "ST-1036", "--story", "ST-330"], { gh, repo });
    assert.equal(r.code, 0, r.err.join("\n"));
    assert.equal(gh.itemValues(63).Status, "Blocked");
    assert.deepEqual(gh.state.comments.get(63).map((c) => c.body), ["Blocked: waits on ST-1036\n\n<!-- tracker-sync prior: To do -->"]);
    assert.deepEqual(prCalls(r), []);
    assert.equal(runState(repo).prior_status, "Planning");
    const back = await run(["unblock", "--story", "ST-330"], { gh, repo });
    assert.equal(gh.itemValues(63).Status, "To do", back.err.join("\n"));
  });

  it("an explicit --pr is still honoured for another story", async () => {
    const gh = world();
    const r = await run(["unblock", "--story", "ST-290", "--pr", "335"], { gh, repo: worktree() });
    assert.equal(r.code, 0, r.err.join("\n"));
    assert.ok(prEdits(r).some((a) => a.includes("335")));
  });

  it("a story this feature's log started is its own, whatever the feature number: run-state prior and its PR", async () => {
    const gh = world({ story: "Implementing" });
    const repo = repoWith();
    writeFileSync(join(repo, FEATURE, "tracker-sync.md"), "# Tracker sync — 1036-github-tracker-lifecycle\n\n- 2026-10-01 · start · ST-290 · To do → Planning\n");
    writeFileSync(join(repo, ".specify", "run-state.json"), JSON.stringify({ prior_status: "QA" }));
    const r = await run(["unblock", "--story", "ST-290"], { gh, repo });
    assert.equal(r.code, 0, r.err.join("\n"));
    assert.equal(gh.itemValues(62).Status, "QA");
    assert.ok(prEdits(r).some((a) => a.includes("335")), "its own PR is labelled");
  });
});

// @traces 1360-FR-004
describe("every gh call carries george-hutanu's token", () => {
  const spawner = ({ login }) => {
    const calls = [];
    const fn = (file, args, opts = {}) => {
      calls.push({ args, env: opts.env ?? {} });
      if (args[0] === "auth") return login ? { code: 0, stdout: `${login}\n`, stderr: "" } : { code: 1, stdout: "", stderr: "no account" };
      if (args[0] === "pr" && args[1] === "view") return { code: 0, stdout: "335\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    };
    return { fn, calls, gh: () => calls.filter((c) => c.args[0] !== "auth") };
  };

  it("a shell without GH_TOKEN gets george-hutanu's login token on every gh call", async () => {
    const s = spawner({ login: "gho_LOGIN_secret" });
    const r = await run(["qa"], { gh: world({ story: "Implementing" }), env: { GH_PROJECT_TOKEN: TOKEN }, tokenRun: s.fn, realGh: true });
    assert.equal(r.code, 0, r.err.join("\n"));
    assert.ok(s.calls.some((c) => c.args.join(" ") === "auth token -u george-hutanu" && !("GH_TOKEN" in c.env)));
    assert.ok(s.gh().length >= 2, "pr view and pr edit ran");
    assert.ok(s.gh().every((c) => c.env.GH_TOKEN === "gho_LOGIN_secret"), JSON.stringify(s.gh().map((c) => c.args)));
    assert.ok(!r.out.join("").includes("gho_LOGIN_secret") && !r.log.includes("gho_LOGIN_secret"));
  });

  it("the session's GH_TOKEN is kept as it is", async () => {
    const s = spawner({ login: "gho_LOGIN_secret" });
    const r = await run(["qa"], { gh: world({ story: "Implementing" }), env: { GH_TOKEN: TOKEN }, tokenRun: s.fn, realGh: true });
    assert.equal(r.code, 0, r.err.join("\n"));
    assert.ok(s.gh().length >= 2 && s.gh().every((c) => c.env.GH_TOKEN === TOKEN));
  });

  it("with no george-hutanu token, no gh call runs as the active account: the label write is PENDING", async () => {
    const s = spawner({ login: null });
    const gh = world({ story: "Implementing" });
    const r = await run(["qa", "--pr", "335"], { gh, env: { GH_PROJECT_TOKEN: TOKEN }, tokenRun: s.fn, realGh: true });
    assert.equal(r.code, 0, r.err.join("\n"));
    assert.equal(gh.itemValues(60).Status, "QA", "the tracker write still lands");
    assert.deepEqual(s.gh(), [], "gh never ran without the token");
    assert.ok(r.log.includes("[TRACKER-SYNC PENDING: labels PR #335"), r.log);
    assert.match(r.log, /george-hutanu/);
  });
});
