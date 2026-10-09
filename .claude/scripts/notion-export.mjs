#!/usr/bin/env node
// Exports the Notion documentation space into the specs clone's docs/ folder.
//
//   node .claude/scripts/notion-export.mjs [--dry-run | --check] [--root <checkout>]
//
// Read-only towards Notion: GET, and POST only to a data source's query. It
// crawls from the space's root page, maps every page, database, row with a
// body, linked view and tracker pointer to a path under docs/, renders them as
// Markdown with front matter, downloads Notion-hosted files beside their page
// (50 MB at most each), deletes files whose page is gone and writes
// docs/index.json last, only after a complete walk. A page whose
// last_edited_time matches the previous index keeps its file and its blocks
// are not fetched, unless the path map moved. The Stories and Epics databases
// become one pointer each and are never queried. Exit codes: 0 done, 1 failed
// or --check found a gap, 3 no NOTION_TOKEN, 64 usage. One JSON line on stdout.

import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { isEntryPoint } from "./lib/entry.mjs";
import { clientLimits, notionClient, notionToken } from "./lib/notion.mjs";
import { STORIES } from "./notion-sync.mjs";
import { dashed, frontMatter, hosted, notionUrl, renderBlocks, renderProperty } from "./notion-export/render.mjs";
import { docsDir, layout, SPECS_SLUG } from "./specs-repo.mjs";

/** The space's root page, "MotorFix — Product documentation". */
export const ROOT_PAGE = "3ee607bf-f0d2-815b-a543-e1299c02ce1b";
/** The tracker's Epics data source; with STORIES, never queried. */
export const EPICS = "ca8cf981-a8f2-4cb6-9c9a-ac1a3df0edac";
/** Paths under docs/ the export never writes, deletes or reports (a trailing / is a folder). */
export const EXCLUDED = ["README.md", "index.json", "execution-plans/"];
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

const PROJECT_URL = "https://github.com/users/george-hutanu/projects/11";
const MEDIA = new Set(["image", "file", "pdf", "video", "audio"]);
const TRACKER = new Set([STORIES, EPICS].map(dashed));
const USAGE = "usage: notion-export.mjs [--dry-run | --check] [--root <checkout>]";

const excluded = (path) => EXCLUDED.some((x) => (x.endsWith("/") ? path.startsWith(x) : path === x));
const plain = (parts = []) => parts.map((p) => p.plain_text ?? "").join("");
const pageTitle = (page) => plain(Object.values(page.properties ?? {}).find((p) => p.type === "title")?.title);

/** A file name from a title: ASCII-folded, [a-z0-9-], 80 characters at most. */
export function slugify(title) {
  return String(title)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

// Names a page may not take in its folder, compared case-insensitively (a
// case-insensitive file system folds `readme.md` onto `README.md`): `index` is
// a folder page's own file, and at the root every excluded name is the owner's.
const RESERVED = new Set(["index"]);
const RESERVED_AT_ROOT = new Set(["index", ...EXCLUDED.map((x) => x.replace(/\/$/, "").replace(/\.[^.]*$/, "").toLowerCase())]);

/** A URL quoted in an error message, replaced: a signed file URL never reaches a report or a log. */
const scrubUrls = (text) => String(text).replace(/https?:\/\/\S+/g, "<file url>");

function parseArgs(argv) {
  const opts = { mode: "export", root: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run" || a === "--check") {
      if (opts.mode !== "export") return null;
      opts.mode = a.slice(2);
    } else if (a === "--root" && argv[i + 1]) opts.root = argv[++i];
    else return null;
  }
  return opts;
}

/** Every file under dir, relative to it, with / separators. */
function listFiles(dir) {
  const out = [];
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(d, e.name), r);
      else out.push(r);
    }
  };
  if (existsSync(dir)) walk(dir, "");
  return out.sort();
}

function readIndex(docs) {
  try {
    const index = JSON.parse(readFileSync(join(docs, "index.json"), "utf8"));
    return index && typeof index.files === "object" ? index : null;
  } catch {
    return null;
  }
}

/** Every block under a page, nested blocks in `children`; never into a child page or database. */
async function fetchBlocks(client, blockId) {
  const blocks = await client.children(blockId);
  for (const b of blocks) {
    if (!b.has_children || b.type === "child_page" || b.type === "child_database") continue;
    const from = b.type === "synced_block" ? b.synced_block?.synced_from?.block_id : null;
    b.children = await fetchBlocks(client, from ?? b.id);
  }
  return blocks;
}

