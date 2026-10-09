import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { notionClient } from "../lib/notion.mjs";
import { reconcile, RESERVED_FIELD_NAMES, SCHEMA } from "./bootstrap.mjs";
import { createdTitle, createsIssue, fakeGitHub } from "./fixtures/github.mjs";
import { fakeNotion, SECRET, storyId } from "./fixtures/notion.mjs";
import { GitHubError, githubClient, MAX_PAGES } from "./github.mjs";
import { featureTitles, issuePlans, plainValue, runImport, TEXT_MAX } from "./import.mjs";
import { refToken } from "./notion-markdown.mjs";
import { fetchFile, folderCache, folderStore, loadContent, pageLoader } from "./notion-content.mjs";
import { reporter } from "./progress.mjs";
import { readTracker } from "./notion-read.mjs";

const TOKEN = "ghp_SECRET_never_print_me";
const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// The feature page ST-1 names; the import reads its title before any page's content.
const FEATURE = "f0000000-0000-0000-0000-000000000001";
const FEATURE_KEY = "FEATURE-f0000000000000000000000000000001";
const featurePage = (id, name) => ({ object: "page", id, properties: { Name: { type: "title", title: [{ plain_text: name }] } } });

async function tracker(content = {}) {
  const fake = fakeNotion({ ...content, pages: { [FEATURE]: featurePage(FEATURE, "Sign-in"), ...content.pages } });
  const client = notionClient({ token: "ntn_x", fetchImpl: fake.fetchImpl, sleep: async () => {} });
  const t = await readTracker(client);
  t.features = await featureTitles(client, t);
  await loadContent(client, t);
  return t;
}

const clientOf = (gh, fetchImpl = gh.fetchImpl) => githubClient({ token: TOKEN, fetchImpl, sleep: async () => {}, now: () => 0 });

/** A fake GitHub the bootstrap has already run against, with the two PRs the backlog names. */
async function bootstrapped(seed = {}) {
  const gh = fakeGitHub({ pulls: [{ number: 40, state: "closed", merged_at: "2026-09-21T10:00:00Z", body: "Fixes the loop." }, { number: 50, body: "Opening hours." }], ...seed });
  const dir = mkdtempSync(join(tmpdir(), "forms-"));
  dirs.push(dir);
  await reconcile(clientOf(gh), { today: new Date("2026-10-09"), formsDir: dir, log: () => {} });
  return gh;
}

async function importInto(gh, opts = {}) {
  const lines = [];
  const github = clientOf(gh, opts.fetchImpl);
  const exit = await runImport({ github, tracker: opts.tracker ?? (await tracker()), log: (l) => lines.push(l), ...opts });
  return { exit, lines, github };
}

const issueOf = (gh, key) => gh.state.issues.find((i) => i.body.includes(`<!-- motorfix:${key} -->`));
const itemValues = (gh, key) => {
  const p = gh.state.projects[0];
  const item = p.items.find((it) => it.number === issueOf(gh, key).number);
  return Object.fromEntries(
    Object.entries(item.values).map(([fid, v]) => {
      const f = p.fields.find((x) => x.id === fid);
      return [f.name, v.singleSelectOptionId ? f.options.find((o) => o.id === v.singleSelectOptionId).name : (v.date ?? v.number ?? v.text)];
    }),
  );
};
const nonGets = (gh, from = 0) => gh.writes().slice(from);
const plain = (id) => id.replaceAll("-", "");

// @traces 1017-FR-007
// @traces 1017-FR-008
// @traces 1017-FR-009
// @traces 1017-FR-010
// @traces 1017-FR-015
describe("issuePlans", () => {
  it("maps a story to its title, labels, milestone, assignee and fields, with no property repeated in the body", async () => {
    const { plans } = issuePlans(await tracker());
    const st1 = plans.find((p) => p.key === "ST-1");
    assert.equal(st1.title, "ST-1 Driver signs in");
    assert.equal(st1.body, "<!-- motorfix:ST-1 -->");
    assert.ok(!st1.body.includes("## Properties") && !st1.body.includes(SECRET) && !st1.body.includes(refToken("EP-1")));
    assert.deepEqual(st1.gaps, []);
    assert.ok(!/notion\.(so|com|site)/i.test(st1.body));
    assert.deepEqual(st1.labels, ["type: story", "EP-1", "area: front end", "role: Driver"]);
    assert.equal(st1.milestone, "1 - Launch");
    assert.equal(st1.assignee, "george-hutanu");
    assert.equal(st1.state, "open");
    // A sub-issue of its feature, which is a sub-issue of EP-1.
    assert.equal(st1.parent, FEATURE_KEY);
    assert.deepEqual(st1.fields, {
      Status: "To do",
      Priority: "Medium",
      "Work type": "Story",
      Epic: "EP-1",
      "Story points": 3,
      "Planned start": "2026-10-12",
      "Planned end": "2026-10-16",
      Role: "Driver",
      Release: "1 - Launch",
      Area: "front end",
      Feature: "Sign-in",
      "User story": SECRET,
      Took: SECRET,
    });
  });

  it("closes a Done story, links its PR and does not double a title that carries its key", async () => {
    const { plans } = issuePlans(await tracker());
    const st3 = plans.find((p) => p.key === "ST-3");
    assert.equal(st3.title, "ST-3 Fix the sign-in loop");
    assert.equal(st3.state, "closed");
    assert.equal(st3.fields.Status, "Done");
    assert.equal(st3.fields["Merged at"], "2026-09-21");
    assert.equal(st3.fields["QA from"], "2026-09-20");
    assert.equal(st3.pr, 40);
    assert.match(st3.body, /^PR: https:\/\/github\.com\/george-hutanu\/motor-fix\/pull\/40$/m);
  });

  it("gives a story with no epic no parent, epic label, Epic field or milestone, and quiets a mention", async () => {
    const { plans } = issuePlans(await tracker());
    const st4 = plans.find((p) => p.key === "ST-4");
    assert.equal(st4.title, "ST-4 Ask `@alice` about the logs");
    assert.equal(st4.parent, null);
    assert.equal(st4.milestone, null);
    assert.deepEqual(st4.labels, ["type: tech debt"]);
    assert.equal("Epic" in st4.fields, false);
  });

  it("puts a story with two epics under the first and says so", async () => {
    const { plans, warnings } = issuePlans(await tracker());
    assert.equal(plans.find((p) => p.key === "ST-5").parent, "EP-1");
    assert.ok(warnings.some((w) => w.includes("ST-5") && w.includes("EP-1")));
  });

  it("imports an unknown Status as To do and says so", async () => {
    const { plans, warnings } = issuePlans(await tracker());
    const st6 = plans.find((p) => p.key === "ST-6");
    assert.equal(st6.fields.Status, "To do");
    assert.equal("Priority" in st6.fields, false);
    assert.ok(warnings.some((w) => w.includes("ST-6") && w.includes("In review")));
  });

  it("writes no Ready to work field; readiness is Status To do and no open blocked-by", async () => {
    const { plans } = issuePlans(await tracker());
    for (const p of plans) assert.equal("Ready to work" in p.fields, false, p.key);
    assert.deepEqual(plans.find((p) => p.key === "ST-7").blockers, ["ST-1"]);
  });

  it("maps an epic's Status, track, release, timeline and blocking epics", async () => {
    const { plans } = issuePlans(await tracker());
    const ep1 = plans.find((p) => p.key === "EP-1");
    assert.equal(ep1.title, "EP-1 Foundations");
    assert.deepEqual(ep1.labels, ["epic", "track: Platform"]);
    assert.equal(ep1.milestone, "1 - Launch");
    assert.deepEqual(ep1.fields, { Status: "Implementing", Priority: "Highest", "Work type": "Epic", Epic: "EP-1", "Planned start": "2026-10-12", "Planned end": "2026-12-04", Track: "Platform", Release: "1 - Launch", Goal: SECRET, "Done when": SECRET});
    assert.deepEqual(plans.find((p) => p.key === "EP-2").blockers, ["EP-1"]);
    assert.equal(plans.find((p) => p.key === "EP-3").state, "closed");
    assert.equal(plans.find((p) => p.key === "EP-2").fields.Status, "To do");
  });

  it("orders open stories by Priority then ID, then epics, then features, then Done stories", async () => {
    const { plans } = issuePlans(await tracker());
    assert.deepEqual(
      plans.map((p) => p.key),
      ["ST-2", "ST-5", "ST-7", "ST-1", "ST-8", "ST-4", "ST-6", "EP-1", "EP-2", "EP-3", "EP-17", FEATURE_KEY, "ST-3"],
    );
  });

  it("refuses two Notion rows with the same key", async () => {
    const t = await tracker();
    t.stories.push({ ...t.stories[0], id: "dup" });
    assert.throws(() => issuePlans(t), /ST-1/);
  });
});

