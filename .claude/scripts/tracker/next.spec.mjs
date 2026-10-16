import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { fakeClock } from "./fixtures/github.mjs";
import { githubClient } from "./github.mjs";
import { nextTasks } from "./next.mjs";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const issue = (number, title, extra = {}) => ({ number, node_id: `I_${number}`, title, html_url: `https://github.com/george-hutanu/motor-fix-specs/issues/${number}`, labels: [], ...extra });
const node = (number, priority, project = "MotorFix") => ({
  id: `I_${number}`,
  number,
  projectItems: { nodes: [{ project: { title: project }, fieldValueByName: priority ? { name: priority } : null }] },
});

/** A fetch answering the REST search and the one Priorities query, recording each request. */
function world(found, nodes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    if (String(url).startsWith("https://api.github.com/search/issues")) return json({ total_count: found.length, items: found });
    if (String(url) === "https://api.github.com/graphql") return json({ data: { nodes } });
    return json({ message: "Not Found" }, 404);
  };
  const clock = fakeClock();
  return { calls, github: githubClient({ token: "t", fetchImpl, sleep: clock.sleep, now: clock.now }) };
}

// @traces 1323-FR-006
describe("next task for an epic", () => {
  it("searches the ready, confirmed issues of the epic over REST", async () => {
    const { github, calls } = world([], []);
    await nextTasks(github, "EP-1");
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, "/search/issues");
    assert.equal(
      url.searchParams.get("q"),
      'repo:george-hutanu/motor-fix-specs is:issue is:open label:EP-1 label:"ready to work" -label:needs-confirmation',
    );
    assert.equal(calls.length, 1, "no GraphQL call when nothing is ready");
  });

  it("orders by Project priority, then by issue number", async () => {
    const found = [issue(40, "ST-40 Low one"), issue(12, "ST-12 Urgent later"), issue(9, "ST-9 Urgent first"), issue(30, "ST-30 no priority"), issue(20, "ST-20 High")];
    const nodes = [node(40, "Low"), node(12, "Urgent"), node(9, "Urgent"), node(30, null), node(20, "High")];
    const { github, calls } = world(found, nodes);
    const next = await nextTasks(github, "EP-1");
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
    assert.equal(graphql.length, 1, "one Priority read for the whole list");
    assert.deepEqual(graphql[0].body.variables.ids.sort(), ["I_12", "I_20", "I_30", "I_40", "I_9"]);
  });

  it("reads the priority from the MotorFix project only", async () => {
    const { github } = world([issue(5, "ST-5 x")], [{ ...node(5, "Low"), projectItems: { nodes: [{ project: { title: "Other" }, fieldValueByName: { name: "Urgent" } }, { project: { title: "MotorFix" }, fieldValueByName: { name: "Low" } }] } }]);
    assert.equal((await nextTasks(github, "EP-1"))[0].priority, "Low");
  });

  it("leaves out pull requests and containers (epics, features, groups)", async () => {
    const found = [issue(7, "ST-7 a story"), issue(8, "EP-1 the epic", { labels: [{ name: "epic" }] }), issue(10, "a pr", { pull_request: {} })];
    const { github } = world(found, [node(7, "High")]);
    assert.deepEqual((await nextTasks(github, "EP-1")).map((t) => t.number), [7]);
  });

  it("refuses an epic that is not EP-<n>", async () => {
    const { github } = world([], []);
    await assert.rejects(nextTasks(github, 'EP-1" label:x'), /EP-<n>/);
  });
});