/** The child pages and databases among the blocks, at any depth. */
function childRefs(blocks) {
  const refs = [];
  const walk = (list) => {
    for (const b of list) {
      if (b.type === "child_page" || b.type === "child_database") refs.push({ id: dashed(b.id), type: b.type, title: b[b.type]?.title ?? "" });
      else if (b.children) walk(b.children);
    }
  };
  walk(blocks);
  return refs;
}

function mediaBlocks(blocks) {
  const out = [];
  const walk = (list) => {
    for (const b of list) {
      if (MEDIA.has(b.type)) {
        const body = b[b.type] ?? {};
        const url = body.type === "file" ? body.file?.url : body.external?.url;
        // Only a signed URL on Notion's own file hosts is fetched; any other
        // host stays an external link and is never requested.
        if (url && hosted(url)) out.push({ block: b, url, name: body.name });
      }
      if (b.children) walk(b.children);
    }
  };
  walk(blocks);
  return out;
}

/** The hosted files of a page with the name each gets in its `.files` folder, unique within it. */
function assetNames(blocks) {
  const taken = new Set();
  return mediaBlocks(blocks).map((m) => {
    let file = fileName(m.url, m.name);
    while (taken.has(file)) file = `${file.replace(/(\.[^.]*)?$/, "")}-${taken.size}${file.match(/\.[^.]*$/)?.[0] ?? ""}`;
    taken.add(file);
    return { ...m, file };
  });
}

const fileName = (url, name) => {
  let base = name;
  if (!base) {
    try {
      base = decodeURIComponent(new URL(url).pathname.split("/").pop());
    } catch {
      base = "";
    }
  }
  return base.replace(/[^\w.-]+/g, "-").replace(/^[.-]+/, "") || "file";
};

/** Walks the space from rootPage into a map of nodes. `prev` is the last index; `fresh` forces every page's blocks. */
async function crawl({ client, rootPage, prev, log }) {
  const nodes = new Map();

  async function page(id, parent, kind, known) {
    const p = known ?? (await client.request("GET", `/pages/${id}`));
    const node = {
      id: dashed(p.id),
      kind,
      parent,
      title: pageTitle(p),
      url: p.url ?? notionUrl(p.id),
      edited: p.last_edited_time,
      properties: p.properties ?? {},
    };
    if (nodes.has(node.id)) return;
    nodes.set(node.id, node);
    const before = prev?.tree?.[node.id];
    if (before && before.edited === node.edited) {
      node.cached = true;
      node.refs = before.children ?? [];
      node.body = before.body ?? true;
      node.assets = before.assets ?? {};
    } else {
      log(`blocks ${node.id}`);
      node.blocks = await fetchBlocks(client, node.id);
      node.refs = childRefs(node.blocks);
      node.body = node.blocks.length > 0;
    }
    for (const ref of node.refs) {
      if (ref.type === "child_page") await page(ref.id, node.id, "page");
      else await database(ref.id, ref.title, node);
    }
  }

  async function database(id, title, parent) {
    if (nodes.has(id)) return;
    const node = { id, kind: "view", parent: parent.id, title, url: notionUrl(id), edited: parent.edited };
    nodes.set(id, node);
    let d = null;
    try {
      d = await client.request("GET", `/databases/${id}`);
    } catch (error) {
      if (!/^40[04]\b/.test(error.short ?? "")) throw error;
      return;
    }
    node.edited = d.last_edited_time ?? node.edited;
    const sources = (d.data_sources ?? []).map((s) => dashed(s.id));
    if (sources.some((s) => TRACKER.has(s))) {
      node.kind = "pointer";
      return;
    }
    if (dashed(d.id) !== id || (d.parent?.page_id && dashed(d.parent.page_id) !== parent.id)) {
      node.target = dashed(d.id);
      return;
    }
    node.kind = "database";
    node.title = plain(d.title) || title;
    node.url = d.url ?? node.url;
    node.columns = [];
    node.rows = [];
    for (const source of sources) {
      const ds = await client.request("GET", `/data_sources/${source}`);
      for (const name of Object.keys(ds.properties ?? {})) if (!node.columns.includes(name)) node.columns.push(name);
      for (const row of await client.query(source)) {
        node.rows.push(dashed(row.id));
        await page(row.id, id, "row", row);
      }
    }
  }

  await page(dashed(rootPage), null, "page");
  return nodes;
}

