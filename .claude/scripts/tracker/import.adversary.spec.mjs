import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { notionClient } from "../lib/notion.mjs";
import { reconcile } from "./bootstrap.mjs";
import { createsIssue, fakeClock, fakeGitHub } from "./fixtures/github.mjs";
import { fakeNotion, SECRET, storyId } from "./fixtures/notion.mjs";
import { githubClient } from "./github.mjs";
import { issuePlans, runImport } from "./import.mjs";
import { loadContent } from "./notion-content.mjs";
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
const clientOf = (gh, fetchImpl = gh.fetchImpl, extra = {}) => githubClient({ token: TOKEN, fetchImpl, sleep: async () => {}, now: () => 0, ...extra });

async function bootstrapped(seed = {}) {
  const gh = fakeGitHub({ pulls: [{ number: 40, state: "closed", merged_at: "2026-09-21T10:00:00Z", body: "Fixes the loop." }, { number: 50, body: "Opening hours." }], ...seed });
  const dir = mkdtempSync(join(tmpdir(), "forms-"));
  dirs.push(dir);
  await reconcile(clientOf(gh), { today: new Date("2026-10-09"), formsDir: dir, log: () => {} });
  return gh;
}
async function importInto(gh, opts = {}) {
  const lines = [];
  const github = clientOf(gh, opts.fetchImpl, opts.clientExtra);
  const exit = await runImport({ github, tracker: opts.tracker ?? (await tracker()), log: (l) => lines.push(l), ...opts });
  return { exit, lines, github };
}
const keyOf = (i) => i.body.match(/<!-- motorfix:((?:ST|EP)-\d+) -->/)?.[1];
const snapshot = (gh) => JSON.stringify({ issues: gh.state.issues, pulls: [...gh.state.pulls.values()], items: gh.state.projects[0].items, sub: [...gh.state.subIssues], bl: [...gh.state.blockedBy] });
const planOf = async (mut) => {
  const t = await tracker();
  mut?.(t);
  return issuePlans(t).plans;
};