// @traces 1017-FR-007
// @traces 1017-FR-008
// @traces 1017-FR-009
// @traces 1017-FR-010
// @traces 1017-FR-011
// @traces 1017-FR-013
// @traces 1017-FR-015
describe("a full import", () => {
  it("creates one issue per story, feature and epic, in the plan's order, each in the Project with its fields", async () => {
    const gh = await bootstrapped();
    const { exit, lines } = await importInto(gh);
    assert.equal(exit, 0);
    const imported = gh.state.issues.filter((i) => /<!-- motorfix:/.test(i.body));
    assert.equal(imported.length, 13);
    assert.match(imported[0].title, /^ST-2 /);
    assert.equal(gh.state.projects[0].items.length, 13);
    assert.deepEqual(itemValues(gh, "ST-2"), {
      Status: "Implementing",
      Priority: "Urgent",
      "Work type": "Task",
      Epic: "EP-2",
      Started: "2026-10-01",
      Role: "Garage",
      Release: "2 - Soon after",
      Area: "backend",
      PR: "https://github.com/george-hutanu/motor-fix/pull/50",
      "User story": SECRET,
      Took: SECRET,
    });
    // Every issue is assigned, and every epic's stories carry it three ways: label, Epic field, sub-issue.
    assert.ok(gh.state.issues.every((i) => i.assignees.some((a) => a.login === "george-hutanu")));
    assert.ok(lines.at(-1).startsWith("done"));
  });

  it("sets an item's fields in one request", async () => {
    const gh = await bootstrapped();
    await importInto(gh);
    const sets = gh.requests.filter((r) => r.op === "SetFields");
    assert.equal(sets.length, 13);
  });

  it("closes Done items as completed", async () => {
    const gh = await bootstrapped();
    await importInto(gh);
    for (const key of ["ST-3", "EP-3"]) {
      assert.equal(issueOf(gh, key).state, "closed", key);
      assert.equal(issueOf(gh, key).state_reason, "completed", key);
    }
    assert.equal(issueOf(gh, "ST-1").state, "open");
  });

  it("makes stories sub-issues of their feature, features and featureless stories of their epic, and blockers dependencies", async () => {
    const gh = await bootstrapped();
    await importInto(gh);
    const children = (key) => (gh.state.subIssues.get(issueOf(gh, key).number) ?? []).map((id) => gh.state.issues.find((i) => i.id === id).title.split(" ")[0]).sort();
    assert.deepEqual(children("EP-1"), ["ST-3", "ST-5", "ST-7", "ST-8", "Sign-in"]);
    assert.deepEqual(children(FEATURE_KEY), ["ST-1"]);
    assert.deepEqual(children("EP-17"), ["ST-6"]);
    assert.deepEqual(gh.state.blockedBy.get(issueOf(gh, "ST-7").number), [issueOf(gh, "ST-1").id]);
    assert.deepEqual(gh.state.blockedBy.get(issueOf(gh, "EP-2").number), [issueOf(gh, "EP-1").id]);
    assert.deepEqual(gh.state.blockedBy.get(issueOf(gh, "EP-17").number), [issueOf(gh, "EP-3").id]);
  });

  it("leaves a story out of a full epic's sub-issues, with a warning, and the run still ends done", async () => {
    // GitHub holds at most 100 sub-issues per parent; the fake holds 3, and EP-1 has five stories.
    const gh = await bootstrapped({ subIssueMax: 3 });
    const first = await importInto(gh, { subIssueMax: 3 });
    assert.equal(first.exit, 0);
    assert.equal((gh.state.subIssues.get(issueOf(gh, "EP-1").number) ?? []).length, 3);
    assert.ok(first.lines.some((l) => /^warn\s+EP-1 holds 3 sub-issues, GitHub's limit: \d+ of its sub-issues carry it by label and Epic field only$/.test(l)));
    assert.ok(!first.lines.some((l) => /^failed\s/.test(l)));
    const again = await importInto(gh, { subIssueMax: 3 });
    assert.equal(again.exit, 0);
    assert.ok(!again.lines.some((l) => /^sub-issue\s/.test(l)));
  });

  it("makes a story beside a parent that filled up after it was listed, and the run still ends done", async () => {
    // The listing misses EP-1's newest links, so the import thinks EP-1 has room that GitHub refuses.
    const gh = await bootstrapped({ subIssueMax: 3 });
    await importInto(gh, { subIssueMax: 3 });
    gh.state.listLag = 3;
    const ep1 = issueOf(gh, "EP-1").number;
    const story = gh.state.issues.find((i) => (gh.state.subIssues.get(ep1) ?? []).includes(i.id));
    gh.state.issues.splice(gh.state.issues.indexOf(story), 1);
    gh.state.subIssues.set(ep1, [...gh.state.subIssues.get(ep1).filter((id) => id !== story.id), -1]);
    const { exit, lines } = await importInto(gh, { subIssueMax: 3 });
    assert.equal(exit, 0);
    assert.ok(!lines.some((l) => /^failed\s/.test(l)));
    assert.ok(lines.some((l) => /^warn\s+EP-1 holds 3 sub-issues/.test(l)));
  });

  it("adds a Closes line to an open story's open PR and leaves a merged one alone", async () => {
    const gh = await bootstrapped();
    await importInto(gh);
    assert.equal(gh.state.pulls.get(50).body, `Opening hours.\nCloses george-hutanu/motor-fix-specs#${issueOf(gh, "ST-2").number}`);
    assert.equal(gh.state.pulls.get(40).body, "Fixes the loop.");
  });

  it("fills the template's empty cross-repository Closes line in place", async () => {
    const gh = await bootstrapped({ pulls: [{ number: 50, body: "## Notion story\n\nCloses george-hutanu/motor-fix-specs#\n\n## Notes" }] });
    await importInto(gh);
    assert.equal(gh.state.pulls.get(50).body, `## Notion story\n\nCloses george-hutanu/motor-fix-specs#${issueOf(gh, "ST-2").number}\n\n## Notes`);
  });

  // motor-fix is public: issues, labels and milestones go to motor-fix-specs,
  // and the one write to motor-fix is the Closes line on a PR body.
  it("never writes an issue, label or milestone to the public code repository", async () => {
    const gh = await bootstrapped();
    await importInto(gh);
    const rest = gh.writes().filter((r) => r.path !== "/graphql");
    const creates = gh.writes().filter((r) => r.op === "CreateIssue");
    assert.ok(creates.length > 0 && creates.every((r) => r.body.variables.input.repositoryId === "R_specs"));
    const toCode = rest.filter((r) => r.repo !== "motor-fix-specs");
    assert.ok(toCode.length > 0);
    for (const r of toCode) {
      assert.equal(r.repo, "motor-fix");
      assert.equal(r.method, "PATCH");
      assert.match(r.path, /^\/repos\/george-hutanu\/motor-fix\/pulls\/\d+$/);
      assert.deepEqual(Object.keys(r.body), ["body"]);
      const added = r.body.body.replace("Opening hours.", "").trim();
      assert.match(added, /^Closes george-hutanu\/motor-fix-specs#\d+$/);
    }
  });

  it("carries the page into the issue and writes no Notion address to GitHub", async () => {
    const gh = await bootstrapped();
    await importInto(gh);
    for (const issue of gh.state.issues.filter((i) => /<!-- motorfix:/.test(i.body))) {
      assert.match(issue.body, /^<!-- motorfix:((ST|EP)-\d+|FEATURE-[0-9a-f]{32}) -->(\n|$)/);
      assert.ok(!issue.body.includes("## Properties"), issue.title);
      assert.ok(!issue.body.includes("\uE000"), "a reference token left unresolved");
    }
    for (const w of gh.requests ?? gh.writes()) assert.ok(!/notion\.(so|com|site)/i.test(JSON.stringify(w.body ?? "")));
  });

  it("never prints the token", async () => {
    const gh = await bootstrapped();
    const { lines } = await importInto(gh);
    assert.ok(!lines.join("\n").includes(TOKEN));
  });

  it("waits out a secondary rate limit and loses no item", async () => {
    const gh = await bootstrapped();
    let throttled = false;
    const fetchImpl = async (url, init = {}) => {
      if (!throttled && createsIssue(url, init)) {
        throttled = true;
        return new Response(JSON.stringify({ message: "secondary rate limit" }), { status: 403, headers: { "retry-after": "1" } });
      }
      return gh.fetchImpl(url, init);
    };
    const { exit } = await importInto(gh, { fetchImpl });
    assert.equal(exit, 0);
    assert.ok(throttled);
    assert.equal(gh.state.issues.filter((i) => /<!-- motorfix:/.test(i.body)).length, 13);
  });
});

// @traces 1017-FR-011
// @traces 1017-FR-012
describe("running it again", () => {
  it("makes no content-creating request when everything is imported", async () => {
    const gh = await bootstrapped();
    await importInto(gh);
    const before = gh.writes().length;
    const { exit, lines, github } = await importInto(gh);
    assert.equal(exit, 0);
    assert.equal(github.stats.content, 0);
    assert.equal(gh.writes().length, before);
    assert.ok(lines.some((l) => /^plan\s+create 0 · feature 0 · adopt 0 · update 0 · add-item 0 · set-fields 0/.test(l)));
  });

  it("updates only the field that changed in Notion", async () => {
    const gh = await bootstrapped();
    await importInto(gh);
    const t = await tracker();
    t.stories.find((s) => s.key === "ST-1").priority = "High";
    const from = gh.writes().length;
    await importInto(gh, { tracker: t });
    const writes = nonGets(gh, from);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].op, "SetFields");
    assert.equal(Object.keys(writes[0].body.variables).filter((k) => /^f\d+$/.test(k)).length, 1);
    assert.equal(itemValues(gh, "ST-1").Priority, "High");
  });

  it("puts back a title edited on GitHub and reopens an issue closed there", async () => {
    const gh = await bootstrapped();
    await importInto(gh);
    issueOf(gh, "ST-1").title = "renamed";
    issueOf(gh, "ST-7").state = "closed";
    await importInto(gh);
    assert.equal(issueOf(gh, "ST-1").title, "ST-1 Driver signs in");
    assert.equal(issueOf(gh, "ST-7").state, "open");
  });

  it("stops reading Project items whose cursor never ends after the page cap", async () => {
    const gh = await bootstrapped();
    let pagesRead = 0;
    const fetchImpl = async (url, init) => {
      const body = init?.body ? JSON.parse(init.body) : null;
      if (body?.query?.startsWith("query Items")) {
        pagesRead++;
        const page = { totalCount: 1, pageInfo: { hasNextPage: true, endCursor: "same" }, nodes: [] };
        return new Response(JSON.stringify({ data: { node: { items: page } } }), { status: 200 });
      }
      return gh.fetchImpl(url, init);
    };
    const from = gh.writes().length;
    await assert.rejects(importInto(gh, { fetchImpl }), (e) => e instanceof GitHubError && e.type === "pages");
    assert.equal(pagesRead, MAX_PAGES);
    assert.equal(nonGets(gh, from).length, 0);
  });

  it("gives a story whose feature document appears its link in the Feature field and the feature's issue, and the next run writes nothing", async () => {
    const gh = await bootstrapped();
    await importInto(gh, { tracker: await tracker() });
    const t = await tracker();
    t.stories.find((s) => s.key === "ST-1").title = "Driver signs in";
    t.docs = new Map([["f0000000000000000000000000000001", "docs/reference/features/sign-in.md"]]);
    const from = gh.writes().length;
    await importInto(gh, { tracker: t });
    const writes = nonGets(gh, from);
    const link = "https://github.com/george-hutanu/motor-fix-specs/blob/trunk/docs/reference/features/sign-in.md";
    assert.equal(writes.length, 2);
    assert.deepEqual(writes.map((w) => w.op ?? w.method).sort(), ["PATCH", "SetFields"]);
    assert.equal(itemValues(gh, "ST-1").Feature, `Sign-in ${link}`);
    assert.equal(issueOf(gh, FEATURE_KEY).body, `<!-- motorfix:${FEATURE_KEY} -->\n\nDocs: ${link}`);
    const again = gh.writes().length;
    await importInto(gh, { tracker: t });
    assert.equal(gh.writes().length, again);
  });

  it("adopts an issue filed by hand under the story's key, keeping the person's text below the page", async () => {
    const gh = await bootstrapped({ issues: [{ number: 5, title: "ST-1 Driver signs in (by hand)", body: "typed by a person, see https://www.notion.so/x-0123456789abcdef0123456789abcdef", labels: ["type: story"] }] });
    await importInto(gh);
    const adopted = gh.state.issues.find((i) => i.number === 5);
    assert.match(adopted.body, /^<!-- motorfix:ST-1 -->\n<!-- motorfix:adopted -->/);
    assert.match(adopted.body, /<!-- motorfix:adopted -->\n\ntyped by a person, see \(a Notion page\)$/);
    assert.equal(adopted.title, "ST-1 Driver signs in (by hand)");
    assert.equal(gh.state.issues.filter((i) => /^ST-1\b/.test(i.title)).length, 1);
  });

  it("does not take ST-10 for ST-1", async () => {
    const gh = await bootstrapped({ issues: [{ number: 5, title: "ST-10 something else", body: "" }] });
    await importInto(gh);
    assert.equal(gh.state.issues.find((i) => i.number === 5).body, "");
  });
});

// @traces 1017-FR-012
describe("a lap with a budget", () => {
  it("stops after the budget, says where and how to continue, and exits 3", async () => {
    const gh = await bootstrapped();
    const from = gh.writes().length;
    const { exit, lines } = await importInto(gh, { budget: 5 });
    assert.equal(exit, 3);
    assert.equal(nonGets(gh, from).length, 5);
    assert.ok(lines.some((l) => /^stopped\s+after (ST|EP)-\d+ \(5 of \d+ steps, budget 5 reached\)$/.test(l)));
    assert.ok(lines.includes("continue  node .claude/scripts/tracker/import.mjs --budget 5"));
  });

  it("finishes on the next lap from what GitHub holds, with no duplicate", async () => {
    const gh = await bootstrapped();
    await importInto(gh, { budget: 7 });
    const { exit } = await importInto(gh);
    assert.equal(exit, 0);
    const keys = gh.state.issues.map((i) => i.body.match(/<!-- motorfix:(\S+) -->/)?.[1]).filter(Boolean);
    assert.equal(keys.length, 13);
    assert.equal(new Set(keys).size, 13);
    assert.equal(gh.state.projects[0].items.length, 13);
  });
});

// @traces 1017-FR-012
// @traces 1017-FR-013
describe("guards", () => {
  it("lists what a page would leave behind and writes nothing on a dry run", async () => {
    const t = await tracker({ blocks: { [storyId(1)]: [{ id: "u1", type: "unsupported", has_children: false, unsupported: {} }] } });
    const gh = await bootstrapped();
    const from = gh.writes().length;
    const { exit, lines } = await importInto(gh, { tracker: t, dryRun: true });
    assert.equal(exit, 1);
    assert.equal(nonGets(gh, from).length, 0);
    assert.ok(lines.includes("incomplete ST-1 unsupported block u1: not a block the import can render"), lines.join("\n"));
    assert.ok(lines.some((l) => /^failed\s+1 part\(s\) of Notion pages would be left behind; nothing written$/.test(l)));
  });

  it("never writes a page it cannot carry whole, still writes the others, and exits 1", async () => {
    const t = await tracker({ blocks: { [storyId(1)]: [{ id: "u1", type: "unsupported", has_children: false, unsupported: {} }] } });
    const gh = await bootstrapped();
    const { exit, lines } = await importInto(gh, { tracker: t });
    assert.equal(exit, 1);
    assert.equal(issueOf(gh, "ST-1"), undefined);
    assert.ok(issueOf(gh, "ST-2") && issueOf(gh, "EP-1"));
    assert.ok(lines.includes("incomplete ST-1 unsupported block u1: not a block the import can render"));
    assert.match(lines.at(-1), /^failed\s+1 part\(s\) of Notion pages left behind: 1 page\(s\) not written, the other 12 written$/);
    assert.ok(!lines.some((l) => /^(sub-issue|blocked-by|pr-closes|close|relink)\s+ST-1\b/.test(l)));
  });

  it("names a file whose download stalled as incomplete, and writes nothing", async () => {
    const page = storyId(1);
    const notion = fakeNotion({ blocks: { [page]: [{ id: "img1", type: "image", has_children: false, image: { type: "file", file: { url: "https://files.example/shot.png?sig=1" }, caption: [] } }] } });
    const client = notionClient({ token: "ntn_x", fetchImpl: notion.fetchImpl, sleep: async () => {} });
    const t = await readTracker(client);
    const root = mkdtempSync(join(tmpdir(), "store-"));
    dirs.push(root);
    const stalled = (url) => fetchFile(url, { fetchImpl: () => new Promise(() => {}), sleep: async () => {}, timeoutMs: 20 });
    await loadContent(client, t, { store: folderStore(root), download: stalled });
    const gh = await bootstrapped();
    const from = gh.writes().length;
    const { exit, lines } = await importInto(gh, { tracker: t, dryRun: true });
    assert.equal(exit, 1);
    assert.equal(nonGets(gh, from).length, 0);
    assert.ok(lines.includes("incomplete ST-1 file shot.png: the answer timed out after 0 s (3 tries)"), lines.join("\n"));
  });

  it("keeps a page too long for an issue whole in a file it publishes first, and links it", async () => {
    const long = Array.from({ length: 700 }, (_, i) => ({ id: `p${i}`, type: "paragraph", has_children: false, paragraph: { rich_text: [{ type: "text", plain_text: `${"x".repeat(100)} ${i}`, annotations: {} }] } }));
    const t = await tracker({ blocks: { [storyId(1)]: long } });
    const gh = await bootstrapped();
    const published = [];
    const { exit } = await importInto(gh, { tracker: t, publish: async (files) => published.push(...files) });
    assert.equal(exit, 0);
    assert.deepEqual(published.map((f) => f.path), ["tracker/ST-1/issue.md"]);
    assert.ok(published[0].text.includes(`${"x".repeat(100)} 699`));
    const body = issueOf(gh, "ST-1").body;
    assert.ok(body.length < 65_536);
    assert.ok(body.includes("all of it is in [tracker/ST-1/issue.md](https://github.com/george-hutanu/motor-fix-specs/blob/trunk/tracker/ST-1/issue.md)"));
  });

  it("prints the plan, its counts and every title on a dry run, and writes nothing", async () => {
    const gh = await bootstrapped();
    const from = gh.writes().length;
    const { exit, lines } = await importInto(gh, { dryRun: true });
    assert.equal(exit, 0);
    assert.equal(nonGets(gh, from).length, 0);
    assert.ok(lines.some((l) => /^read\s+notion: 8 stories, 4 epics/.test(l)));
    assert.ok(lines.some((l) => /^plan\s+create 12 · feature 1 · adopt 0 · update 0 · add-item 0 · set-fields 13 · close 2 · reopen 0 · relink \d+ · sub-issue 8 · move 0 · blocked-by 4 · pr-closes 1$/.test(l)));
    assert.ok(lines.some((l) => /^bodies\s+13 pages, [\d,]+ characters; 0 too long for an issue/.test(l)));
    assert.ok(lines.some((l) => /^titles\s+\(13\)$/.test(l)));
    assert.ok(lines.some((l) => l.trim() === "ST-4 Ask `@alice` about the logs"));
    assert.ok(lines.some((l) => /^warn\s+.*ST-5/.test(l)));
  });

  it("refuses before any write when the Project would pass its item limit, and exits 2", async () => {
    const gh = await bootstrapped();
    const from = gh.writes().length;
    const { exit, lines } = await importInto(gh, { maxItems: 12 });
    assert.equal(exit, 2);
    assert.equal(nonGets(gh, from).length, 0);
    assert.ok(lines.some((l) => /13/.test(l) && /12/.test(l)));
  });

  it("asks for the bootstrap first when the Project or its labels are missing", async () => {
    const gh = fakeGitHub();
    const { exit, lines } = await importInto(gh);
    assert.equal(exit, 1);
    assert.equal(gh.writes().length, 0);
    assert.ok(lines.some((l) => /bootstrap/.test(l)));
  });
});

// @traces 1017-FR-007
// @traces 1017-FR-011
// @traces 1017-FR-012
describe("Notion data the import cannot map as typed", () => {
  const planned = async (mut) => {
    const t = await tracker();
    mut(t);
    return issuePlans(t);
  };
  const st = (r, key = "ST-1") => r.plans.find((p) => p.key === key);

  it("collapses whitespace in a title and gives a blank one the key alone", async () => {
    const r = await planned((t) => {
      t.stories[0].title = "  Driver\n signs\tin  ";
      t.epics[0].title = " \n ";
    });
    assert.equal(st(r).title, "ST-1 Driver signs in");
    assert.equal(st(r, "EP-1").title, "EP-1");
  });

  it("drops a blocker that is not imported, or the item itself, with a warning", async () => {
    const r = await planned((t) => {
      t.stories[0].blockers = ["ST-999", "ST-1"];
    });
    assert.deepEqual(st(r).blockers, []);
    assert.ok(r.warnings.some((w) => /ST-1 is blocked by ST-999, which is not imported/.test(w)));
    assert.ok(r.warnings.some((w) => /ST-1 is blocked by ST-1, itself/.test(w)));
  });

  it("gives a story under an epic that is not imported no parent, EP label or Epic field", async () => {
    const r = await planned((t) => {
      t.stories[0].epics = ["EP-99"];
      nameFeatures(t, "ST-1", []);
    });
    assert.equal(st(r).parent, null);
    assert.ok(!st(r).labels.some((l) => /^EP-/.test(l)));
    assert.equal(st(r).fields.Epic, undefined);
    assert.ok(r.warnings.some((w) => /ST-1 is under EP-99, which is not imported/.test(w)));
  });

  it("imports an empty Issue type as Story with a warning", async () => {
    const r = await planned((t) => {
      t.stories[0].type = null;
    });
    assert.equal(st(r).fields["Work type"], "Story");
    assert.ok(st(r).labels.includes("type: story"));
    assert.ok(r.warnings.some((w) => /ST-1 has no Issue type/.test(w)));
  });

  it("writes the PR line only for a motor-fix pull request URL and warns about any other PR value", async () => {
    const r = await planned((t) => {
      t.stories[0].pr = "https://github.com/george-hutanu/motor-fix/pull/50/files?private=notes";
      t.stories[1].pr = "ask Ana about https://example.com/x";
    });
    assert.match(st(r).body, /^PR: https:\/\/github\.com\/george-hutanu\/motor-fix\/pull\/50$/m);
    assert.ok(!st(r, "ST-2").body.includes("PR:"));
    assert.ok(r.warnings.some((w) => /ST-2 has a PR value that is not a motor-fix pull request URL/.test(w)));
  });

  it("finishes with exit 0 when there are warnings, since every step ran", async () => {
    const gh = await bootstrapped();
    const t = await tracker();
    t.stories[0].status = "Someday";
    const { exit, lines } = await importInto(gh, { tracker: t });
    assert.ok(lines.some((l) => /^warn\s+ST-1 has Status "Someday"/.test(l)));
    assert.equal(exit, 0);
    assert.match(lines.at(-1), /^done\s+13 items; 0 steps left; \d+ content requests$/);
  });

  it("warns and skips the Closes line when Notion names a PR GitHub does not have", async () => {
    const gh = await bootstrapped();
    const t = await tracker();
    t.stories.find((s) => s.key === "ST-2").pr = "https://github.com/george-hutanu/motor-fix/pull/77";
    const { exit, lines } = await importInto(gh, { tracker: t });
    assert.equal(exit, 0);
    assert.ok(lines.some((l) => /^warn\s+ST-2 names PR #77, which GitHub does not have/.test(l)));
  });

  it("says it stopped before the first step at budget 0", async () => {
    const gh = await bootstrapped();
    const { exit, lines } = await importInto(gh, { budget: 0 });
    assert.equal(exit, 3);
    assert.ok(lines.some((l) => /^stopped\s+before the first step \(0 of \d+ steps, budget 0 reached\)$/.test(l)));
  });

  it("gives an adopted issue its milestone and assignee in the adopting PATCH, so the next run writes nothing", async () => {
    const gh = await bootstrapped({ issues: [{ number: 5, title: "ST-1 by hand", labels: ["mine"] }] });
    const from = gh.writes().length;
    await importInto(gh);
    const adopt = nonGets(gh, from).find((w) => w.method === "PATCH" && w.path.endsWith("/issues/5"));
    assert.equal(adopt.body.assignees[0], "george-hutanu");
    assert.ok(adopt.body.milestone);
    const after = gh.writes().length;
    const again = await importInto(gh);
    assert.equal(again.exit, 0);
    assert.equal(gh.writes().length, after);
    const issue = gh.state.issues.find((i) => i.number === 5);
    assert.equal(issue.title, "ST-1 by hand");
    assert.deepEqual(issue.labels.map((l) => l.name), ["mine"]);
  });

  it("takes an existing ep-1 label for EP-1 and does not update it on the next run", async () => {
    const gh = await bootstrapped({ labels: ["ep-1"] });
    const { exit } = await importInto(gh);
    assert.equal(exit, 0);
    const after = gh.writes().length;
    await importInto(gh);
    assert.equal(gh.writes().length, after);
  });
});

describe("the feature document index", () => {
  it("maps a Notion id to its document under docs/ only when the file exists", async () => {
    const { docsIndex } = await import("./import.mjs");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const clone = mkdtempSync(join(tmpdir(), "clone-"));
    dirs.push(clone);
    assert.equal(docsIndex(clone).size, 0);
    mkdirSync(join(clone, "docs", "features"), { recursive: true });
    writeFileSync(join(clone, "docs", "features", "sign-in.md"), "# Sign in");
    writeFileSync(join(clone, "docs", "index.json"), JSON.stringify({ files: { "f0000000-0000-0000-0000-000000000001": "features/sign-in.md", f2: "features/missing.md" } }));
    assert.deepEqual([...docsIndex(clone)], [["f0000000000000000000000000000001", "docs/features/sign-in.md"]]);
    writeFileSync(join(clone, "docs", "index.json"), JSON.stringify({ "f0000000-0000-0000-0000-000000000001": "features/sign-in.md" }));
    assert.equal(docsIndex(clone).size, 0, "only the files map is read");
    writeFileSync(join(clone, "docs", "index.json"), JSON.stringify({ files: { "f0000000-0000-0000-0000-000000000001": "features/sign-in.md" } }));
    assert.deepEqual([...docsIndex(clone)], [["f0000000000000000000000000000001", "docs/features/sign-in.md"]]);
  });

  it("reads the Diataxis index's files map and leaves a page with no file out", async () => {
    const { docsIndex } = await import("./import.mjs");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const clone = mkdtempSync(join(tmpdir(), "clone-"));
    dirs.push(clone);
    mkdirSync(join(clone, "docs", "reference", "features"), { recursive: true });
    writeFileSync(join(clone, "docs", "reference", "features", "sign-in.md"), "# Sign in");
    writeFileSync(join(clone, "docs", "index.json"), JSON.stringify({ exported: "2026-10-09T16:59:20.061Z", files: { f1: "docs/reference/features/sign-in.md", f2: null } }));
    assert.deepEqual([...docsIndex(clone)], [["f1", "docs/reference/features/sign-in.md"]]);
  });

  it("maps a board's title to its page in docs/reference/design/", async () => {
    const { designIndex } = await import("./import.mjs");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const clone = mkdtempSync(join(tmpdir(), "clone-"));
    dirs.push(clone);
    assert.equal(designIndex(clone).size, 0);
    mkdirSync(join(clone, "docs", "reference", "design"), { recursive: true });
    writeFileSync(join(clone, "docs", "reference", "design", "results.md"), "# Results");
    const boards = [
      { id: "results", title: "Results + map", canvasPage: "Desktop (Cockpit)", md: "docs/reference/design/results.md", html: "docs/reference/design/Results.dc.html" },
      { id: "gone", title: "Gone", md: "docs/reference/design/gone.md", html: "docs/reference/design/Gone.dc.html" },
    ];
    writeFileSync(join(clone, "docs", "reference", "design", "index.json"), JSON.stringify(boards));
    // Notion names a board as "<canvas page>: <board>"; either form finds it.
    assert.deepEqual([...designIndex(clone)], [
      ["results + map", "docs/reference/design/results.md"],
      ["desktop (cockpit): results + map", "docs/reference/design/results.md"],
    ]);
  });

  it("names a body line that still links Notion or a retired docs/ path", async () => {
    const { staleLinks } = await import("./import.mjs");
    assert.deepEqual(staleLinks("[ok](docs/reference/features/a.md)\nsee docs/index.json"), []);
    assert.deepEqual(staleLinks(`plan: docs/execution-plans/ep-1.md\nhttps://www.${"notion"}.so/x`), [
      "still links an old path (docs/execution-plans)",
      "still links a Notion URL",
    ]);
  });

  it("finds the specs clone where specs-repo.mjs says, else .motor-fix-specs, else specs/", async () => {
    const { specsClone } = await import("./repos.mjs");
    const { mkdirSync } = await import("node:fs");
    const root = mkdtempSync(join(tmpdir(), "root-"));
    dirs.push(root);
    assert.equal(specsClone(root), join(root, "specs"));
    mkdirSync(join(root, ".motor-fix-specs", ".git"), { recursive: true });
    assert.equal(specsClone(root), join(root, ".motor-fix-specs"));
    assert.equal(specsClone(root, { cloneDir: (r) => join(r, "elsewhere") }), join(root, "elsewhere"));
  });
});

// @traces 1017-FR-012
describe("reading and writing together", () => {
  /** A tracker with no content yet and a loader that takes a moment per page, logging each read. */
  async function streaming(events, cache = null) {
    const client = notionClient({ token: "ntn_x", fetchImpl: fakeNotion({}).fetchImpl, sleep: async () => {} });
    const t = await readTracker(client);
    const inner = pageLoader(client, t, { cache });
    const load = async (page) => {
      const fromNotion = !inner.cached(page);
      if (fromNotion) await new Promise((r) => setTimeout(r, 5));
      events.push(`${fromNotion ? "read" : "cache"} ${page.key}`);
      return inner(page);
    };
    load.cached = inner.cached;
    return { t, load, client };
  }
  const watching = (gh, events, delay = 0) => async (url, init = {}) => {
    if (createsIssue(url, init)) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      events.push(`create ${createdTitle(init).split(" ")[0]}`);
    }
    return gh.fetchImpl(url, init);
  };

  it("writes the first page before the last one is read", async () => {
    const events = [];
    const { t, load } = await streaming(events);
    const gh = await bootstrapped();
    const { exit } = await importInto(gh, { tracker: t, load, fetchImpl: watching(gh, events) });
    assert.equal(exit, 0);
    const lastRead = events.findLastIndex((e) => e.startsWith("read "));
    assert.ok(events.findIndex((e) => e.startsWith("create")) < lastRead, events.join(", "));
    assert.equal(events.filter((e) => e.startsWith("create")).length, 13);
  });

  it("serves cached pages without asking Notion, reads them first and writes them while the rest are read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cache-"));
    dirs.push(dir);
    // An earlier run cached the epics only, which come after the open stories in import order.
    const before = await streaming([], folderCache(dir));
    for (const e of before.t.epics) await before.load(e);
    const events = [];
    const { t, load } = await streaming(events, folderCache(dir));
    const gh = await bootstrapped();
    const { exit, lines } = await importInto(gh, { tracker: t, load, fetchImpl: watching(gh, events) });
    assert.equal(exit, 0);
    const epics = t.epics.map((e) => e.key);
    assert.deepEqual(events.filter((e) => e.startsWith("cache")).map((e) => e.split(" ")[1]).sort(), [...epics].sort());
    assert.ok(!events.some((e) => e.startsWith("read EP-")), events.join(", "));
    // The cached epics are all read before the first story is asked of Notion, and the first issue written is one of them.
    assert.ok(events.findIndex((e) => e.startsWith("read ")) > events.findLastIndex((e) => e.startsWith("cache ")));
    assert.match(events.find((e) => e.startsWith("create")), /^create EP-/);
    assert.ok(lines.includes(`read      notion: 13 pages' content, ${12 - epics.length} read from Notion, the rest from the cache`), lines.filter((l) => l.startsWith("read")).join("\n"));
  });

  it("reads several pages from Notion at once, and still writes each issue once", async () => {
    const client = notionClient({ token: "ntn_x", fetchImpl: fakeNotion({}).fetchImpl, sleep: async () => {} });
    const t = await readTracker(client);
    const inner = pageLoader(client, t);
    let open = 0;
    let most = 0;
    const load = async (page) => {
      open++;
      most = Math.max(most, open);
      await new Promise((r) => setTimeout(r, 5));
      open--;
      return inner(page);
    };
    load.cached = inner.cached;
    const gh = await bootstrapped();
    const { exit } = await importInto(gh, { tracker: t, load });
    assert.equal(exit, 0);
    assert.ok(most > 1 && most <= 4, `at most ${most} reads at once`);
    assert.equal(gh.state.issues.length, 13);
  });

  it("keeps reading while a slow writer works, so the reader runs ahead", async () => {
    const events = [];
    const { t, load } = await streaming(events);
    const gh = await bootstrapped();
    const { exit } = await importInto(gh, { tracker: t, load, fetchImpl: watching(gh, events, 40) });
    assert.equal(exit, 0);
    const third = events.filter((e) => e.startsWith("create"))[2];
    const readsBefore = events.slice(0, events.indexOf(third)).filter((e) => e.startsWith("read ")).length;
    assert.ok(readsBefore >= 8, `only ${readsBefore} pages read before the third issue was written: ${events.join(", ")}`);
  });

  it("stops reading when the budget ends a lap, and the next lap resumes from GitHub and the cache", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cache-"));
    dirs.push(dir);
    const gh = await bootstrapped();
    const first = [];
    const lap1 = await streaming(first, folderCache(dir));
    const one = await importInto(gh, { tracker: lap1.t, load: lap1.load, budget: 4 });
    assert.equal(one.exit, 3);
    assert.ok(first.length < 12, `read ${first.length} pages in a lap that stopped early`);
    assert.ok(one.lines.some((l) => /^stopped\s+after (ST|EP)-\d+ \(4 of \d+ steps, budget 4 reached\)$/.test(l)));
    const lap2 = await streaming([], folderCache(dir));
    const two = await importInto(gh, { tracker: lap2.t, load: lap2.load });
    assert.equal(two.exit, 0);
    const keys = gh.state.issues.map((i) => i.body.match(/<!-- motorfix:(\S+) -->/)?.[1]).filter(Boolean);
    assert.equal(new Set(keys).size, 13);
    assert.equal(keys.length, 13);
    assert.ok(two.lines.some((l) => /^read\s+notion: 13 pages' content, \d+ read from Notion, the rest from the cache$/.test(l)));
  });

  it("prints one progress line per page read and per write step when not on a terminal", async () => {
    const { t, load } = await streaming([]);
    const gh = await bootstrapped();
    const text = [];
    const report = reporter({ write: (s) => text.push(s), tty: false, now: () => 0 });
    const lines = [];
    const exit = await runImport({ github: clientOf(gh), tracker: t, load, log: (l) => (lines.push(l), report.log(l)), progress: report.progress, lap: 2 });
    assert.equal(exit, 0);
    const progressLines = text.filter((x) => x.startsWith("progress"));
    const steps = lines.filter((l) => /^(create|feature|adopt|update|add-item|set-fields|close|reopen|relink|sub-issue|move|blocked-by|pr-closes)\s/.test(l)).length;
    assert.equal(progressLines.length, 13 + steps);
    assert.ok(text.every((x) => x.endsWith("\n") && !x.includes("\r")));
    assert.ok(progressLines.some((x) => /^progress  read \d+\/13 · written \d+\/13 · step 1\/\d \(create\) · (ST|EP)-\d+ · lap 2\n$/.test(x)), progressLines.slice(0, 3).join(""));
  });
});