/** Gives every node with a file its path under docs/. */
function assignPaths(nodes, rootId) {
  const files = {};
  const kids = new Map();
  for (const n of nodes.values()) if (n.parent) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
  const hasFile = (n) => n.kind !== "row" || n.body || n.refs.length > 0;
  const isFolder = (n) => n.kind === "database" || ((n.kind === "page" || n.kind === "row") && n.refs.length > 0);

  const place = (n, folder) => {
    const children = (kids.get(n.id) ?? []).filter(hasFile);
    const groups = new Map();
    for (const c of children) {
      const base = slugify(c.title) || c.id;
      groups.set(base, [...(groups.get(base) ?? []), c]);
    }
    const reserved = folder === "" ? RESERVED_AT_ROOT : RESERVED;
    const taken = new Set();
    const slugs = new Map();
    // First every group's plain name, then the suffixed ones, each checked
    // against every name already taken, so a title that equals a sibling's
    // suffixed name, or two ids sharing a prefix, never share a file.
    for (const [base, group] of groups) {
      group.sort((a, b) => (a.id < b.id ? -1 : 1));
      if (!reserved.has(base.toLowerCase())) {
        slugs.set(group[0].id, base);
        taken.add(base);
      }
    }
    for (const [base, group] of groups) {
      for (const c of group) {
        if (slugs.has(c.id)) continue;
        const hex = c.id.replaceAll("-", "");
        let slug = `${base}-${hex.slice(0, 8)}`;
        if (taken.has(slug)) slug = `${base}-${hex}`;
        for (let n = 2; taken.has(slug); n++) slug = `${base}-${hex}-${n}`;
        slugs.set(c.id, slug);
        taken.add(slug);
      }
    }
    for (const c of children) {
      const slug = slugs.get(c.id);
      if (isFolder(c)) {
        files[c.id] = `${folder}${slug}/index.md`;
        place(c, `${folder}${slug}/`);
      } else files[c.id] = `${folder}${slug}.md`;
    }
  };
  files[rootId] = "index.md";
  place(nodes.get(rootId), "");
  return files;
}

const cell = (text) => text.replaceAll("|", "\\|").replaceAll("\n", " ");

/** Renders every node that is not cached; downloads its hosted files unless `dry`. */
async function render({ nodes, files, prev, dry, fetchImpl, report, timeoutMs, scratch }) {
  const out = new Map();
  const assets = new Map();
  for (const n of nodes.values()) {
    const path = files[n.id];
    if (!path) continue;
    const ctx = {
      unknown: report.unknown,
      resolve: (id) => (files[id] ? posix.relative(posix.dirname(path), files[id]) : null),
      title: (id) => nodes.get(id)?.title || null,
      file: () => null,
      page: n.url,
    };
    const head = frontMatter({ title: n.title, id: n.id, url: n.url, edited: n.edited });
    if (n.kind === "pointer") {
      out.set(path, `${head}\nStories and epics are no longer tracked in Notion: they are issues in [${SPECS_SLUG}](https://github.com/${SPECS_SLUG}/issues) on the [GitHub Project](${PROJECT_URL}).\n`);
      report.skipped++;
    } else if (n.kind === "view") {
      const to = n.target && files[n.target] ? ctx.resolve(n.target) : notionUrl(n.target ?? n.id);
      out.set(path, `${head}\nA linked view of [${n.title || "a database"}](${to}).\n`);
    } else if (n.kind === "database") {
      const rows = n.rows.map((id) => nodes.get(id));
      const line = (cells) => `| ${cells.join(" | ")} |`;
      const table = [line(n.columns.map(cell)), line(n.columns.map(() => "---"))];
      for (const r of rows) {
        table.push(
          line(
            n.columns.map((col) => {
              const prop = r.properties[col];
              if (!prop) return "";
              if (prop.type === "title") return files[r.id] ? `[${cell(r.title)}](${ctx.resolve(r.id)})` : cell(r.title);
              return cell(renderProperty(prop, ctx));
            }),
          ),
        );
      }
      out.set(path, `${head}\n${table.join("\n")}\n`);
    } else if (n.cached) {
      for (const a of Object.values(n.assets)) if (a.path) assets.set(a.path, null);
    } else {
      const dir = path.replace(/\.md$/, ".files");
      const known = prev?.tree?.[n.id]?.assets ?? {};
      const map = new Map();
      n.assets = {};
      for (const { block, url, file } of assetNames(n.blocks)) {
        const rel = `${dir}/${file}`;
        let result;
        if (dry) {
          result = known[file] ?? { path: rel };
          if (result.path) assets.set(result.path, null);
        } else result = await download({ fetchImpl, url, rel, file, report, assets, timeoutMs, scratch });
        n.assets[file] = result;
        map.set(block.id, result.path ? posix.relative(posix.dirname(path), result.path) : { note: result.note });
      }
      ctx.file = (block) => map.get(block.id) ?? null;
      out.set(path, `${head}\n${renderBlocks(n.blocks, ctx)}`);
    }
  }
  return { out, assets };
}

