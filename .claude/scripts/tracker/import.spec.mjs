import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { notionClient } from "../lib/notion.mjs";
import { reconcile } from "./bootstrap.mjs";
import { fakeGitHub } from "./fixtures/github.mjs";
import { fakeNotion, SECRET, storyId } from "./fixtures/notion.mjs";
import { GitHubError, githubClient, MAX_PAGES } from "./github.mjs";
import { issuePlans, runImport } from "./import.mjs";
import { readTracker } from "./notion-read.mjs";

const TOKEN = "ghp_SECRET_never_print_me";
const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function tracker() {
  const notion = fakeNotion();
  return readTracker(notionClient({ token: "ntn_x", fetchImpl: notion.fetchImpl, sleep: async () => {} }));
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
      return [f.name, v.singleSelectOptionId ? f.options.find((o) => o.id === v.singleSelectOptionId).name : (v.date ?? v.number)];
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
  it("maps a story to its title, a body of marker and links, labels, milestone, assignee and fields", async () => {
    const { plans } = issuePlans(await tracker());
    const st1 = plans.find((p) => p.key === "ST-1");
    assert.equal(st1.title, "ST-1 Driver signs in");
    assert.equal(st1.body, `<!-- motorfix:ST-1 -->\nNotion: https://app.notion.com/p/${plain(storyId(1))}\nFeature: https://app.notion.com/p/f0000000000000000000000000000001`);
    assert.deepEqual(st1.labels, ["type: story", "EP-1", "area: front end", "role: Driver"]);
    assert.equal(st1.milestone, "1 - Launch");
    assert.equal(st1.assignee, "george-hutanu");
    assert.equal(st1.state, "open");
    assert.equal(st1.parent, "EP-1");
    assert.deepEqual(st1.fields, {
      Status: "To do",
      Priority: "Medium",
      Type: "Story",
      Epic: "EP-1",
      "Ready to work": "Yes",
      "Story points": 3,
      "Planned start": "2026-10-12",
      "Planned end": "2026-10-16",
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
    assert.match(st3.body, /\nPR: https:\/\/github\.com\/george-hutanu\/motor-fix\/pull\/40$/);
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
    assert.deepEqual(ep1.fields, { Status: "Implementing", Priority: "Highest", Type: "Epic", Epic: "EP-1", "Planned start": "2026-10-12", "Planned end": "2026-12-04" });
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
    assert.deepEqual(itemValues(gh, "ST-2"), { Status: "Implementing", Priority: "Urgent", Type: "Task", Epic: "EP-2", "Ready to work": "No", Started: "2026-10-01" });
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
    assert.equal(gh.state.pulls.get(50).body, `Opening hours.\nCloses #${issueOf(gh, "ST-2").number}`);
    assert.equal(gh.state.pulls.get(40).body, "Fixes the loop.");
  });

  it("writes nothing from a Notion page body: every issue body is the marker and links", async () => {
    const gh = await bootstrapped();
    await importInto(gh);
    for (const issue of gh.state.issues.filter((i) => /<!-- motorfix:/.test(i.body))) {
      const lines = issue.body.split("\n");
      assert.match(lines[0], /^<!-- motorfix:(ST|EP)-\d+ -->$/);
      for (const line of lines.slice(1)) assert.match(line, /^(Notion|Feature|PR): https:\/\/\S+$/);
    }
    assert.ok(!JSON.stringify(gh.state).includes(SECRET));
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

  it("gives a story that later gains a Feature its line, and the next run writes nothing", async () => {
    const gh = await bootstrapped();
    await importInto(gh);
    const t = await tracker();
    t.stories.find((s) => s.key === "ST-7").feature = "f0000000-0000-0000-0000-000000000007";
    const from = gh.writes().length;
    await importInto(gh, { tracker: t });
    const writes = nonGets(gh, from);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].method, "PATCH");
    assert.deepEqual(Object.keys(writes[0].body), ["body"]);
    assert.match(issueOf(gh, "ST-7").body, /\nFeature: https:\/\/app\.notion\.com\/p\/f0000000000000000000000000000007$/);
    const again = gh.writes().length;
    await importInto(gh, { tracker: t });
    assert.equal(gh.writes().length, again);
  });

  it("adopts an issue filed by hand under the story's key, adding only the marker and links", async () => {
    const gh = await bootstrapped({ issues: [{ number: 5, title: "ST-1 Driver signs in (by hand)", body: "typed by a person", labels: ["type: story"] }] });
    await importInto(gh);
    const adopted = gh.state.issues.find((i) => i.number === 5);
    assert.match(adopted.body, /^<!-- motorfix:ST-1 -->\nNotion: /);
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
  it("prints the plan, its counts and every title on a dry run, and writes nothing", async () => {
    const gh = await bootstrapped();
    const from = gh.writes().length;
    const { exit, lines } = await importInto(gh, { dryRun: true });
    assert.equal(exit, 0);
    assert.equal(nonGets(gh, from).length, 0);
    assert.ok(lines.some((l) => /^read\s+notion: 8 stories, 4 epics/.test(l)));
    assert.ok(lines.some((l) => /^plan\s+create 12 · adopt 0 · update 0 · add-item 12 · set-fields 12 · close 2 · reopen 0 · sub-issue 7 · blocked-by 3 · pr-closes 1$/.test(l)));
    assert.ok(lines.some((l) => /^titles\s+\(12, the only Notion text that becomes public\)$/.test(l)));
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
    assert.equal(st(r).fields.Type, "Story");
    assert.ok(st(r).labels.includes("type: story"));
    assert.ok(r.warnings.some((w) => /ST-1 has no Issue type/.test(w)));
  });

  it("publishes only the matched pull request URL and warns about any other PR value", async () => {
    const r = await planned((t) => {
      t.stories[0].pr = "https://github.com/george-hutanu/motor-fix/pull/50/files?private=notes";
      t.stories[1].pr = "ask Ana about https://example.com/x";
    });
    assert.match(st(r).body, /\nPR: https:\/\/github\.com\/george-hutanu\/motor-fix\/pull\/50$/);
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
