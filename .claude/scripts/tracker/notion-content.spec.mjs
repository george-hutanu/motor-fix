// @traces 1017-FR-007
import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { notionClient } from "../lib/notion.mjs";
import { fakeNotion, loadContent, storyId } from "./fixtures/notion.mjs";
import { FileError, fetchFile, folderCache, folderStore, MAX_FILE_BYTES } from "./notion-content.mjs";
import { renderPage } from "./notion-markdown.mjs";
import { readTracker } from "./notion-read.mjs";

const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "content-"));
  dirs.push(d);
  return d;
};
const t = (text) => ({ type: "text", plain_text: text, text: { content: text }, annotations: {} });
const para = (id, text, extra = {}) => ({ id, type: "paragraph", has_children: false, paragraph: { rich_text: [t(text)] }, ...extra });
const ST1 = storyId(1);

const CONTENT = {
  blocks: {
    [ST1]: [
      { ...para("p1", "top"), has_children: true },
      { id: "sub", type: "child_page", has_children: true, child_page: { title: "Build brief" } },
      { id: "sync", type: "synced_block", has_children: true, synced_block: { synced_from: { block_id: "orig" } } },
      { id: "img", type: "image", has_children: false, image: { type: "file", file: { url: "https://files.example/a/shot.png?sig=1" }, caption: [] } },
      { id: "db", type: "child_database", has_children: false, child_database: { title: "Checks" } },
    ],
    p1: [para("p1a", "nested")],
    sub: [para("s1", "inside the sub-page")],
    orig: [para("o1", "synced text")],
  },
  comments: {
    [ST1]: [{ id: "c1", created_by: { id: "aaaaaaaa-0000-0000-0000-000000000001" }, created_time: "2026-10-01T00:00:00Z", rich_text: [t("page note")], attachments: [{ category: "image", file: { url: "https://files.example/b/note.png" } }] }],
    s1: [{ id: "c2", created_by: { id: "x" }, created_time: "2026-10-02T00:00:00Z", rich_text: [t("block note")] }],
  },
  databases: { db: { rows: [{ id: "row1", properties: { Name: { type: "title", title: [t("Row one")] } } }] } },
};

async function load(content = CONTENT, opts = {}) {
  const notion = fakeNotion(content);
  const files = [];
  const fetchImpl = async (url, init) => {
    if (url.startsWith("https://files.example/")) {
      files.push(url);
      return new Response(opts.big ? new Uint8Array(1) : `bytes of ${url}`, { status: 200 });
    }
    return notion.fetchImpl(url, init);
  };
  const client = notionClient({ token: "ntn_x", fetchImpl, sleep: async () => {} });
  const tracker = await readTracker(client);
  const read = await loadContent(client, tracker, { download: async (url) => Buffer.from(await (await fetchImpl(url)).arrayBuffer()), ...opts });
  return { tracker, notion, files, read, st1: tracker.stories.find((s) => s.key === "ST-1") };
}

