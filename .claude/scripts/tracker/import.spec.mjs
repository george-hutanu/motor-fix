import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { notionClient } from "../lib/notion.mjs";
import { reconcile, RESERVED_FIELD_NAMES, SCHEMA } from "./bootstrap.mjs";
import { fakeGitHub } from "./fixtures/github.mjs";
import { fakeNotion, SECRET, storyId } from "./fixtures/notion.mjs";
import { GitHubError, githubClient, MAX_PAGES } from "./github.mjs";
import { issuePlans, plainValue, runImport, TEXT_MAX } from "./import.mjs";
import { refToken } from "./notion-markdown.mjs";
import { fetchFile, folderCache, folderStore, loadContent, pageLoader } from "./notion-content.mjs";
import { reporter } from "./progress.mjs";
import { readTracker } from "./notion-read.mjs";

const TOKEN = "ghp_SECRET_never_print_me";
const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function tracker(content = {}) {
  const client = notionClient({ token: "ntn_x", fetchImpl: fakeNotion(content).fetchImpl, sleep: async () => {} });
  const t = await readTracker(client);
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
  it("maps a story to its title, a body carrying every property, labels, milestone, assignee and fields", async () => {
    const { plans } = issuePlans(await tracker());
    const st1 = plans.find((p) => p.key === "ST-1");
    assert.equal(st1.title, "ST-1 Driver signs in");
    assert.match(st1.body, /^<!-- motorfix:ST-1 -->\n\n## Properties\n/);
    for (const row of ["| ID | ST-1 |", "| Issue type | Story |", `| Epic | ${refToken("EP-1")} |`, "| Story points | 3 |", "| Assignee | George |", "| Labels | front end |", "| Role | Driver |", "| Ready to work | No |", `| User story | ${SECRET} |`, `| Took | ${SECRET} |`, "| Feature | (an untitled Notion page) |"]) {
      assert.ok(st1.body.includes(row), row);
    }
    assert.deepEqual(st1.gaps, []);
    assert.ok(!/notion\.(so|com|site)/i.test(st1.body));
    assert.deepEqual(st1.labels, ["type: story", "EP-1", "area: front end", "role: Driver"]);
    assert.equal(st1.milestone, "1 - Launch");
    assert.equal(st1.assignee, "george-hutanu");
    assert.equal(st1.state, "open");
    assert.equal(st1.parent, "EP-1");
    assert.deepEqual(st1.fields, {
      Status: "To do",
      Priority: "Medium",
      "Work type": "Story",
      Epic: "EP-1",
      "Ready to work": "Yes",
      "Story points": 3,
      "Planned start": "2026-10-12",
      "Planned end": "2026-10-16",
      Role: "Driver",
      Release: "1 - Launch",
      Area: "front end",
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

  it("is ready to work only when To do with no open blocker", async () => {
    const { plans } = issuePlans(await tracker());
    const ready = (key) => plans.find((p) => p.key === key).fields["Ready to work"];
    assert.equal(ready("ST-7"), "No");
    assert.equal(ready("ST-8"), "Yes");
    assert.equal(ready("ST-5"), "No");
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

  it("orders open stories by Priority then ID, then epics, then Done stories", async () => {
    const { plans } = issuePlans(await tracker());
    assert.deepEqual(
      plans.map((p) => p.key),
      ["ST-2", "ST-5", "ST-7", "ST-1", "ST-8", "ST-4", "ST-6", "EP-1", "EP-2", "EP-3", "EP-17", "ST-3"],
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
  it("creates one issue per story and epic, in the plan's order, each in the Project with its fields", async () => {
    const gh = await bootstrapped();
    const { exit, lines } = await importInto(gh);
    assert.equal(exit, 0);
    const imported = gh.state.issues.filter((i) => /<!-- motorfix:/.test(i.body));
    assert.equal(imported.length, 12);
    assert.match(imported[0].title, /^ST-2 /);
    assert.equal(gh.state.projects[0].items.length, 12);
    assert.deepEqual(itemValues(gh, "ST-2"), {
      Status: "Implementing",
      Priority: "Urgent",
      "Work type": "Task",
      Epic: "EP-2",
      "Ready to work": "No",
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
    assert.equal(sets.length, 12);
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

  it("makes stories sub-issues of their epic and blockers dependencies", async () => {
    const gh = await bootstrapped();
    await importInto(gh);
    const children = (key) => (gh.state.subIssues.get(issueOf(gh, key).number) ?? []).map((id) => gh.state.issues.find((i) => i.id === id).title.split(" ")[0]).sort();
    assert.deepEqual(children("EP-1"), ["ST-1", "ST-3", "ST-5", "ST-7", "ST-8"]);
    assert.deepEqual(children("EP-17"), ["ST-6"]);
    assert.deepEqual(gh.state.blockedBy.get(issueOf(gh, "ST-7").number), [issueOf(gh, "ST-1").id]);
    assert.deepEqual(gh.state.blockedBy.get(issueOf(gh, "EP-2").number), [issueOf(gh, "EP-1").id]);
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
    assert.ok(rest.some((r) => r.repo === "motor-fix-specs" && /\/issues$/.test(r.path)));
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
      assert.match(issue.body, /^<!-- motorfix:(ST|EP)-\d+ -->\n/);
      assert.ok(issue.body.includes(SECRET), issue.title);
      assert.ok(!issue.body.includes("\uE000"), "a reference token left unresolved");
    }
    assert.match(issueOf(gh, "ST-1").body, new RegExp(`\\| Epic \\| #${issueOf(gh, "EP-1").number} \\|`));
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
      if (!throttled && init.method === "POST" && url.endsWith("/issues")) {
        throttled = true;
        return new Response(JSON.stringify({ message: "secondary rate limit" }), { status: 403, headers: { "retry-after": "1" } });
      }
      return gh.fetchImpl(url, init);
    };
    const { exit } = await importInto(gh, { fetchImpl });
    assert.equal(exit, 0);
    assert.ok(throttled);
    assert.equal(gh.state.issues.filter((i) => /<!-- motorfix:/.test(i.body)).length, 12);
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
    assert.ok(lines.some((l) => /^plan\s+create 0 · adopt 0 · update 0 · add-item 0 · set-fields 0/.test(l)));
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

  it("gives a story whose feature document appears its link, and the next run writes nothing", async () => {
    const gh = await bootstrapped();
    await importInto(gh, { tracker: await tracker() });
    const t = await tracker();
    t.stories.find((s) => s.key === "ST-1").title = "Driver signs in";
    t.docs = new Map([["f0000000000000000000000000000001", "docs/features/sign-in.md"]]);
    const from = gh.writes().length;
    await importInto(gh, { tracker: t });
    const writes = nonGets(gh, from);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].method, "PATCH");
    assert.deepEqual(Object.keys(writes[0].body), ["body"]);
    assert.match(issueOf(gh, "ST-1").body, /\| Feature \| \[\(an untitled Notion page\)\]\(https:\/\/github\.com\/george-hutanu\/motor-fix-specs\/blob\/trunk\/docs\/features\/sign-in\.md\) \|/);
    const again = gh.writes().length;
    await importInto(gh, { tracker: t });
    assert.equal(gh.writes().length, again);
  });

  it("adopts an issue filed by hand under the story's key, keeping the person's text below the page", async () => {
    const gh = await bootstrapped({ issues: [{ number: 5, title: "ST-1 Driver signs in (by hand)", body: "typed by a person, see https://www.notion.so/x-0123456789abcdef0123456789abcdef", labels: ["type: story"] }] });
    await importInto(gh);
    const adopted = gh.state.issues.find((i) => i.number === 5);
    assert.match(adopted.body, /^<!-- motorfix:ST-1 -->\n\n## Properties/);
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
    assert.equal(keys.length, 12);
    assert.equal(new Set(keys).size, 12);
    assert.equal(gh.state.projects[0].items.length, 12);
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
    assert.match(lines.at(-1), /^failed\s+1 part\(s\) of Notion pages left behind: 1 page\(s\) not written, the other 11 written$/);
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
    assert.ok(lines.some((l) => /^plan\s+create 12 · adopt 0 · update 0 · add-item 12 · set-fields 12 · close 2 · reopen 0 · relink \d+ · sub-issue 7 · blocked-by 3 · pr-closes 1$/.test(l)));
    assert.ok(lines.some((l) => /^bodies\s+12 pages, [\d,]+ characters; 0 too long for an issue/.test(l)));
    assert.ok(lines.some((l) => /^titles\s+\(12\)$/.test(l)));
    assert.ok(lines.some((l) => l.trim() === "ST-4 Ask `@alice` about the logs"));
    assert.ok(lines.some((l) => /^warn\s+.*ST-5/.test(l)));
  });

  it("refuses before any write when the Project would pass its item limit, and exits 2", async () => {
    const gh = await bootstrapped();
    const from = gh.writes().length;
    const { exit, lines } = await importInto(gh, { maxItems: 11 });
    assert.equal(exit, 2);
    assert.equal(nonGets(gh, from).length, 0);
    assert.ok(lines.some((l) => /12/.test(l) && /11/.test(l)));
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
    assert.match(lines.at(-1), /^done\s+12 items; 0 steps left; \d+ content requests$/);
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
    writeFileSync(join(clone, "docs", "index.json"), JSON.stringify({ "f0000000-0000-0000-0000-000000000001": "features/sign-in.md", f2: "features/missing.md" }));
    assert.deepEqual([...docsIndex(clone)], [["f0000000000000000000000000000001", "docs/features/sign-in.md"]]);
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
    if (init.method === "POST" && /\/issues$/.test(url)) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      events.push(`create ${JSON.parse(init.body).title.split(" ")[0]}`);
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
    assert.equal(events.filter((e) => e.startsWith("create")).length, 12);
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
    assert.ok(lines.includes(`read      notion: 12 pages' content, ${12 - epics.length} read from Notion, the rest from the cache`), lines.filter((l) => l.startsWith("read")).join("\n"));
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
    assert.equal(new Set(keys).size, 12);
    assert.equal(keys.length, 12);
    assert.ok(two.lines.some((l) => /^read\s+notion: 12 pages' content, \d+ read from Notion, the rest from the cache$/.test(l)));
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
    const steps = lines.filter((l) => /^(create|adopt|update|add-item|set-fields|close|reopen|relink|sub-issue|blocked-by|pr-closes)\s/.test(l)).length;
    assert.equal(progressLines.length, 12 + steps);
    assert.ok(text.every((x) => x.endsWith("\n") && !x.includes("\r")));
    assert.ok(progressLines.some((x) => /^progress  read \d+\/12 · written \d+\/12 · step 1\/\d \(create\) · (ST|EP)-\d+ · lap 2\n$/.test(x)), progressLines.slice(0, 3).join(""));
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
      assert.ok(issue.labels.some((l) => l.name === "EP-1"), `${key} label`);
      assert.equal(itemValues(gh, key).Epic, "EP-1", `${key} field`);
      assert.ok((gh.state.subIssues.get(issueOf(gh, "EP-1").number) ?? []).includes(issue.id), `${key} sub-issue`);
    }
    assert.ok(p.items.length === 12);
  });
});