/**
 * Streams one hosted file into the run's scratch folder (outside docs/, so a
 * failed run leaves no half file) and records its path; only the path stays in
 * memory. Bounded by the client's timeout, headers and body alike; an error
 * names the file, never its signed URL.
 */
async function download({ fetchImpl, url, rel, file, report, assets, timeoutMs, scratch }) {
  const tooLarge = (bytes) => {
    report.tooLarge.push({ file: rel, bytes });
    return { note: `${file} (${(bytes / 1048576).toFixed(1)} MB) was not downloaded: it is over the 50 MB limit and stays in Notion.`, bytes };
  };
  const signal = AbortSignal.timeout(timeoutMs);
  const failed = (error) =>
    new Error(signal.aborted ? `download of ${rel} timed out after ${timeoutMs} ms` : `download of ${rel} failed: ${scrubUrls(error?.message ?? error)}`);
  let res;
  try {
    res = await fetchImpl(url, { signal });
  } catch (error) {
    throw failed(error);
  }
  if (!res.ok) {
    await res.body?.cancel?.().catch(() => {});
    throw new Error(`download of ${rel} failed: ${res.status}`);
  }
  const length = Number(res.headers.get("content-length"));
  if (length > MAX_FILE_BYTES) {
    await res.body?.cancel?.().catch(() => {});
    return tooLarge(length);
  }
  const temp = join(scratch, `${assets.size}`);
  const fd = openSync(temp, "w");
  let bytes = 0;
  try {
    for await (const chunk of res.body ?? []) {
      bytes += chunk.length;
      if (bytes > MAX_FILE_BYTES) break;
      writeSync(fd, chunk);
    }
  } catch (error) {
    throw failed(error);
  } finally {
    closeSync(fd);
  }
  if (bytes > MAX_FILE_BYTES) {
    rmSync(temp, { force: true });
    await res.body?.cancel?.().catch(() => {});
    return tooLarge(bytes);
  }
  assets.set(rel, temp);
  return { path: rel };
}

function treeOf(nodes) {
  const tree = {};
  for (const n of nodes.values()) {
    if (n.kind === "page" || n.kind === "row") tree[n.id] = { edited: n.edited, children: n.refs, body: n.body, assets: n.assets ?? {} };
  }
  return tree;
}