describe("loadContent", () => {
  it("reads nested blocks, sub-pages, synced blocks, inline databases and every comment", async () => {
    const { st1 } = await load();
    const [p1, sub, sync, , db] = st1.content.blocks;
    assert.equal(p1.children[0].id, "p1a");
    assert.equal(sub.children[0].id, "s1");
    assert.equal(sub.children[0].comments[0].id, "c2");
    assert.equal(sync.children[0].id, "o1");
    assert.equal(db.rows[0].id, "row1");
    assert.equal(st1.content.comments[0].id, "c1");
    const { body, gaps } = renderPage(st1, { keyOf: () => null, titleOf: () => null, userOf: () => "George", featureLink: () => null });
    assert.deepEqual(gaps, ["image block img: the file was not stored", "comment c1: an attachment was not stored"]);
    for (const part of ["top", "nested", "inside the sub-page", "block note", "synced text", "Row one", "page note"]) assert.ok(body.includes(part), part);
  });

  it("stores Notion-hosted files in the issue repository's clone under tracker/<KEY>/", async () => {
    const root = temp();
    const { st1, files } = await load(CONTENT, { store: folderStore(root) });
    const image = st1.content.blocks[3]._file;
    assert.match(image, /^tracker\/ST-1\/img-shot\.png$/);
    assert.equal(readFileSync(join(root, image), "utf8"), "bytes of https://files.example/a/shot.png?sig=1");
    assert.ok(existsSync(join(root, st1.content.comments[0]._files[0])));
    assert.equal(files.length, 2);
    const { gaps } = renderPage(st1, { keyOf: () => null, titleOf: () => null, userOf: () => null, featureLink: () => null });
    assert.deepEqual(gaps, []);
  });

  it("reads a page again only when it changed, or when a stored file went missing", async () => {
    const root = temp();
    const cache = folderCache(temp());
    const first = await load(CONTENT, { store: folderStore(root), cache });
    assert.equal(first.read, 12);
    const again = await load(CONTENT, { store: folderStore(root), cache });
    assert.equal(again.read, 0);
    assert.equal(again.files.length, 0);
    assert.equal(again.st1.content.blocks[0].children[0].id, "p1a");
    rmSync(join(root, first.st1.content.blocks[3]._file));
    assert.equal((await load(CONTENT, { store: folderStore(root), cache })).read, 1);
    assert.equal((await load(CONTENT, { store: folderStore(root), cache, refresh: true })).read, 12);
  });

  it("reads a property Notion cut short in full", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}` }));
    const notion = fakeNotion({ properties: { [`${ST1}/rel`]: many.map((relation) => ({ object: "property_item", type: "relation", relation })) } });
    const client = notionClient({ token: "ntn_x", fetchImpl: notion.fetchImpl, sleep: async () => {} });
    const tracker = await readTracker(client);
    const st1 = tracker.stories.find((s) => s.key === "ST-1");
    st1.properties = { ...st1.properties, Related: { id: "rel", type: "relation", relation: many.slice(0, 25), has_more: true } };
    await loadContent(client, tracker);
    assert.equal(st1.content.properties.Related.relation.length, 30);
  });

  it("leaves a file over GitHub's size limit unstored, so the import reports it", async () => {
    const root = temp();
    const store = folderStore(root);
    const notion = fakeNotion(CONTENT);
    const client = notionClient({ token: "ntn_x", fetchImpl: notion.fetchImpl, sleep: async () => {} });
    const tracker = await readTracker(client);
    await loadContent(client, tracker, { store, download: async () => ({ length: MAX_FILE_BYTES + 1 }) });
    assert.equal(tracker.stories.find((s) => s.key === "ST-1").content.blocks[3]._file, null);
  });
});

const stall = () => new Promise(() => {});
const quick = { sleep: async () => {}, timeoutMs: 20 };

describe("fetchFile", () => {
  it("aborts a download whose answer never comes and tries again", async () => {
    const signals = [];
    let calls = 0;
    const fetchImpl = (url, init) => {
      signals.push(init.signal);
      return ++calls < 3 ? stall() : Promise.resolve(new Response("bytes", { status: 200 }));
    };
    assert.equal(String(await fetchFile("https://files.example/x", { ...quick, fetchImpl })), "bytes");
    assert.equal(calls, 3);
    assert.ok(signals[0].aborted && signals[1].aborted && !signals[2].aborted);
  });

  it("aborts a body that stalls after the answer started", async () => {
    let calls = 0;
    const fetchImpl = async () => (++calls === 1 ? { ok: true, status: 200, headers: new Headers(), arrayBuffer: stall } : new Response("ok"));
    assert.equal(String(await fetchFile("https://files.example/x", { ...quick, fetchImpl })), "ok");
    assert.equal(calls, 2);
  });

  it("gives up after three tries, naming the timeout and no URL", async () => {
    let calls = 0;
    const fetchImpl = () => {
      calls++;
      return stall();
    };
    await assert.rejects(fetchFile("https://files.example/secret?sig=abc", { ...quick, fetchImpl }), (e) => e instanceof FileError && /timed out .*\(3 tries\)/.test(e.message) && !e.message.includes("sig="));
    assert.equal(calls, 3);
  });

  it("retries a 429 or 5xx after Retry-After, and stops at once on a 403", async () => {
    const waits = [];
    const answers = [new Response("", { status: 429, headers: { "retry-after": "7" } }), new Response("", { status: 503 }), new Response("done")];
    const got = await fetchFile("https://files.example/x", { fetchImpl: async () => answers.shift(), sleep: async (ms) => waits.push(ms), timeoutMs: 1000 });
    assert.equal(String(got), "done");
    assert.equal(waits[0], 7000);
    let calls = 0;
    await assert.rejects(
      fetchFile("https://files.example/x", { fetchImpl: async () => (calls++, new Response("", { status: 403 })), sleep: async () => {}, timeoutMs: 1000 }),
      (e) => e instanceof FileError && e.message === "answered 403",
    );
    assert.equal(calls, 1);
  });
});

describe("a file that cannot be downloaded", () => {
  it("is reported by name and reason, and its page is read again on the next run", async () => {
    const root = temp();
    const cache = folderCache(temp());
    const download = (url) => (url.includes("shot.png") ? fetchFile(url, { ...quick, fetchImpl: stall }) : Promise.resolve(Buffer.from("x")));
    const first = await load(CONTENT, { store: folderStore(root), cache, download });
    const { gaps } = renderPage(first.st1, { keyOf: () => null, titleOf: () => null, userOf: () => null, featureLink: () => null });
    assert.deepEqual(gaps, ["file shot.png: the answer timed out after 0 s (3 tries)"]);
    const again = await load(CONTENT, { store: folderStore(root), cache });
    assert.equal(again.read, 1);
    assert.deepEqual(again.files, ["https://files.example/a/shot.png?sig=1"]);
  });
});