describe("idempotence", () => {
  it("writes nothing and leaves identical state on a third run", async () => {
    const gh = await bootstrapped();
    await importInto(gh);
    await importInto(gh);
    const snap = snapshot(gh);
    const from = gh.writes().length;
    const { exit, github } = await importInto(gh);
    assert.equal(exit, 0);
    assert.equal(gh.writes().length, from);
    assert.equal(github.stats.content, 0);
    assert.equal(snapshot(gh), snap);
  });

  it("creates each key exactly once", async () => {
    const gh = await bootstrapped();
    await importInto(gh);
    await importInto(gh);
    const keys = gh.state.issues.map(keyOf).filter(Boolean);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(keys.length, 12);
  });

  it("repairs one drifted title with a single PATCH carrying only the title", async () => {
    const gh = await bootstrapped();
    await importInto(gh);
    const st1 = gh.state.issues.find((i) => keyOf(i) === "ST-1");
    st1.title = "ST-1 renamed by hand";
    const from = gh.writes().length;
    await importInto(gh);
    const w = gh.writes().slice(from);
    assert.equal(w.length, 1);
    assert.deepEqual(Object.keys(w[0].body), ["title"]);
  });

  it("reopens an issue closed by hand whose Notion story is open", async () => {
    const gh = await bootstrapped();
    await importInto(gh);
    const st1 = gh.state.issues.find((i) => keyOf(i) === "ST-1");
    st1.state = "closed";
    await importInto(gh);
    assert.equal(st1.state, "open");
  });

  it("does not add the Closes line twice to the open PR", async () => {
    const gh = await bootstrapped();
    await importInto(gh);
    await importInto(gh);
    const body = gh.state.pulls.get(50).body;
    assert.equal(body.match(/Closes george-hutanu\/motor-fix-specs#\d+/g).length, 1);
    assert.doesNotMatch(body, /Closes #\d/);
  });

  it("leaves a merged PR's body untouched", async () => {
    const gh = await bootstrapped();
    await importInto(gh);
    assert.equal(gh.state.pulls.get(40).body, "Fixes the loop.");
  });
});

describe("adopting by anchored title", () => {
  it("adopts a hand-filed ST-1 issue: body gets the marker, title and labels stay, no second issue", async () => {
    const gh = await bootstrapped({ issues: [{ title: "ST-1 Driver signs in (my wording)", body: "my own notes", labels: ["hand"] }] });
    const n = gh.state.issues[0].number;
    await importInto(gh);
    const adopted = gh.state.issues.find((i) => i.number === n);
    assert.ok(adopted.body.includes("<!-- motorfix:ST-1 -->"));
    assert.equal(adopted.title, "ST-1 Driver signs in (my wording)");
    assert.deepEqual(adopted.labels.map((l) => l.name), ["hand"]);
    assert.equal(gh.state.issues.filter((i) => keyOf(i) === "ST-1").length, 1);
  });

  it("does not adopt ST-10 for ST-1", async () => {
    const gh = await bootstrapped({ issues: [{ title: "ST-10 Something else" }] });
    const n = gh.state.issues[0].number;
    await importInto(gh);
    const other = gh.state.issues.find((i) => i.number === n);
    assert.equal(other.body, "");
    assert.ok(gh.state.issues.some((i) => keyOf(i) === "ST-1" && i.number !== n));
  });

  it("does not adopt ST-1Driver (no word boundary) or a title where the key is not at the start", async () => {
    const gh = await bootstrapped({ issues: [{ title: "ST-1Driver typo" }, { title: "See ST-1 Driver signs in" }, { title: "xST-1 Driver" }] });
    const before = gh.state.issues.map((i) => i.number);
    await importInto(gh);
    for (const i of gh.state.issues.filter((x) => before.includes(x.number))) assert.equal(i.body, "", i.title);
  });

  it("adopts a hand-filed issue that is already closed", async () => {
    const gh = await bootstrapped({ issues: [{ title: "ST-1 Driver signs in", state: "closed" }] });
    const n = gh.state.issues[0].number;
    await importInto(gh);
    assert.equal(gh.state.issues.filter((i) => i.title.startsWith("ST-1 ")).length, 1);
    assert.equal(gh.state.issues.find((i) => i.number === n).state, "open");
  });

  it("finds a hand-filed issue past the first hundred of the listing", async () => {
    const filler = Array.from({ length: 150 }, (_, i) => ({ title: `unrelated ${i}` }));
    const gh = await bootstrapped({ issues: [...filler, { title: "ST-7 Driver signs out" }] });
    const n = gh.state.issues.at(-1).number;
    await importInto(gh);
    assert.ok(gh.state.issues.find((i) => i.number === n).body.includes("<!-- motorfix:ST-7 -->"));
    assert.equal(gh.state.issues.filter((i) => /^ST-7\b/.test(i.title)).length, 1);
  });

  it("does not take a pull request numbered like a story for its issue", async () => {
    const gh = await bootstrapped();
    const prBefore = JSON.stringify([...gh.state.pulls.values()].find((p) => p.number === 40));
    await importInto(gh);
    assert.equal(JSON.stringify([...gh.state.pulls.values()].find((p) => p.number === 40)), prBefore);
  });

  it("does not create a third issue when two carry the same marker", async () => {
    const gh = await bootstrapped({ issues: [{ title: "ST-1 a", body: "<!-- motorfix:ST-1 -->" }, { title: "ST-1 b", body: "<!-- motorfix:ST-1 -->" }] });
    await importInto(gh);
    assert.equal(gh.state.issues.filter((i) => keyOf(i) === "ST-1").length, 2);
  });
});

describe("--budget", () => {
  it("with budget 0 writes nothing and exits 3", async () => {
    const gh = await bootstrapped();
    const from = gh.writes().length;
    const { exit } = await importInto(gh, { budget: 0 });
    assert.equal(gh.writes().length, from);
    assert.equal(exit, 3);
  });

  it("never spends more content requests in a lap than the budget", async () => {
    const gh = await bootstrapped();
    for (let lap = 0; lap < 6; lap++) {
      const { github, exit } = await importInto(gh, { budget: 4 });
      assert.ok(github.stats.content <= 4, `lap ${lap} spent ${github.stats.content}`);
      if (exit === 0) break;
    }
  });

  it("laps of one converge on the state a single run reaches", async () => {
    const whole = await bootstrapped();
    await importInto(whole);
    const laps = await bootstrapped();
    let exit = 3;
    for (let i = 0; i < 400 && exit === 3; i++) exit = (await importInto(laps, { budget: 1 })).exit;
    assert.equal(exit, 0);
    assert.equal(snapshot(laps), snapshot(whole));
  });

  it("creates the open stories before the Done ones whatever the lap sizes", async () => {
    const gh = await bootstrapped();
    let exit = 3;
    for (let i = 0; i < 400 && exit === 3; i++) exit = (await importInto(gh, { budget: 2 })).exit;
    const order = gh.state.issues.map(keyOf);
    assert.ok(order.indexOf("ST-3") > order.indexOf("ST-8"));
    assert.ok(order.indexOf("ST-2") < order.indexOf("ST-1"), "Urgent before Medium");
  });

  it("a lap that creates an issue and stops resumes without a duplicate", async () => {
    const gh = await bootstrapped();
    await importInto(gh, { budget: 1 });
    await importInto(gh, { budget: 1 });
    const keys = gh.state.issues.map(keyOf).filter(Boolean);
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe("--max-items", () => {
  it("refuses one past the cap and starts at exactly the cap", async () => {
    const refused = await bootstrapped();
    const from = refused.writes().length;
    assert.equal((await importInto(refused, { maxItems: 11 })).exit, 2);
    assert.equal(refused.writes().length, from);
    const exact = await bootstrapped();
    assert.equal((await importInto(exact, { maxItems: 12 })).exit, 0);
  });

  it("counts items already in the Project toward the cap", async () => {
    const gh = await bootstrapped();
    gh.state.projects[0].items.push(...Array.from({ length: 5 }, (_, i) => ({ id: `PVTI_x${i}`, number: null, values: {} })));
    const from = gh.writes().length;
    assert.equal((await importInto(gh, { maxItems: 16 })).exit, 2);
    assert.equal(gh.writes().length, from);
  });

  it("refuses with a cap of 0", async () => {
    const gh = await bootstrapped();
    const from = gh.writes().length;
    assert.equal((await importInto(gh, { maxItems: 0 })).exit, 2);
    assert.equal(gh.writes().length, from);
  });

  it("does not refuse a rerun that creates nothing at a cap equal to the item count", async () => {
    const gh = await bootstrapped();
    await importInto(gh);
    assert.equal((await importInto(gh, { maxItems: 12 })).exit, 0);
  });
});

describe("--dry-run", () => {
  it("sends no non-GET request against a fresh, a half-imported and a finished Project", async () => {
    const gh = await bootstrapped();
    let from = gh.writes().length;
    await importInto(gh, { dryRun: true });
    assert.equal(gh.writes().length, from);
    await importInto(gh, { budget: 3 });
    from = gh.writes().length;
    await importInto(gh, { dryRun: true });
    assert.equal(gh.writes().length, from);
    await importInto(gh);
    from = gh.writes().length;
    const { github } = await importInto(gh, { dryRun: true });
    assert.equal(gh.writes().length, from);
    assert.equal(github.stats.content, 0);
  });

  it("ignores the budget and the cap guard's exit codes when nothing would be written", async () => {
    const gh = await bootstrapped();
    await importInto(gh);
    const { exit } = await importInto(gh, { dryRun: true, budget: 0 });
    assert.equal(exit, 0);
  });

  it("prints a title line for each issue it would publish and nothing from the private text", async () => {
    const gh = await bootstrapped();
    const { lines } = await importInto(gh, { dryRun: true });
    assert.ok(lines.some((l) => l.trim().startsWith("ST-1 ")));
    assert.ok(!lines.join("\n").includes(SECRET));
  });
});

describe("public repository hygiene", () => {
  it("sends no Notion address to GitHub, even from a page full of them", async () => {
    const link = (url) => ({ type: "text", plain_text: "see", href: url, text: { content: "see", link: { url } } });
    const t = await tracker({
      blocks: {
        [storyId(1)]: [
          { id: "b1", type: "paragraph", has_children: false, paragraph: { rich_text: [link(`https://www.notion.so/Garage-${storyId(2).replaceAll("-", "")}`), { type: "mention", plain_text: "Old", mention: { type: "page", page: { id: storyId(3) } }, href: "https://www.notion.so/x" }] } },
          { id: "b2", type: "bookmark", has_children: false, bookmark: { url: "https://acme.notion.site/Secret-0123456789abcdef0123456789abcdef", caption: [] } },
          { id: "b3", type: "paragraph", has_children: false, paragraph: { rich_text: [{ type: "text", plain_text: "raw https://app.notion.com/p/abc and notion.so", text: { content: "" } }] } },
        ],
      },
    });
    const gh = await bootstrapped();
    const { exit, lines } = await importInto(gh, { tracker: t });
    assert.equal(exit, 0, lines.filter((l) => /^(incomplete|failed)/.test(l)).join("\n"));
    assert.ok(!/notion\.(so|com|site)/i.test(JSON.stringify(gh.requests.map((r) => [r.path, r.query, r.body]))));
    const body = gh.state.issues.find((i) => keyOf(i) === "ST-1").body;
    const number = (key) => gh.state.issues.find((i) => keyOf(i) === key).number;
    assert.ok(body.includes(`see (#${number("ST-2")})`), body);
    assert.ok(body.includes(`#${number("ST-3")}`));
  });

  it("refuses a GitHub write that names a Notion address, whatever builds it", async () => {
    const gh = await bootstrapped();
    const github = clientOf(gh);
    await assert.rejects(github.rest("POST", "issues", { title: "x", body: "https://www.notion.so/abc" }), (e) => e.type === "notion");
    await assert.rejects(github.graphql("mutation X { a }", { body: "app.notion.com" }), (e) => e.type === "notion");
  });

  it("rewrites an issue an earlier version created with Notion links", async () => {
    const gh = await bootstrapped({ issues: [{ number: 3, title: "ST-1 Driver signs in", body: "<!-- motorfix:ST-1 -->\nNotion: https://app.notion.com/p/50000000000000000000000000000001", labels: [] }] });
    const { exit } = await importInto(gh);
    assert.equal(exit, 0);
    const body = gh.state.issues.find((i) => i.number === 3).body;
    assert.equal(body, "<!-- motorfix:ST-1 -->");
    assert.ok(!/notion\./i.test(body));
  });

  it("keeps a newline in a Notion title out of the issue title", async () => {
    const plans = await planOf((t) => {
      t.stories[0].title = "Line one\nLine two";
    });
    assert.ok(!plans.find((p) => p.key === "ST-1").title.includes("\n"));
  });

  it("never sends the GitHub token anywhere but the Authorization header", async () => {
    const gh = await bootstrapped();
    await importInto(gh);
    for (const r of gh.requests) {
      const h = { ...r.headers };
      delete h.Authorization;
      delete h.authorization;
      assert.ok(!JSON.stringify([r.body, r.path, r.query, h]).includes(TOKEN));
    }
  });
});

describe("the token never appears in output", () => {
  it("prints nothing with the token when a request fails with it in the body", async () => {
    const gh = await bootstrapped();
    let n = 0;
    const fetchImpl = async (url, init) => {
      if (createsIssue(url, init) && ++n === 3) return new Response(JSON.stringify({ message: `echo ${TOKEN}` }), { status: 422 });
      return gh.fetchImpl(url, init);
    };
    const { exit, lines } = await importInto(gh, { fetchImpl });
    assert.equal(exit, 1);
    assert.ok(lines.some((l) => /^failed\s+(ST|EP)-\d+/.test(l)));
    assert.ok(!lines.join("\n").includes(TOKEN));
  });

  it("does not print the token in a normal run", async () => {
    const gh = await bootstrapped();
    const { lines } = await importInto(gh);
    assert.ok(!lines.join("\n").includes(TOKEN));
  });
});

describe("rate limits", () => {
  it("waits Retry-After on a throttled issue creation and still creates that issue once", async () => {
    const gh = await bootstrapped();
    const clock = fakeClock();
    let thrown = false;
    const fetchImpl = async (url, init) => {
      if (!thrown && createsIssue(url, init)) {
        thrown = true;
        return new Response("{}", { status: 403, headers: { "retry-after": "30" } });
      }
      return gh.fetchImpl(url, init);
    };
    const github = githubClient({ token: TOKEN, fetchImpl, sleep: clock.sleep, now: clock.now });
    const exit = await runImport({ github, tracker: await tracker(), log: () => {} });
    assert.equal(exit, 0);
    assert.ok(clock.waits.includes(30_000));
    const keys = gh.state.issues.map(keyOf).filter(Boolean);
    assert.equal(keys.length, 12);
    assert.equal(new Set(keys).size, 12);
  });

  it("waits until the reset on x-ratelimit-remaining 0 and drops no item", async () => {
    const gh = await bootstrapped();
    const clock = fakeClock();
    clock.t = 2_000_000;
    let count = 0;
    const fetchImpl = async (url, init) => {
      if (init?.method === "PATCH" && ++count === 2) return new Response("{}", { status: 429, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "2045" } });
      return gh.fetchImpl(url, init);
    };
    const github = githubClient({ token: TOKEN, fetchImpl, sleep: clock.sleep, now: clock.now });
    const exit = await runImport({ github, tracker: await tracker(), log: () => {} });
    assert.equal(exit, 0);
    assert.ok(clock.t >= 2_045_000, "must wait out the reset");
    const again = await importInto(gh);
    assert.equal(again.github.stats.content, 0);
  });

  it("exits 1 naming the item when a wait exceeds the cap, and a rerun finishes the job", async () => {
    const gh = await bootstrapped();
    let blocked = true;
    const fetchImpl = async (url, init) => {
      if (blocked && createsIssue(url, init)) return new Response("{}", { status: 429, headers: { "retry-after": "9999" } });
      return gh.fetchImpl(url, init);
    };
    const { exit, lines } = await importInto(gh, { fetchImpl });
    assert.equal(exit, 1);
    assert.ok(lines.some((l) => /^failed\s+(ST|EP)-\d+/.test(l)));
    blocked = false;
    assert.equal((await importInto(gh)).exit, 0);
    assert.equal(gh.state.issues.map(keyOf).filter(Boolean).length, 12);
  });
});

describe("Ready to work", () => {
  it("is never a field the import writes, whatever Notion's checkbox says", async () => {
    const plans = await planOf((t) => {
      const s = t.stories.find((x) => x.key === "ST-7");
      s.ready = true;
      s.readyToWork = true;
    });
    for (const p of plans) assert.equal("Ready to work" in p.fields, false, p.key);
    assert.doesNotMatch(plans.find((p) => p.key === "ST-7").body ?? "", /Ready to work/);
  });

  it("runs on a Project that still has the old field and leaves its values alone", async () => {
    const gh = await bootstrapped();
    const p = gh.state.projects[0];
    p.fields.push({ id: "F_old", name: "Ready to work", dataType: "SINGLE_SELECT", options: [{ id: "O_y", name: "Yes", color: "GREEN" }, { id: "O_n", name: "No", color: "GRAY" }] });
    const { exit } = await importInto(gh);
    assert.equal(exit, 0);
    assert.ok(p.items.length > 0);
    assert.ok(p.items.every((it) => !("F_old" in it.values)));
  });
});

describe("degenerate backlogs", () => {
  it("imports an empty Notion backlog as zero work and exits 0", async () => {
    const gh = await bootstrapped();
    const t = await tracker();
    t.stories = [];
    t.epics = [];
    const from = gh.writes().length;
    const { exit, lines } = await importInto(gh, { tracker: t });
    assert.equal(exit, 0, lines.filter((l) => /^(incomplete|failed)/.test(l)).join("\n"));
    assert.equal(gh.writes().length, from);
  });

  it("stops before writing when two stories share a key", async () => {
    const gh = await bootstrapped();
    const t = await tracker();
    t.stories.push({ ...t.stories[0], id: "dup" });
    const from = gh.writes().length;
    const r = await importInto(gh, { tracker: t }).catch((e) => ({ exit: 1, thrown: e }));
    assert.notEqual(r.exit, 0);
    assert.equal(gh.writes().length, from);
  });

  it("does not double the key when a Notion title already begins with it", async () => {
    const plans = await planOf();
    assert.equal(plans.find((p) => p.key === "ST-3").title, "ST-3 Fix the sign-in loop");
  });

  it("gives a story with two epics one parent and one sub-issue link", async () => {
    const gh = await bootstrapped();
    await importInto(gh);
    const st5 = gh.state.issues.find((i) => keyOf(i) === "ST-5");
    const parents = [...gh.state.subIssues].filter(([, ids]) => ids.includes(st5.id));
    assert.equal(parents.length, 1);
  });
});
