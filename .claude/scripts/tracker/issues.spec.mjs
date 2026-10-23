import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { SCHEMA } from "./bootstrap.mjs";
import { fakeGitHub } from "./fixtures/github.mjs";
import { githubClient } from "./github.mjs";
import { tracker } from "./issues.mjs";

const world = () =>
  fakeGitHub({
    projects: [{ title: "MotorFix", number: 11, statusOptions: ["To do", "Done"], fields: SCHEMA.fields.filter((f) => f.name !== "Status"), linked: true, items: [] }],
    issues: [
      { number: 60, title: "ST-60 Story", labels: ["type: task"], body: "Depends on: #61, ST-62" },
      { number: 61, title: "ST-61 Open blocker", labels: [] },
      { number: 62, title: "ST-62 Closed blocker", labels: [], state: "closed" },
    ],
    blockedBy: { 60: [61, 62] },
  });

const trackerOf = (gh) => tracker(githubClient({ token: "t", fetchImpl: gh.fetchImpl, paceMs: 0, sleep: async () => {} }));

// @traces 1363-throughput-fixes-FR-013
describe("an issue as the tracker reads it carries its body and its blocked-by links", () => {
  it("find gives the body and each blocker's number, id and state", async () => {
    const story = await trackerOf(world()).find("ST-60");
    assert.equal(story.body, "Depends on: #61, ST-62");
    assert.deepEqual(story.blockedBy, [
      { id: 1061, number: 61, open: true },
      { id: 1062, number: 62, open: false },
    ]);
  });

  it("byNumber reads an issue by its number, null when there is none", async () => {
    const t = trackerOf(world());
    assert.equal((await t.byNumber(61)).key, "ST-61");
    assert.equal(await t.byNumber(99), null);
  });

  it("an issue with no links reads an empty list", async () => {
    assert.deepEqual((await trackerOf(world()).find("ST-61")).blockedBy, []);
  });
});
