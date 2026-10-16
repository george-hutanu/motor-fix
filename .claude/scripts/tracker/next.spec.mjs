import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { fakeClock } from "./fixtures/github.mjs";
import { githubClient } from "./github.mjs";
import { nextTasks } from "./next.mjs";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const issue = (number, title, extra = {}) => ({ number, node_id: `I_${number}`, title, html_url: `https://github.com/george-hutanu/motor-fix-specs/issues/${number}`, labels: [], ...extra });
const node = (number, priority, { status = "To do", blockers = [], project = "MotorFix" } = {}) => ({
  id: `I_${number}`,
  projectItems: { nodes: [{ project: { title: project }, status: status ? { name: status } : null, priority: priority ? { name: priority } : null }] },
  blockedBy: { nodes: blockers.map((state) => ({ state })) },
});

/** A fetch answering the REST search (pages of `found`) and the Triage query, recording each request. */
function world(found, nodes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    if (String(url).startsWith("https://api.github.com/search/issues")) {
      const page = Number(new URL(url).searchParams.get("page"));
      return json({ total_count: found.length, items: found.slice((page - 1) * 100, page * 100) });
    }
    if (String(url) === "https://api.github.com/graphql") {
      const ids = new Set(JSON.parse(init.body).variables.ids);
      return json({ data: { nodes: nodes.filter((n) => ids.has(n.id)) } });
    }
    return json({ message: "Not Found" }, 404);
  };
  const clock = fakeClock();
  return { calls, github: githubClient({ token: "t", fetchImpl, sleep: clock.sleep, now: clock.now }) };
}

// @traces 1323-FR-006
describe("next task", () => {
  it("searches the open issues that need no confirmation over REST, of one epic when named", async () => {
    const { github, calls } = world([], []);
    await nextTasks(github);
    await nextTasks(github, { epic: "EP-1" });
    const q = (i) => new URL(calls[i].url).searchParams.get("q");
    assert.equal(new URL(calls[0].url).pathname, "/search/issues");
    assert.equal(q(0), "repo:george-hutanu/motor-fix-specs is:issue is:open -label:needs-confirmation");
    assert.equal(q(1), "repo:george-hutanu/motor-fix-specs is:issue is:open -label:needs-confirmation label:EP-1");
    assert.equal(calls.length, 2, "no GraphQL call when nothing is found");
  });

  // @traces 1324-FR-013
  it("orders by Project priority, then by issue number", async () => {
    const found = [issue(40, "ST-40 Low one"), issue(12, "ST-12 Urgent later"), issue(9, "ST-9 Urgent first"), issue(30, "ST-30 no priority"), issue(20, "ST-20 High")];
    const nodes = [node(40, "Low"), node(12, "Urgent"), node(9, "Urgent"), node(30, null), node(20, "High")];
    const { github, calls } = world(found, nodes);
    const next = await nextTasks(github);
    assert.deepEqual(
      next.map((t) => [t.id, t.number, t.priority]),
      [
        ["ST-9", 9, "Urgent"],
        ["ST-12", 12, "Urgent"],
        ["ST-20", 20, "High"],
        ["ST-40", 40, "Low"],
        ["ST-30", 30, null],
      ],
    );
    assert.equal(next[0].url, "https://github.com/george-hutanu/motor-fix-specs/issues/9");
    const graphql = calls.filter((c) => c.url.endsWith("/graphql"));
    assert.equal(graphql.length, 1, "one read for the whole list");
    assert.deepEqual(graphql[0].body.variables.ids.sort(), ["I_12", "I_20", "I_30", "I_40", "I_9"]);
  });

  it("keeps only To do issues with no open blocker", async () => {
    const found = [issue(1, "ST-1 free"), issue(2, "ST-2 in QA"), issue(3, "ST-3 blocked"), issue(4, "ST-4 blocker closed"), issue(5, "ST-5 Blocked status")];
    const nodes = [
      node(1, "High"),
      node(2, "High", { status: "QA" }),
      node(3, "High", { blockers: ["CLOSED", "OPEN"] }),
      node(4, "High", { blockers: ["CLOSED"] }),
      node(5, "High", { status: "Blocked" }),
    ];
    const { github } = world(found, nodes);
    assert.deepEqual((await nextTasks(github)).map((t) => t.number), [1, 4]);
  });

  it("reads Status and Priority from the MotorFix project only, an issue outside it counting as To do", async () => {
    const other = { ...node(5, "Low"), projectItems: { nodes: [{ project: { title: "Other" }, status: { name: "Done" }, priority: { name: "Urgent" } }, { project: { title: "MotorFix" }, status: { name: "To do" }, priority: { name: "Low" } }] } };
    const outside = { id: "I_6", projectItems: { nodes: [] }, blockedBy: { nodes: [] } };
    const { github } = world([issue(5, "ST-5 x"), issue(6, "ST-6 y")], [other, outside]);
    assert.deepEqual((await nextTasks(github)).map((t) => [t.number, t.priority]), [[5, "Low"], [6, null]]);
  });

  it("leaves out pull requests and containers (epics, features, groups)", async () => {
    const found = [issue(7, "ST-7 a story"), issue(8, "EP-1 the epic", { labels: [{ name: "epic" }] }), issue(10, "a pr", { pull_request: {} })];
    const { github } = world(found, [node(7, "High")]);
    assert.deepEqual((await nextTasks(github)).map((t) => t.number), [7]);
  });

  it("follows the search past its first page, one read per 100 issues", async () => {
    const found = Array.from({ length: 150 }, (_, i) => issue(i + 1, `ST-${i + 1} x`));
    const { github, calls } = world(found, found.map((f) => node(f.number, "Medium")));
    assert.equal((await nextTasks(github)).length, 150);
    assert.equal(calls.filter((c) => c.url.includes("/search/issues")).length, 2);
    assert.equal(calls.filter((c) => c.url.endsWith("/graphql")).length, 2);
  });

  it("refuses an epic that is not EP-<n>", async () => {
    const { github } = world([], []);
    await assert.rejects(nextTasks(github, { epic: 'EP-1" label:x' }), /EP-<n>/);
  });
});