export async function run({ argv = [], env = process.env, root = process.cwd(), fetchImpl = fetch, rootPage = ROOT_PAGE, sleep, log = () => {} } = {}) {
  const opts = parseArgs(argv);
  if (!opts) return { code: 64, error: USAGE, report: { ok: false, error: USAGE } };
  const repo = resolve(opts.root ?? root);
  const fail = (code, error) => ({ code, error, report: { ok: false, error } });
  const token = notionToken(repo, env);
  if (!token) return fail(3, "NOTION_TOKEN is not set");
  const shape = layout(repo);
  if (shape !== "moved") return fail(1, `the specs clone's layout is ${shape}, not moved: run specs-repo.mjs ensure (after migrate-trunk)`);

  const docs = docsDir(repo);
  const prev = readIndex(docs);
  const client = notionClient({ token, fetchImpl, ...(sleep ? { sleep } : {}), ...clientLimits(env) });
  const rootId = dashed(rootPage);
  const report = { ok: true, created: 0, updated: 0, deleted: 0, unchanged: 0, skipped: 0, unknown: {}, tooLarge: [] };

  let nodes;
  let files;
  try {
    nodes = await crawl({ client, rootPage: rootId, prev, log });
    files = assignPaths(nodes, rootId);
  } catch (error) {
    const message = error.message ?? String(error);
    if (opts.mode === "check") {
      const index = prev ? "ok" : "absent";
      return { code: 1, error: message, report: { ok: false, missing: [], orphans: [], index, error: message } };
    }
    if (opts.mode === "export") rmSync(join(docs, "index.json"), { force: true });
    return fail(1, message);
  }

  if (opts.mode === "check") {
    const expected = new Set(Object.values(files));
    for (const n of nodes.values()) for (const a of Object.values(n.assets ?? {})) if (a.path) expected.add(a.path);
    for (const n of nodes.values()) {
      if (n.cached || !files[n.id] || !n.blocks) continue;
      const dir = files[n.id].replace(/\.md$/, ".files");
      for (const { file } of assetNames(n.blocks)) expected.add(`${dir}/${file}`);
    }
    const missing = Object.values(files).filter((p) => !existsSync(join(docs, p))).sort();
    const orphans = listFiles(docs).filter((p) => !excluded(p) && !expected.has(p));
    const index = prev ? "ok" : "absent";
    const ok = missing.length === 0 && orphans.length === 0 && index === "ok";
    return { code: ok ? 0 : 1, report: { ok, missing, orphans, index } };
  }

  const dry = opts.mode === "dry-run";
  const scratch = dry ? null : mkdtempSync(join(tmpdir(), "notion-export-"));
  try {
    // A moved path map invalidates every link: cached pages are fetched and rendered again.
    const moved = !prev || !isDeepStrictEqual(prev.files, files);
    for (const n of nodes.values()) {
      if (!n.cached || !files[n.id]) continue;
      if (moved || !existsSync(join(docs, files[n.id]))) {
        n.cached = false;
        n.blocks = await fetchBlocks(client, n.id);
        n.body = n.blocks.length > 0;
      }
    }
    const { out, assets } = await render({ nodes, files, prev, dry, fetchImpl, report, timeoutMs: clientLimits(env).timeoutMs, scratch });
    const expected = new Set([...out.keys(), ...assets.keys()]);
    for (const n of nodes.values()) if (n.cached && files[n.id]) expected.add(files[n.id]);
    const index = { exported: new Date().toISOString(), root: rootId, files, tree: treeOf(nodes) };
    const indexChanged = !prev || !isDeepStrictEqual({ ...prev, exported: null }, { ...index, exported: null });
    const stale = listFiles(docs).filter((p) => !excluded(p) && !expected.has(p));

    if (dry) {
      const create = [];
      const update = [];
      for (const [path, content] of out) {
        const file = join(docs, path);
        if (!existsSync(file)) create.push(path);
        else if (readFileSync(file, "utf8") !== content) update.push(path);
      }
      if (indexChanged) (prev ? update : create).push("index.json");
      return { code: 0, report: { ok: true, dryRun: true, create: create.sort(), update: update.sort(), delete: stale } };
    }

    // Every write stays under docs/: a symlink anywhere on the way is refused,
    // never followed (a link inside docs/ could point at any folder).
    const guard = (path) => {
      let at = docs;
      for (const part of path.split("/")) {
        at = join(at, part);
        let stat;
        try {
          stat = lstatSync(at);
        } catch {
          return;
        }
        if (stat.isSymbolicLink()) throw new Error(`refusing to write through a symlink: docs/${at.slice(docs.length + 1)}`);
      }
    };
    for (const path of [...out.keys(), ...assets.keys()]) guard(path);
    const write = (path, content) => {
      const file = join(docs, path);
      const before = existsSync(file) ? readFileSync(file) : null;
      const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
      if (before?.equals(bytes)) return void report.unchanged++;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, bytes);
      if (before) report.updated++;
      else report.created++;
    };
    for (const [path, content] of out) write(path, content);
    for (const [path, temp] of assets) if (temp) write(path, readFileSync(temp));
    for (const n of nodes.values()) if (n.cached && files[n.id]) report.unchanged++;
    for (const path of stale) {
      rmSync(join(docs, path));
      report.deleted++;
      for (let d = dirname(join(docs, path)); d !== docs && readdirSync(d).length === 0; d = dirname(d)) rmdirSync(d);
    }
    if (indexChanged) writeFileSync(join(docs, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
    return { code: 0, report };
  } catch (error) {
    if (!dry) rmSync(join(docs, "index.json"), { force: true });
    return fail(1, scrubUrls(error.message ?? String(error)));
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}

if (isEntryPoint(import.meta.url)) {
  const result = await run({
    argv: process.argv.slice(2),
    root: resolve(import.meta.dirname, "../.."),
    log: (line) => process.stderr.write(`${line}\n`),
  });
  if (result.code === 3 || result.code === 64) process.stderr.write(`${result.error}\n`);
  process.stdout.write(`${JSON.stringify(result.report)}\n`);
  process.exit(result.code);
}