// @traces 1017-FR-009
describe("every property in a field of its own", () => {
  const rich = (text) => ({ type: "rich_text", rich_text: [{ plain_text: text }] });
  it("reads each Notion property type as plain data", () => {
    assert.equal(plainValue(rich(" a b ")), "a b");
    assert.equal(plainValue({ type: "number", number: 4 }), 4);
    assert.deepEqual(plainValue({ type: "date", date: { start: "2026-10-04T22:05:00.000+00:00", end: "2026-10-05T00:26:00.000+00:00" } }), { start: "2026-10-04", end: "2026-10-05" });
    assert.deepEqual(plainValue({ type: "multi_select", multi_select: [{ name: "x" }, { name: "y" }] }), ["x", "y"]);
    assert.deepEqual(plainValue({ type: "rollup", rollup: { type: "array", array: [{ type: "select", select: { name: "Platform" } }, { type: "url", url: null }] } }), ["Platform"]);
    assert.equal(plainValue({ type: "rollup", rollup: { type: "number", number: 12 } }), 12);
    assert.equal(plainValue({ type: "place", place: { name: "Cluj" } }), "Cluj");
    assert.equal(plainValue({ type: "checkbox", checkbox: true }), true);
  });

  it("fills the Project fields from rollups, date ranges, relations and long text, cut short and with no Notion address", async () => {
    const t = await tracker();
    const st1 = t.stories.find((s) => s.key === "ST-1");
    const epic = t.epics.find((e) => e.key === "EP-1");
    st1.created = "2026-09-01";
    const props = st1.content.properties;
    props.Work = { type: "date", date: { start: "2026-10-04T22:05:00.000+00:00", end: "2026-10-05T00:26:00.000+00:00" } };
    props.Design = { type: "rollup", rollup: { type: "array", array: [{ type: "url", url: "https://claude.ai/artifact/abc" }] } };
    props["Design boards"] = { type: "rollup", rollup: { type: "array", array: [rich("Desktop: Home | Mobile: Home")] } };
    props.Component = { type: "rollup", rollup: { type: "array", array: [{ type: "select", select: { name: "Garage account" } }] } };
    props.Session = { type: "select", select: { name: "F4" } };
    props.Took = rich(`see https://www.notion.so/abc123 ${"x".repeat(2000)}`);
    epic.content.properties.Weeks = { type: "number", number: 6 };
    epic.content.properties["Story count"] = { type: "rollup", rollup: { type: "number", number: 5 } };
    t.titles.set(st1.feature, "Sign in");
    const { plans } = issuePlans(t);
    const f = plans.find((p) => p.key === "ST-1").fields;
    assert.equal(f["Work start"], "2026-10-04");
    assert.equal(f["Work end"], "2026-10-05");
    assert.equal(f.Design, "https://claude.ai/artifact/abc");
    assert.equal(f["Design boards"], "Desktop: Home | Mobile: Home");
    assert.equal(f.Component, "Garage account");
    assert.equal(f.Session, "F4");
    assert.equal(f.Feature, "Sign in");
    assert.equal(f["Created in Notion"], "2026-09-01");
    assert.equal(f.Took.length, TEXT_MAX);
    assert.ok(!/notion\.so/.test(f.Took));
    const e = plans.find((p) => p.key === "EP-1").fields;
    assert.equal(e.Weeks, 6);
    assert.equal(e["Story count"], 5);
  });

  it("points Design at the repository's mock home and each board at its page, only where Notion names a design", async () => {
    const t = await tracker();
    const [st1, other] = t.stories;
    const props = st1.content.properties;
    props.Design = { type: "rollup", rollup: { type: "array", array: [{ type: "url", url: "https://claude.ai/artifact/abc" }] } };
    props["Design boards"] = { type: "rollup", rollup: { type: "array", array: [rich("Home, Lost board")] } };
    for (const k of ["Design", "Design boards"]) {
      delete other.content.properties[k];
      delete other.properties?.[k];
    }
    t.design = new Map([["home", "docs/reference/design/main.md"]]);
    const { plans } = issuePlans(t);
    const f = plans.find((p) => p.key === st1.key).fields;
    assert.match(f.Design, /docs\/reference\/design\/index\.md$/);
    assert.match(f["Design boards"], /docs\/reference\/design\/main\.md.*Lost board/);
    // Notion's own shape: "<canvas page>: <board>" joined by " | ", a board's name holding commas.
    props["Design boards"] = { type: "rollup", rollup: { type: "array", array: [rich("Desktop (Cockpit): Home | Dashboards (Cockpit): Day sheet · print, PDF, WhatsApp | Mobile (Cockpit): all nine mobile boards")] } };
    t.design = new Map([
      ["home", "docs/reference/design/main.md"],
      ["desktop (cockpit): home", "docs/reference/design/main.md"],
      ["day sheet · print, pdf, whatsapp", "docs/reference/design/dash-sheet.md"],
      ["dashboards (cockpit): day sheet · print, pdf, whatsapp", "docs/reference/design/dash-sheet.md"],
    ]);
    const boards = issuePlans(t).plans.find((p) => p.key === st1.key).fields["Design boards"];
    assert.equal(
      boards,
      ["main.md", "dash-sheet.md"].map((m) => `https://github.com/george-hutanu/motor-fix-specs/blob/trunk/docs/reference/design/${m}`).join(", ") + ", Mobile (Cockpit): all nine mobile boards",
    );
    const g = plans.find((p) => p.key === other.key).fields;
    assert.equal(g.Design ?? null, null);
    assert.equal(g["Design boards"] ?? null, null);
  });

  it("writes only fields the bootstrap makes, never one of GitHub's own", async () => {
    const reserved = new Set(RESERVED_FIELD_NAMES.map((n) => n.toLowerCase()));
    const schema = new Set(SCHEMA.fields.map((f) => f.name));
    const t = await tracker();
    for (const r of [...t.stories, ...t.epics]) r.created = "2026-09-01";
    const names = new Set(issuePlans(t).plans.flatMap((p) => Object.keys(p.fields)));
    assert.ok(names.has("Created in Notion"));
    for (const name of names) {
      assert.ok(schema.has(name), `${name} is not in the bootstrap's schema`);
      if (name !== "Status") assert.ok(!reserved.has(name.toLowerCase()), `${name} is a GitHub field`);
    }
  });

  it("refuses a field of the right name that is one of GitHub's own, before any write", async () => {
    const gh = await bootstrapped();
    const p = gh.state.projects[0];
    const mine = p.fields.find((f) => f.name === "Created in Notion");
    mine.dataType = "CREATED";
    const t = await tracker();
    for (const r of [...t.stories, ...t.epics]) r.created = "2026-09-01";
    const { exit, lines } = await importInto(gh, { tracker: t });
    assert.equal(exit, 1);
    assert.match(lines.at(-1), /^failed\s+run bootstrap first: missing writable fields Created in Notion \(CREATED\)/);
    assert.equal(gh.state.issues.length, 0);
  });

  it("refuses to write until the bootstrap has made every field the plans use", async () => {
    const gh = await bootstrapped();
    const p = gh.state.projects[0];
    p.fields = p.fields.filter((f) => f.name !== "Took");
    const { exit, lines } = await importInto(gh);
    assert.equal(exit, 1);
    assert.match(lines.at(-1), /^failed\s+run bootstrap first: missing fields .*Took/);
    assert.equal(gh.state.issues.length, 0);
  });
});

