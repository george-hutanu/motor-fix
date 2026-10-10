import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { notionClient } from "../lib/notion.mjs";
import { EPICS_DS, fakeNotion, SECRET, STORIES, STORIES_DS } from "./fixtures/notion.mjs";
import { readTracker } from "./notion-read.mjs";

const clientOver = (fetchImpl) => notionClient({ token: "ntn_x", fetchImpl, sleep: async () => {} });
const ok = (data) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });

describe("readTracker under hostile data", () => {
  it("reads every page of a paged stories query", async () => {
    const base = fakeNotion();
    const fetchImpl = async (url, init = {}) => {
      const path = new URL(url).pathname;
      if (path === `/v1/data_sources/${STORIES_DS}/query`) {
        const cursor = JSON.parse(init.body ?? "{}").start_cursor;
        return cursor ? ok({ results: STORIES.slice(3), has_more: false, next_cursor: null }) : ok({ results: STORIES.slice(0, 3), has_more: true, next_cursor: "c1" });
      }
      return base.fetchImpl(url, init);
    };
    const tracker = await readTracker(clientOver(fetchImpl));
    assert.equal(tracker.stories.length, STORIES.length);
  });

  it("returns empty lists, not a crash, for an empty workspace", async () => {
    const fetchImpl = async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/query") || path === "/v1/search" || path === "/v1/users") return ok({ results: [], has_more: false, next_cursor: null });
      return ok({});
    };
    const tracker = await readTracker(clientOver(fetchImpl));
    assert.deepEqual(tracker.stories, []);
    assert.deepEqual(tracker.epics, []);
  });

  it("survives a story whose properties are all empty or null", async () => {
    const empty = structuredClone(STORIES[0]);
    for (const p of Object.values(empty.properties)) {
      if (p.type === "select") p.select = null;
      if (p.type === "date") p.date = null;
      if (p.type === "title") p.title = [];
      if (p.type === "relation") p.relation = [];
    }
    empty.properties.Story.title = [];
    const base = fakeNotion();
    const fetchImpl = async (url, init) =>
      new URL(url).pathname === `/v1/data_sources/${STORIES_DS}/query` ? ok({ results: [empty], has_more: false, next_cursor: null }) : base.fetchImpl(url, init);
    const tracker = await readTracker(clientOver(fetchImpl));
    assert.equal(tracker.stories.length, 1);
    assert.equal(tracker.stories[0].key, "ST-1");
  });

  it("keeps unicode and emoji titles intact", async () => {
    const odd = structuredClone(STORIES[0]);
    odd.properties.Story.title = [{ plain_text: "Șofer " }, { plain_text: "își găsește atelierul 🔧" }];
    const base = fakeNotion();
    const fetchImpl = async (url, init) =>
      new URL(url).pathname === `/v1/data_sources/${STORIES_DS}/query` ? ok({ results: [odd], has_more: false, next_cursor: null }) : base.fetchImpl(url, init);
    const tracker = await readTracker(clientOver(fetchImpl));
    assert.equal(tracker.stories[0].title, "Șofer își găsește atelierul 🔧");
  });

  it("keeps the page text only in the raw properties, never in a mapped field", async () => {
    const notion = fakeNotion();
    const tracker = await readTracker(clientOver(notion.fetchImpl));
    for (const item of [...tracker.stories, ...tracker.epics]) {
      const { properties, ...mapped } = item;
      assert.ok(!JSON.stringify(mapped).includes(SECRET));
    }
  });

  it("sends only POST queries and search/users reads, whatever the backlog holds", async () => {
    const notion = fakeNotion();
    await readTracker(clientOver(notion.fetchImpl));
    for (const r of notion.requests) assert.match(r.path, /^\/(data_sources\/[^/]+\/query|search|users)$/);
    assert.ok(!notion.requests.some((r) => ["PATCH", "DELETE", "PUT"].includes(r.method)));
  });

  it("reports a failure of the epics query rather than returning half a backlog", async () => {
    const notion = fakeNotion({ failOn: EPICS_DS });
    await assert.rejects(readTracker(clientOver(notion.fetchImpl)));
  });

  it("does not leak the Notion token in a failure", async () => {
    const notion = fakeNotion({ failOn: STORIES_DS });
    await assert.rejects(readTracker(clientOver(notion.fetchImpl)), (e) => !String(e.message).includes("ntn_x"));
  });
});
