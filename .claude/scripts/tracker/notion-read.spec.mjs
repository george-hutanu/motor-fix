import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { NotionError, notionClient } from "../lib/notion.mjs";
import { fakeNotion, SECRET, storyId } from "./fixtures/notion.mjs";
import { readTracker } from "./notion-read.mjs";

const read = async (opts) => {
  const notion = fakeNotion(opts);
  const client = notionClient({ token: "ntn_x", fetchImpl: notion.fetchImpl, sleep: async () => {} });
  return { notion, tracker: await readTracker(client) };
};
const byKey = (list, key) => list.find((r) => r.key === key);

// @traces 1017-FR-015
// @traces 1017-FR-009
describe("readTracker", () => {
  it("builds a story from its properties alone", async () => {
    const { tracker } = await read();
    assert.deepEqual(byKey(tracker.stories, "ST-1"), {
      id: storyId(1),
      key: "ST-1",
      title: "Driver signs in",
      type: "Story",
      status: "To do",
      priority: "Medium",
      epics: ["EP-1"],
      feature: "f0000000-0000-0000-0000-000000000001",
      started: null,
      qaFrom: null,
      mergedAt: null,
      points: 3,
      pr: null,
      assignee: "george-hutanu",
      labels: ["front end"],
      role: "Driver",
      blockers: [],
      plannedStart: "2026-10-12",
      plannedEnd: "2026-10-16",
    });
  });

  it("leaves every item unassigned with one warning when the workspace has two people", async () => {
    const { tracker } = await read({
      users: [
        { object: "user", id: "aaaaaaaa-0000-0000-0000-000000000001", type: "person", name: "George" },
        { object: "user", id: "dddddddd-0000-0000-0000-000000000002", type: "person", name: "Guest" },
      ],
    });
    assert.ok(tracker.stories.every((s) => s.assignee === null));
    const about = tracker.warnings.filter((w) => /assign/i.test(w));
    assert.equal(about.length, 1);
    assert.match(about[0], /more than one person/);
  });

  it("keeps the date part of a datetime and drops an assignee who is not the owner", async () => {
    const { tracker } = await read();
    const st2 = byKey(tracker.stories, "ST-2");
    assert.equal(st2.started, "2026-10-01");
    assert.equal(st2.pr, "https://github.com/george-hutanu/motor-fix/pull/50");
    assert.equal(st2.assignee, null);
    assert.ok(tracker.warnings.some((w) => w.includes("ST-2") && /assignee/i.test(w)));
  });

  it("keeps every epic of a story, in order", async () => {
    const { tracker } = await read();
    assert.deepEqual(byKey(tracker.stories, "ST-5").epics, ["EP-1", "EP-2"]);
    assert.deepEqual(byKey(tracker.stories, "ST-4").epics, []);
  });

  it("takes a story's blockers from its build-timeline row, by relation or by the ST text", async () => {
    const { tracker } = await read();
    assert.deepEqual(byKey(tracker.stories, "ST-7").blockers, ["ST-1"]);
    assert.deepEqual(byKey(tracker.stories, "ST-8").blockers, ["ST-3"]);
    assert.deepEqual(byKey(tracker.stories, "ST-3").blockers, []);
  });

  it("skips a timeline row with no story, counts it and names it when it blocks one", async () => {
    const { tracker } = await read();
    assert.equal(tracker.skippedRows, 1);
    assert.ok(tracker.warnings.some((w) => w.includes("ST-8") && w.includes("Repo scaffold")));
  });

  it("builds an epic with its release, track, timeline and blocking epics", async () => {
    const { tracker } = await read();
    assert.deepEqual(byKey(tracker.epics, "EP-2"), {
      id: tracker.epics.find((e) => e.key === "EP-2").id,
      key: "EP-2",
      title: "Garage side",
      status: "To do",
      priority: "High",
      release: "2 - Soon after",
      track: "Garage side",
      plannedStart: "2026-12-07",
      plannedEnd: "2027-03-05",
      blockers: ["EP-1"],
      assignee: "george-hutanu",
    });
    const ep17 = byKey(tracker.epics, "EP-17");
    assert.equal(ep17.plannedStart, null);
    assert.ok(tracker.warnings.some((w) => w.includes("EP-17") && /Timeline/.test(w)));
  });

  it("asks Notion only for queries, timeline searches and users, never a page body or a comment", async () => {
    const { notion, tracker } = await read();
    for (const r of notion.requests) assert.match(r.path, /^(\/data_sources\/[^/]+\/query|\/search|\/users)$/, r.path);
    assert.ok(!JSON.stringify(tracker).includes(SECRET));
  });

  it("fails as a whole when Notion fails midway", async () => {
    await assert.rejects(read({ failOn: "d0000000-0000-0000-0000-000000000002" }), (e) => e instanceof NotionError);
  });
});