// @traces 1017-FR-010
describe("stories attached to their epic", () => {
  it("links a story written in an earlier lap, before its epic had an issue, once the epic exists", async () => {
    const gh = await bootstrapped();
    const one = await importInto(gh, { budget: 3 });
    assert.equal(one.exit, 3);
    const early = gh.state.issues.map((i) => i.body.match(/<!-- motorfix:(\S+) -->/)[1]);
    assert.ok(early.some((k) => k.startsWith("ST-")) && !early.some((k) => k.startsWith("EP-")), early.join(","));
    const two = await importInto(gh);
    assert.equal(two.exit, 0);
    const p = gh.state.projects[0];
    for (const key of ["ST-1", "ST-3", "ST-5", "ST-7", "ST-8"]) {
      const issue = issueOf(gh, key);
      const parent = key === "ST-1" ? FEATURE_KEY : "EP-1";
      assert.ok(issue.labels.some((l) => l.name === "EP-1"), `${key} label`);
      assert.equal(itemValues(gh, key).Epic, "EP-1", `${key} field`);
      assert.ok((gh.state.subIssues.get(issueOf(gh, parent).number) ?? []).includes(issue.id), `${key} sub-issue`);
    }
    assert.ok((gh.state.subIssues.get(issueOf(gh, "EP-1").number) ?? []).includes(issueOf(gh, FEATURE_KEY).id));
    assert.ok(p.items.length === 13);
  });

  it("links each item to its parent, children, blockers and the items it blocks as it is written, before the lap ends", async () => {
    const gh = await bootstrapped();
    // ST-2 ST-5 ST-7 ST-1 (+ ST-7 blocked by it) ST-8 ST-4 ST-6, then EP-1 and its three written stories with no feature: 20 steps
    // (a create puts its issue in the Project, so each item is a create and a set-fields).
    const { exit, lines } = await importInto(gh, { budget: 20 });
    assert.equal(exit, 3);
    const children = (key) => (gh.state.subIssues.get(issueOf(gh, key).number) ?? []).map((id) => gh.state.issues.find((i) => i.id === id).title.split(" ")[0]).sort();
    assert.deepEqual(children("EP-1"), ["ST-5", "ST-7", "ST-8"]);
    assert.deepEqual(gh.state.blockedBy.get(issueOf(gh, "ST-7").number), [issueOf(gh, "ST-1").id]);
    assert.ok(!issueOf(gh, "EP-2"));
    assert.ok(lines.some((l) => /^sub-issue\s+ST-8 under #/.test(l)) && !lines.some((l) => /^create\s+EP-2\b/.test(l)));
    const two = await importInto(gh);
    assert.equal(two.exit, 0);
    assert.deepEqual(children("EP-1"), ["ST-3", "ST-5", "ST-7", "ST-8", "Sign-in"]);
    assert.deepEqual(children(FEATURE_KEY), ["ST-1"]);
    assert.deepEqual(children("EP-2"), ["ST-2"]);
    for (const [, ids] of [...gh.state.subIssues, ...gh.state.blockedBy]) assert.equal(new Set(ids).size, ids.length, "a link posted twice");
    const before = gh.writes().length;
    assert.equal((await importInto(gh)).exit, 0);
    assert.equal(gh.writes().length, before);
  });

  it("rewrites a body an earlier run wrote with a Properties table", async () => {
    const gh = await bootstrapped();
    await importInto(gh);
    const fresh = issueOf(gh, "ST-1").body;
    issueOf(gh, "ST-1").body = `${fresh}\n\n## Properties\n\n| Property | Value |\n| --- | --- |\n| Took | x |`;
    const from = gh.writes().length;
    await importInto(gh);
    const writes = nonGets(gh, from);
    assert.equal(writes.length, 1);
    assert.deepEqual(Object.keys(writes[0].body), ["body"]);
    assert.equal(issueOf(gh, "ST-1").body, fresh);
  });
});

// @traces 1017-FR-013
describe("a dropped connection mid-run", () => {
  /** A fetch that drops every attempt at the matching write `times` times, then lets it through. */
  const dropping = (gh, match, times = Infinity) => {
    let left = times;
    return async (url, init = {}) => {
      if (left > 0 && match(url, init)) {
        left--;
        throw new TypeError("fetch failed");
      }
      return gh.fetchImpl(url, init);
    };
  };

  it("sends an update again after a dropped connection and finishes", async () => {
    const gh = await bootstrapped();
    await importInto(gh);
    const st1 = issueOf(gh, "ST-1");
    st1.body = `${st1.body}\nedited`;
    const { exit, lines } = await importInto(gh, { fetchImpl: dropping(gh, (url, init) => init.method === "PATCH" && url.endsWith(`/issues/${st1.number}`), 1) });
    assert.equal(exit, 0, lines.join("\n"));
    assert.ok(lines.some((l) => /^update\s+ST-1 /.test(l)));
  });

  it("ends only that page's steps when a create keeps failing, writes the others and exits 3; the next lap finishes", async () => {
    const gh = await bootstrapped();
    const isSt1 = (url, init) => createsIssue(url, init) && createdTitle(init).startsWith("ST-1 ");
    const one = await importInto(gh, { fetchImpl: dropping(gh, isSt1) });
    assert.equal(one.exit, 3, one.lines.join("\n"));
    assert.ok(one.lines.some((l) => /^retry\s+ST-1 create: .*fetch failed; the page's other steps wait for the next lap$/.test(l)));
    assert.match(one.lines.at(-2), /^stopped\s+after network errors on 1 step\(s\) \(ST-1 create\)/);
    assert.match(one.lines.at(-1), /^continue\s+node \.claude\/scripts\/tracker\/import\.mjs$/);
    assert.equal(issueOf(gh, "ST-1"), undefined);
    assert.equal(gh.state.issues.filter((i) => /<!-- motorfix:/.test(i.body)).length, 12);
    assert.ok(!one.lines.some((l) => /^(sub-issue|blocked-by|pr-closes|close)\s+ST-1\b/.test(l)));
    const two = await importInto(gh);
    assert.equal(two.exit, 0, two.lines.join("\n"));
    assert.equal(gh.state.issues.filter((i) => /<!-- motorfix:/.test(i.body)).length, 13);
    assert.ok((gh.state.subIssues.get(issueOf(gh, FEATURE_KEY).number) ?? []).includes(issueOf(gh, "ST-1").id));
  });

  it("still stops the run on a refusal that is not transient", async () => {
    const gh = await bootstrapped();
    const refuse = async (url, init = {}) =>
      createsIssue(url, init) ? new Response(JSON.stringify({ errors: [{ type: "UNPROCESSABLE", message: "Validation Failed" }] }), { status: 200 }) : gh.fetchImpl(url, init);
    const { exit, lines } = await importInto(gh, { fetchImpl: refuse });
    assert.equal(exit, 1);
    assert.match(lines.at(-1), /^failed\s+\S+ create: UNPROCESSABLE: Validation Failed$/);
  });
});

/** Points a story's Feature (or an epic's Features) relation at these Notion pages, in the query result and the read page alike. */
function nameFeatures(t, key, ids) {
  const r = [...t.stories, ...t.epics].find((x) => x.key === key);
  const name = key.startsWith("EP-") ? "Features" : "Feature";
  const prop = { type: "relation", relation: ids.map((id) => ({ id })) };
  r.properties[name] = prop;
  if (r.content?.properties) r.content.properties[name] = prop;
}
const F2 = "f0000000-0000-0000-0000-000000000002";
const F3 = "f0000000-0000-0000-0000-000000000003";
const keyOf = (id) => `FEATURE-${plain(id)}`;
const childrenOf = (gh, key) => (gh.state.subIssues.get(issueOf(gh, key).number) ?? []).map((id) => gh.state.issues.find((i) => i.id === id).title.split(" ")[0]).sort();
const parentsOf = (gh, key) => [...gh.state.subIssues].filter(([, ids]) => ids.includes(issueOf(gh, key).id)).map(([n]) => n);

// @traces 1017-FR-007
// @traces 1017-FR-010
describe("features between an epic and its stories", () => {
  it("plans one issue per Notion feature, titled by its name, its body a marker and its document's link", async () => {
    const t = await tracker();
    t.docs = new Map([[plain(FEATURE), "docs/reference/features/sign-in.md"]]);
    const { plans } = issuePlans(t);
    const feature = plans.find((p) => p.key === FEATURE_KEY);
    assert.equal(feature.title, "Sign-in");
    assert.equal(feature.body, `<!-- motorfix:${FEATURE_KEY} -->\n\nDocs: https://github.com/george-hutanu/motor-fix-specs/blob/trunk/docs/reference/features/sign-in.md`);
    assert.deepEqual(feature.gaps, []);
    assert.deepEqual(feature.labels, ["type: feature", "EP-1"]);
    assert.deepEqual(feature.fields, { "Work type": "Feature", Epic: "EP-1", Release: "1 - Launch" });
    assert.equal(feature.parent, "EP-1");
    assert.equal(feature.state, "open");
    assert.equal(plans.find((p) => p.key === "ST-1").parent, FEATURE_KEY);
    assert.equal(plans.find((p) => p.key === "ST-7").parent, "EP-1");
    // Its key can never be a story's or an epic's.
    assert.ok(!/^(?:ST|EP)-\d+$/.test(feature.key));
    assert.equal(plans.filter((p) => p.key.startsWith("FEATURE-")).length, 1);
  });

  it("reads each feature's title from Notion before any page's content, and names an untitled one by its id with a warning", async () => {
    const fake = fakeNotion({ pages: { [FEATURE]: featurePage(FEATURE, "Sign-in") } });
    const client = notionClient({ token: "ntn_x", fetchImpl: fake.fetchImpl, sleep: async () => {} });
    const t = await readTracker(client);
    nameFeatures(t, "EP-2", [F2]);
    t.features = await featureTitles(client, t);
    assert.deepEqual([...t.features], [[plain(FEATURE), "Sign-in"]]);
    const { plans, warnings } = issuePlans(t);
    assert.equal(plans.find((p) => p.key === keyOf(F2)).title, `Feature ${plain(F2).slice(0, 8)}`);
    assert.ok(warnings.some((w) => w.includes(plain(F2)) && /no title/.test(w)));
  });

  it("titles a feature Notion gives no title by its document's title in the docs index, and warns of one with no document", async () => {
    const fake = fakeNotion({ pages: { [FEATURE]: featurePage(FEATURE, "Sign-in") } });
    const client = notionClient({ token: "ntn_x", fetchImpl: fake.fetchImpl, sleep: async () => {} });
    const t = await readTracker(client);
    nameFeatures(t, "EP-2", [F2, F3]);
    t.features = await featureTitles(client, t);
    t.docs = new Map([
      [plain(FEATURE), "docs/reference/features/sign-in.md"],
      [plain(F2), "docs/reference/features/garage/mf-12-quotes.md"],
    ]);
    t.docTitles = new Map([[plain(F2), "MF-12 Quotes"]]);
    const { plans, warnings } = issuePlans(t);
    const f2 = plans.find((p) => p.key === keyOf(F2));
    assert.equal(f2.title, "MF-12 Quotes");
    assert.match(f2.body, /Docs: https:\/\/github\.com\/george-hutanu\/motor-fix-specs\/blob\/trunk\/docs\/reference\/features\/garage\/mf-12-quotes\.md$/);
    assert.ok(!warnings.some((w) => w.includes(plain(F2))));
    assert.ok(warnings.some((w) => w.startsWith(`${keyOf(F3)}:`) && /no document in docs\/index\.json/.test(w)));
    assert.equal(plans.find((p) => p.key === FEATURE_KEY).title, "Sign-in", "Notion's title comes first");
  });

  it("leaves a feature whose document is at a retired docs/ path unwritten, named as incomplete", async () => {
    const t = await tracker();
    t.docs = new Map([[plain(FEATURE), "docs/features/sign-in.md"]]);
    const feature = issuePlans(t).plans.find((p) => p.key === FEATURE_KEY);
    assert.deepEqual(feature.gaps, ["still links an old path (docs/features)"]);
  });

  it("reads each document's title from its front matter, else its first heading", async () => {
    const { docTitles } = await import("./import.mjs");
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const clone = mkdtempSync(join(tmpdir(), "clone-"));
    dirs.push(clone);
    mkdirSync(join(clone, "docs", "reference", "features"), { recursive: true });
    writeFileSync(join(clone, "docs", "reference", "features", "a.md"), '---\nid: a\ntitle: "MF-1 Sign-in"\nkind: reference\n---\n\n# Other\n');
    writeFileSync(join(clone, "docs", "reference", "features", "b.md"), "# MF-2  Quotes \n\ntext");
    writeFileSync(join(clone, "docs", "reference", "features", "c.md"), "no heading");
    const docs = new Map([
      ["a1", "docs/reference/features/a.md"],
      ["b1", "docs/reference/features/b.md"],
      ["c1", "docs/reference/features/c.md"],
      ["d1", "docs/reference/features/gone.md"],
    ]);
    assert.deepEqual([...docTitles(clone, docs)], [
      ["a1", "MF-1 Sign-in"],
      ["b1", "MF-2 Quotes"],
    ]);
  });

  it("puts a feature under the epic holding most of its stories, an epic's Features counting, ties to the lowest EP", async () => {
    const t = await tracker();
    // F2: ST-2 (EP-2), ST-6 (EP-17), and EP-17 lists it: EP-17 wins. F3: ST-2 (EP-2) and ST-7 (EP-1): a tie, EP-1.
    nameFeatures(t, "ST-2", [F2, F3]);
    nameFeatures(t, "ST-6", [F2]);
    nameFeatures(t, "EP-17", [F2]);
    nameFeatures(t, "ST-7", [F3]);
    const { plans, warnings } = issuePlans(t);
    assert.equal(plans.find((p) => p.key === keyOf(F2)).parent, "EP-17");
    assert.equal(plans.find((p) => p.key === keyOf(F3)).parent, "EP-1");
    assert.equal(plans.find((p) => p.key === "ST-2").parent, keyOf(F2));
    assert.ok(warnings.some((w) => /^ST-2 has 2 features/.test(w)));
  });

  it("keeps a feature open while any of its stories is open and closes it when all are Done", async () => {
    const t = await tracker();
    nameFeatures(t, "ST-3", [F2]);
    nameFeatures(t, "ST-1", [FEATURE]);
    nameFeatures(t, "ST-3", [F2, FEATURE]);
    const { plans } = issuePlans(t);
    assert.equal(plans.find((p) => p.key === keyOf(F2)).state, "closed");
    assert.equal(plans.find((p) => p.key === FEATURE_KEY).state, "open");
  });

  it("creates the feature under its epic and its stories under it, and a second run writes nothing", async () => {
    const gh = await bootstrapped();
    const { exit, lines } = await importInto(gh);
    assert.equal(exit, 0, lines.join("\n"));
    const feature = issueOf(gh, FEATURE_KEY);
    assert.equal(feature.title, "Sign-in");
    assert.deepEqual(feature.labels.map((l) => l.name), ["type: feature", "EP-1"]);
    assert.deepEqual(itemValues(gh, FEATURE_KEY), { "Work type": "Feature", Epic: "EP-1", Release: "1 - Launch" });
    assert.deepEqual(childrenOf(gh, FEATURE_KEY), ["ST-1"]);
    assert.ok(childrenOf(gh, "EP-1").includes("Sign-in") && !childrenOf(gh, "EP-1").includes("ST-1"));
    assert.ok(lines.some((l) => /^feature\s+FEATURE-\w+ → #\d+/.test(l)));
    const before = gh.writes().length;
    assert.equal((await importInto(gh)).exit, 0);
    assert.equal(gh.writes().length, before);
  });

  it("moves a story an earlier import put under its epic to its feature, freeing room in a full epic, and a rerun writes nothing", async () => {
    // The fake holds 4 sub-issues per parent: the old import filled EP-1 with ST-1, ST-5, ST-7, ST-8 and left ST-3 out.
    const gh = await bootstrapped({ subIssueMax: 4 });
    const flat = await tracker();
    for (const s of flat.stories) nameFeatures(flat, s.key, []);
    assert.equal((await importInto(gh, { tracker: flat, subIssueMax: 4 })).exit, 0);
    assert.deepEqual(childrenOf(gh, "EP-1"), ["ST-1", "ST-5", "ST-7", "ST-8"]);

    const t = await tracker();
    nameFeatures(t, "ST-7", [FEATURE]);
    const dry = await importInto(gh, { tracker: t, subIssueMax: 4, dryRun: true });
    assert.ok(dry.lines.some((l) => /^plan\s+create 0 · feature 1 · .* · sub-issue 2 · move 2 · /.test(l)), dry.lines.join("\n"));

    const from = gh.writes().length;
    const { exit, lines } = await importInto(gh, { tracker: t, subIssueMax: 4 });
    assert.equal(exit, 0, lines.join("\n"));
    const moved = new Set(["ST-1", "ST-7"].map((key) => issueOf(gh, key).id));
    const moves = nonGets(gh, from).filter((r) => r.method === "POST" && /\/sub_issues$/.test(r.path) && moved.has(r.body.sub_issue_id));
    assert.equal(moves.length, 2);
    assert.ok(moves.every((r) => r.body.replace_parent === true));
    assert.equal(lines.filter((l) => /^move\s/.test(l)).length, 2);
    assert.ok(lines.some((l) => /^move\s+ST-1 from #\d+ to #\d+/.test(l)));
    assert.deepEqual(childrenOf(gh, FEATURE_KEY), ["ST-1", "ST-7"]);
    assert.deepEqual(childrenOf(gh, "EP-1"), ["ST-3", "ST-5", "ST-8", "Sign-in"]);
    for (const key of ["ST-1", "ST-7"]) assert.equal(parentsOf(gh, key).length, 1, key);
    assert.ok(!lines.some((l) => /^warn\s+EP-1 holds/.test(l)));

    const before = gh.writes().length;
    const again = await importInto(gh, { tracker: t, subIssueMax: 4 });
    assert.equal(again.exit, 0);
    assert.equal(gh.writes().length, before);
    assert.ok(again.lines.some((l) => /^plan\s+create 0 · feature 0 · .* · sub-issue 0 · move 0 · /.test(l)));
  });

  it("gives a sub-issue one parent in the fake GitHub: a second parent is refused unless it replaces the first", async () => {
    const gh = fakeGitHub({ issues: [{ title: "A" }, { title: "B" }, { title: "C" }] });
    const github = clientOf(gh);
    await github.rest("POST", "issues/1/sub_issues", { sub_issue_id: 1003 });
    await assert.rejects(github.rest("POST", "issues/2/sub_issues", { sub_issue_id: 1003 }), (e) => e.type === "422");
    await github.rest("POST", "issues/2/sub_issues", { sub_issue_id: 1003, replace_parent: true });
    assert.deepEqual(gh.state.subIssues.get(1), []);
    assert.deepEqual(gh.state.subIssues.get(2), [1003]);
  });
});
