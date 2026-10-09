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

/** Each try of a download: the answer must start within this, and the body is given as long again plus a second per 256 KB. */
export const FILE_TIMEOUT_MS = 60_000;
export const FILE_TRIES = 3;
const FILE_BACKOFF_MS = 2000;
const MAX_RETRY_AFTER_S = 120;
const RETRIED = (status) => status === 429 || status >= 500;

/** A download that failed for good; `message` is short and names no URL (they are signed). */
export class FileError extends Error {}

/** Races `work()` against a timer that also aborts `controller`, so a fetch that ignores its signal cannot hang the run either. */
async function within(ms, what, controller, work) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new FileError(`${what} timed out after ${Math.round(ms / 1000)} s`));
    }, ms);
  });
  try {
    return await Promise.race([work(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Downloads a Notion-hosted file. The URL is pre-signed: no token is sent.
 * Every try is timed out; a timeout, a network error, a 429 or a 5xx is tried
 * again (FILE_TRIES in all) after a backoff or the Retry-After GitHub-style
 * seconds; anything else, or the last failure, throws a FileError.
 */
export async function fetchFile(url, { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), timeoutMs = FILE_TIMEOUT_MS, tries = FILE_TRIES } = {}) {
  let last;
  for (let attempt = 1; attempt <= tries; attempt++) {
    let wait = FILE_BACKOFF_MS * 2 ** (attempt - 1);
    try {
      // One controller per try: a timeout of the answer or of the body aborts the socket.
      const controller = new AbortController();
      const response = await within(timeoutMs, "the answer", controller, () => fetchImpl(url, { signal: controller.signal }));
      if (!response.ok) {
        last = new FileError(`answered ${response.status}`);
        if (!RETRIED(response.status)) throw last;
        const after = String(response.headers?.get?.("retry-after") ?? "").trim();
        if (/^\d+$/.test(after)) wait = Math.min(Number(after), MAX_RETRY_AFTER_S) * 1000;
        controller.abort();
      } else {
        const size = Number(response.headers?.get?.("content-length")) || 0;
        if (size > MAX_FILE_BYTES) throw new FileError(`${Math.ceil(size / 1048576)} MB, over the ${MAX_FILE_BYTES / 1048576} MB limit`);
        const bodyMs = timeoutMs + Math.ceil(size / 262144) * 1000;
        return Buffer.from(await within(bodyMs, "the download", controller, () => response.arrayBuffer()));
      }
    } catch (error) {
      if (error instanceof FileError && !/timed out/.test(error.message)) throw error;
      last = error instanceof FileError ? error : new FileError(`network error: ${String(error?.message ?? error).slice(0, 80)}`);
    }
    if (attempt < tries) await sleep(wait);
  }
  throw new FileError(`${last.message} (${tries} tries)`);
}

/**
 * A reader of one page at a time: it sets the page's `content` ({ blocks,
 * comments, propFiles, properties, titles, failed }) from the cache when the
 * page has not been edited since (and its files are all stored), else from
 * Notion, and adds the titles of the other pages it names to `tracker.titles`.
 * It answers whether Notion was asked.
 */
export function pageLoader(client, tracker, { cache = null, store = null, download = fetchFile, refresh = false, log = () => {} } = {}) {
  const known = new Set([...tracker.stories, ...tracker.epics].map((p) => p.id));
  tracker.titles ??= new Map();
  /** The cached content when it still serves (the page not edited since, its files all stored), else null. */
  const usable = (page) => {
    const cached = !refresh && cache?.get(page.id);
    return cached && cached.lastEdited === page.lastEdited && stored(cached, store) ? cached : null;
  };
  const load = async (page) => {
    const cached = usable(page);
    let read = false;
    if (cached) {
      page.content = cached.content;
    } else {
      page.content = await readPage(client, page, { store, download, known, log });
      cache?.set(page.id, { lastEdited: page.lastEdited, content: page.content });
      read = true;
    }
    for (const [id, title] of Object.entries(page.content.titles ?? {})) tracker.titles.set(id, title);
    return read;
  };
  /** Whether `load(page)` would be answered from the cache, without asking Notion: the import reads those pages first. */
  load.cached = (page) => Boolean(usable(page));
  return load;
}

/** Reads every story's and epic's content (pageLoader); returns the number of pages read from Notion. */
export async function loadContent(client, tracker, options = {}) {
  const load = pageLoader(client, tracker, options);
  let read = 0;
  for (const page of [...tracker.stories, ...tracker.epics]) if (await load(page)) read++;
  return read;
}

/** Whether a read page has files of its own stored in the issue repository's clone. */
export function hasStoredFiles(page) {
  return Boolean(page.content && filesOf(page.content).some(Boolean));
}

/**
 * Whether every file a cached page names is still in the store. A file that
 * was never stored (a download that failed or timed out) makes the page stale
 * too, so the next run reads that page again and retries its files.
 */
function stored(cached, store) {
  if (!store) return true;
  return filesOf(cached.content).every((path) => path && store.exists(path));
}

function filesOf(content) {
  const paths = Object.values(content.propFiles ?? {}).flat();
  const walk = (blocks) => {
    for (const b of blocks ?? []) {
      const v = b[b.type] ?? {};
      if (FILE_TYPES.has(b.type) && v.type !== "external" && (v.file?.url || v.file_upload?.url)) paths.push(b._file ?? null);
      for (const c of b.comments ?? []) paths.push(...attachmentsOf(c));
      walk(b.children);
      for (const r of b.rows ?? []) walk(r.children);
    }
  };
  walk(content.blocks);
  for (const c of content.comments ?? []) paths.push(...attachmentsOf(c));
  return paths;
}

/** A comment's stored files, with null for each attachment not stored. */
function attachmentsOf(c) {
  const files = c._files ?? [];
  const missing = (c.attachments ?? []).filter((a) => a.file?.url).length - files.filter(Boolean).length;
  return [...files.filter(Boolean), ...Array(Math.max(0, missing)).fill(null)];
}

async function readPage(client, page, { store, download, known, log }) {
  const titles = {};
  const failed = [];
  /** The stored path, or null; a failure is kept (`file <name>: <reason>`) for the import to report. */
  const save = async (url, id, name) => {
    if (!store) return null;
    const path = `tracker/${page.key}/${short(id)}-${safeName(name)}`;
    if (store.exists(path)) return path;
    try {
      const bytes = await download(url);
      if (bytes.length > MAX_FILE_BYTES) throw new FileError(`over the ${MAX_FILE_BYTES / 1048576} MB limit`);
      store.write(path, bytes);
      return path;
    } catch (error) {
      const reason = error instanceof FileError ? error.message : `not stored: ${String(error?.message ?? error).slice(0, 80)}`;
      failed.push(`file ${safeName(name)}: ${reason}`);
      log(`${"warn".padEnd(9)} ${page.key} file ${safeName(name)}: ${reason}`);
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
        files.push(url ? await save(url, `${c.id}${i}`, nameOf(url, `attachment-${i}`)) : null);
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
  return { properties, blocks, comments: pageComments, propFiles, titles, failed };
}
