// Reads everything on each story and epic page that its properties do not
// hold: the block tree (sub-pages, inline databases and synced blocks
// followed), the page's and every block's comments, the files they carry,
// properties Notion cut short, and the titles of the other pages they name.
// Notion-hosted files are saved into the issue repository's clone under
// tracker/<KEY>/, since their URLs expire within the hour.
//
// A page is read again only when its last_edited_time moved (or --refresh):
// the first full read is long (every block's comments are one request each).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const CACHE_VERSION = 1;
const FILE_TYPES = new Set(["image", "file", "pdf", "video", "audio"]);
/** GitHub refuses a file over 100 MB in a push. */
export const MAX_FILE_BYTES = 95 * 1024 * 1024;
// A page object carries at most 25 of these; the rest need the property endpoint.
const CAPPED = new Set(["title", "rich_text", "relation", "people"]);

const short = (id) => id.replaceAll("-", "").slice(0, 8);
const safeName = (name) =>
  (
    String(name)
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(-80) || "file"
  ).replace(/^\.+/, "");
const nameOf = (url, fallback) => {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").at(-1)) || fallback;
  } catch {
    return fallback;
  }
};

/** A cache of page content in a folder, one JSON file per page. */
export function folderCache(dir) {
  const file = (id) => join(dir, `${id}.json`);
  return {
    get(id) {
      try {
        const data = JSON.parse(readFileSync(file(id), "utf8"));
        return data.version === CACHE_VERSION ? data : null;
      } catch {
        return null;
      }
    },
    set(id, value) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file(id), JSON.stringify({ ...value, version: CACHE_VERSION }));
    },
  };
}

/** Where files are stored: a clone's root, paths relative to it. */
export function folderStore(root) {
  return {
    exists: (path) => existsSync(join(root, path)),
    write(path, bytes) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), bytes);
    },
  };
}

/** Downloads a Notion-hosted file. The URL is pre-signed: no token is sent. */
export async function fetchFile(url, fetchImpl = fetch) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Adds `content` ({ blocks, comments, propFiles, properties, titles }) to each
 * story and epic of `tracker`, and `tracker.titles` (page id → title) for the
 * other pages they name. Returns the number of pages read from Notion.
 */
export async function loadContent(client, tracker, { cache = null, store = null, download = fetchFile, refresh = false, log = () => {} } = {}) {
  const pages = [...tracker.stories, ...tracker.epics];
  const known = new Set(pages.map((p) => p.id));
  tracker.titles ??= new Map();
  let read = 0;

  for (const page of pages) {
    const cached = !refresh && cache?.get(page.id);
    if (cached && cached.lastEdited === page.lastEdited && stored(cached, store)) {
      page.content = cached.content;
    } else {
      page.content = await readPage(client, page, { store, download, known });
      cache?.set(page.id, { lastEdited: page.lastEdited, content: page.content });
      read++;
      if (read % 50 === 0) log(`${"read".padEnd(9)} notion: ${read} pages' content`);
    }
    for (const [id, title] of Object.entries(page.content.titles ?? {})) tracker.titles.set(id, title);
  }
  return read;
}

/** Whether every file a cached page names is still in the store. */
function stored(cached, store) {
  if (!store) return true;
  return filesOf(cached.content).every((path) => store.exists(path));
}

function filesOf(content) {
  const paths = Object.values(content.propFiles ?? {}).flat();
  const walk = (blocks) => {
    for (const b of blocks ?? []) {
      if (b._file) paths.push(b._file);
      for (const c of b.comments ?? []) paths.push(...(c._files ?? []));
      walk(b.children);
      for (const r of b.rows ?? []) walk(r.children);
    }
  };
  walk(content.blocks);
  for (const c of content.comments ?? []) paths.push(...(c._files ?? []));
  return paths;
}

