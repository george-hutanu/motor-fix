import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SCHEMA } from "./tracker/bootstrap.mjs";
import { fakeGitHub } from "./tracker/fixtures/github.mjs";
import { dependsOn, main } from "./tracker-sync.mjs";

// Every run injects fetch and gh: nothing here reaches GitHub.
const TOKEN = "ghp_SECRET_never_print_me";
const FEATURE = "specs/1036-github-tracker-lifecycle";
const PR_URL = "https://github.com/george-hutanu/motor-fix/pull/335";
const ISSUES = "https://github.com/george-hutanu/motor-fix-specs/issues/";
const TODAY = "2026-10-10";
/** The minute the default clock below stands at, in UTC as the log writes it. */
const NOW_STAMP = new Date(2026, 9, 10, 12).toISOString().slice(0, 16).replace("T", " ");
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

async function run(argv, { repo = repoWith(), gh = world(), env = { GH_PROJECT_TOKEN: TOKEN }, tokenRun, fetchImpl, ghFails = () => false, realGh = false, now = () => new Date(2026, 9, 10, 12) } = {}) {
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
    now,
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

const linksOf = (gh, number) => (gh.state.blockedBy.get(number) ?? []).map((id) => id - 1000);
const depsLine = (r) => r.lines.find((l) => l.includes(" · deps · "));
const withBody = (gh, number, body) => {
  issueOf(gh, number).body = body;
  return gh;
};

// @traces 1363-FR-013
describe("dependsOn on hostile and unusual bodies", () => {
  it("a Depends on line and a Blocked by line in one body both count", () => {
    assert.deepEqual(dependsOn("Depends on: #5\n\nBlocked by: ST-9\n"), [{ number: 5 }, { key: "ST-9" }]);
  });

  it("two Depends on lines in one body both count", () => {
    assert.deepEqual(dependsOn("Depends on: #5\n\nDepends on: #6\n"), [{ number: 5 }, { number: 6 }]);
  });

  it("a CRLF body reads like an LF one", () => {
    assert.deepEqual(dependsOn("## Why\r\n\r\nDepends on: #63, ST-290\r\n"), [{ number: 63 }, { key: "ST-290" }]);
    assert.deepEqual(dependsOn("Depends on: none\r\n"), []);
  });

  it("a reference to another repository's issue, a PR url or a longer id is not taken for one of ours", () => {
    for (const line of ["https://github.com/someone/else/issues/9", "https://github.com/george-hutanu/motor-fix/pull/335", "ST-12abc", "XST-12", "EP-3"]) {
      const refs = dependsOn(`Depends on: ${line}\n`);
      assert.ok(refs.every((r) => r.text), `${line}: ${JSON.stringify(refs)}`);
    }
  });

  it("a Depends on mentioned mid-sentence is not a line", () => {
    assert.deepEqual(dependsOn("This story Depends on: #5 for its data.\n"), []);
  });
});

// @traces 1363-FR-013
describe("the blocked-by links on unusual Depends on lines", () => {
  it("an issue that names itself gets no link to itself", async () => {
    const gh = withBody(world(), 60, "Depends on: #60\n");
    const r = await run(["start", "--pr", "335"], { gh });
    assert.equal(r.code, 0, r.err.join("\n"));
    assert.deepEqual(linksOf(gh, 60), []);
  });

  it("the same target named twice is linked once", async () => {
    const gh = withBody(world(), 60, "Depends on: #63, ST-330, " + ISSUES + "63\n");
    const r = await run(["start", "--pr", "335"], { gh });
    assert.equal(r.code, 0, r.err.join("\n"));
    assert.deepEqual(linksOf(gh, 60), [63]);
  });

});

// @traces 1363-FR-014
describe("the claim label on a PR whose issue is not claimed", () => {
  const claimAdds = (r) => prEdits(r).filter((a) => a.includes("--add-label") && a.some((x) => String(x).startsWith("claim: ")));

  it("a PR carrying a claim while its issue has none is not reported and not changed", async () => {
    const r = await run(["pr", "335"], { gh: world({ pr: { labels: ["claim: chief-3"] } }) });
    assert.equal(r.code, 0, r.err.join("\n"));
    assert.deepEqual(claimAdds(r), []);
    assert.ok(!r.log.includes("claim mismatch"), r.log);
    assert.ok(!prEdits(r).some((a) => a.includes("--remove-label")), JSON.stringify(prEdits(r)));
  });

});