async function readPage(client, page, { store, download, known }) {
  const titles = {};
  const save = async (url, id, name) => {
    if (!store) return null;
    const path = `tracker/${page.key}/${short(id)}-${safeName(name)}`;
    if (store.exists(path)) return path;
    try {
      const bytes = await download(url);
      if (bytes.length > MAX_FILE_BYTES) return null;
      store.write(path, bytes);
      return path;
    } catch {
      return null;
    }
  };

  const comments = async (id) => {
    const all = [];
    for (let cursor; ; ) {
      const answer = await client.request("GET", `/comments?block_id=${id}&page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
      all.push(...(answer.results ?? []));
      if (!answer.has_more) break;
      cursor = answer.next_cursor;
    }
    for (const c of all) {
      const files = [];
      for (const [i, a] of (c.attachments ?? []).entries()) {
        const url = a.file?.url;
        const path = url ? await save(url, `${c.id}${i}`, nameOf(url, `attachment-${i}`)) : null;
        if (path) files.push(path);
      }
      c._files = files;
    }
    return all;
  };

  const blocksOf = async (parentId, seen = new Set()) => {
    if (seen.has(parentId)) return [];
    seen.add(parentId);
    const list = await client.children(parentId);
    for (const b of list) {
      b.comments = await comments(b.id);
      const v = b[b.type] ?? {};
      if (b.type === "synced_block" && v.synced_from?.block_id) b.children = await blocksOf(v.synced_from.block_id, seen);
      else if (b.type === "child_database") b.rows = await rowsOf(b.id, seen);
      else if (b.has_children || b.type === "child_page") b.children = await blocksOf(b.id, seen);
      if (FILE_TYPES.has(b.type) && v.type !== "external") {
        const url = v.file?.url ?? v.file_upload?.url;
        if (url) b._file = await save(url, b.id, v.name || nameOf(url, b.type));
      }
      if (b.type === "link_to_page") await titleOf(v.page_id);
    }
    return list;
  };

  const rowsOf = async (databaseId, seen) => {
    let db;
    try {
      db = await client.request("GET", `/databases/${databaseId}`);
    } catch {
      return null;
    }
    const rows = [];
    for (const source of db.data_sources ?? []) rows.push(...(await client.query(source.id)));
    for (const row of rows) {
      row.children = await blocksOf(row.id, seen);
      row.comments = await comments(row.id);
      await fullProperties(row);
    }
    return rows;
  };

  const titleOf = async (id) => {
    if (!id || known.has(id) || id in titles) return;
    try {
      const other = await client.request("GET", `/pages/${id}`);
      const prop = Object.values(other.properties ?? {}).find((p) => p.type === "title");
      titles[id] = (prop?.title ?? []).map((t) => t.plain_text).join("") || null;
    } catch {
      titles[id] = null;
    }
  };

  /** The page's properties with every value Notion cut short read in full. */
  const fullProperties = async (target) => {
    const properties = structuredClone(target.properties ?? {});
    for (const prop of Object.values(properties)) {
      const value = prop[prop.type];
      if (!CAPPED.has(prop.type) || !(prop.has_more || (Array.isArray(value) && value.length >= 25))) continue;
      const items = [];
      for (let cursor; ; ) {
        const answer = await client.request("GET", `/pages/${target.id}/properties/${encodeURIComponent(prop.id)}${cursor ? `?start_cursor=${cursor}` : ""}`);
        items.push(...(answer.results ?? [answer]));
        if (!answer.has_more) break;
        cursor = answer.next_cursor;
      }
      prop[prop.type] = items.map((i) => i[prop.type]).filter(Boolean);
      prop.has_more = false;
    }
    target.properties = properties;
    return properties;
  };

  const properties = await fullProperties({ id: page.id, properties: page.properties });
  const propFiles = {};
  for (const prop of Object.values(properties)) {
    if (prop.type === "relation") for (const r of prop.relation) await titleOf(r.id);
    if (prop.type !== "files") continue;
    propFiles[prop.id] = [];
    for (const f of prop.files) if (f.type === "file") propFiles[prop.id].push((await save(f.file.url, `${prop.id}${f.name}`, f.name)) ?? null);
  }
  const blocks = await blocksOf(page.id);
  const pageComments = await comments(page.id);
  return { properties, blocks, comments: pageComments, propFiles, titles };
}
