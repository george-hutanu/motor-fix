// A recorded fake of the Notion API for the export's specs: a small synthetic
// space (no real page text), served through an injectable fetch. Every call is
// recorded as { method, url }. The fixture is mutable so a spec can edit,
// remove or break a page between two runs.

export const TOKEN = "fixture-token-not-a-secret";
export const FILE_HOST = "https://prod-files-secure.s3.us-west-2.amazonaws.com";

const id = (prefix) => `${prefix}000000-0000-4000-8000-000000000000`;
export const IDS = {
  root: id("0a"),
  overview: id("1b"),
  vision: id("2c"),
  vision2: id("3d"),
  untitled: id("4e"),
  delivery: id("5f"),
  storiesDb: id("6a"),
  epicsDb: id("6b"),
  roadmapView: id("6c"),
  decisionsView: id("6d"),
  decisions: id("7a"),
  decisionsSource: id("da"),
  row1: id("8a"),
  row2: id("8b"),
  outside: id("9f"),
};

const compact = (value) => value.replaceAll("-", "");
export const urlOf = (pageId, title = "Page") => `https://www.notion.so/${title.replace(/\W+/g, "-")}-${compact(pageId)}`;
const EDITED = "2026-10-01T10:00:00.000Z";

const text = (content, href = null) => ({
  type: "text",
  plain_text: content,
  href,
  text: { content, link: href ? { url: href } : null },
  annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" },
});
const mention = (pageId, plain) => ({
  type: "mention",
  plain_text: plain,
  href: `https://www.notion.so/${compact(pageId)}`,
  mention: { type: "page", page: { id: pageId } },
  annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" },
});
let serial = 0;
const block = (type, body = {}, children) => ({
  object: "block",
  id: `b${String(++serial).padStart(7, "0")}-0000-4000-8000-000000000000`,
  type,
  has_children: Boolean(children?.length),
  [type]: body,
  ...(children ? { kids: children } : {}),
});
const para = (...parts) => block("paragraph", { rich_text: parts });
const childPage = (pageId, title) => ({ ...block("child_page", { title }), id: pageId });
const childDb = (dbId, title) => ({ ...block("child_database", { title }), id: dbId });
const page = (pageId, title, parent, extra = {}) => ({
  object: "page",
  id: pageId,
  url: urlOf(pageId, title || "Untitled"),
  last_edited_time: EDITED,
  parent,
  properties: { title: { id: "title", type: "title", title: title ? [text(title)] : [] } },
  ...extra,
});

/** A fresh space and its fetch. `stories`/`epics` are the tracker data source ids the export must never query. */
export function space({ stories, epics }) {
  serial = 0;
  const pages = new Map();
  const databases = new Map();
  const sources = new Map();
  const files = new Map();
  const failing = [];
  const calls = [];

  const addPage = (p, blocks) => pages.set(p.id, { page: p, blocks });
  const onPage = (parentId) => ({ type: "page_id", page_id: parentId });

  addPage(page(IDS.root, "Product docs", { type: "workspace", workspace: true }), [
    para(text("Start at the "), mention(IDS.overview, "Overview"), text(".")),
    childPage(IDS.overview, "Overview"),
    childPage(IDS.delivery, "Delivery"),
    childDb(IDS.decisions, "Decisions"),
    block("table_of_contents"),
  ]);
  addPage(page(IDS.overview, "Overview", onPage(IDS.root)), [
    block("heading_1", { rich_text: [text("Overview")] }),
    { ...block("image", { type: "file", file: { url: `${FILE_HOST}/ws/x1/diagram.png?X-Amz-Signature=abc&X-Amz-Expires=3600`, expiry_time: EDITED }, caption: [text("Diagram")] }) },
    block("image", { type: "external", external: { url: "https://example.com/outside.png" }, caption: [] }),
    childPage(IDS.vision, "Vision"),
    childPage(IDS.vision2, "Vision"),
    childPage(IDS.untitled, ""),
  ]);
  addPage(page(IDS.vision, "Vision", onPage(IDS.overview)), [
    para(text("The other "), text("vision", `https://app.notion.com/p/Vision-${compact(IDS.vision2)}?pvs=21`), text(" and "), text("a site", "https://example.com/read")),
    para(text("Outside the space", `https://www.notion.so/${compact(IDS.outside)}`)),
    block("toggle", { rich_text: [text("Details")] }, [para(text("Folded"))]),
    { ...block("file", { type: "file", file: { url: `${FILE_HOST}/ws/x2/big.zip?X-Amz-Signature=def` }, caption: [], name: "big.zip" }) },
    block("ai_block", {}),
  ]);
  addPage(page(IDS.vision2, "Vision", onPage(IDS.overview)), [para(text("Second vision"))]);
  addPage(page(IDS.untitled, "", onPage(IDS.overview)), [para(text("No title"))]);
  addPage(page(IDS.delivery, "Delivery", onPage(IDS.root)), [
    childDb(IDS.storiesDb, "MotorFix stories"),
    childDb(IDS.epicsDb, "MotorFix epics"),
    childDb(IDS.roadmapView, "Roadmap view"),
    childDb(IDS.decisionsView, "Decisions view"),
  ]);

  const db = (dbId, title, parentId, sourceId) => ({
    object: "database",
    id: dbId,
    title: [text(title)],
    url: urlOf(dbId, title),
    last_edited_time: EDITED,
    parent: onPage(parentId),
    data_sources: [{ id: sourceId, name: title }],
  });
  databases.set(IDS.storiesDb, db(IDS.storiesDb, "MotorFix stories", IDS.delivery, stories));
  databases.set(IDS.epicsDb, db(IDS.epicsDb, "MotorFix epics", IDS.delivery, epics));
  databases.set(IDS.roadmapView, { status: 400, code: "validation_error", message: "Linked databases are not supported" });
  databases.set(IDS.decisions, db(IDS.decisions, "Decisions", IDS.root, IDS.decisionsSource));
  databases.set(IDS.decisionsView, db(IDS.decisions, "Decisions", IDS.root, IDS.decisionsSource));

  const row = (rowId, title, status, related) =>
    page(rowId, title, { type: "data_source_id", data_source_id: IDS.decisionsSource }, {
      properties: {
        Name: { id: "title", type: "title", title: [text(title)] },
        Status: { id: "s", type: "select", select: { name: status } },
        Related: { id: "r", type: "relation", relation: related.map((x) => ({ id: x })) },
      },
    });
  sources.set(IDS.decisionsSource, {
    source: {
      object: "data_source",
      id: IDS.decisionsSource,
      properties: { Name: { id: "title", type: "title" }, Status: { id: "s", type: "select" }, Related: { id: "r", type: "relation" } },
    },
    rows: [IDS.row1, IDS.row2],
  });
  addPage(row(IDS.row1, "Use Postgres", "Accepted", []), [para(text("Because PostGIS."))]);
  addPage(row(IDS.row2, "Pick Redis", "Open", [IDS.row1]), []);

  files.set("/ws/x1/diagram.png", { body: Buffer.from("PNGDATA"), size: 7 });
  files.set("/ws/x2/big.zip", { body: Buffer.from("too big"), size: 60 * 1024 * 1024 });

  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const notFound = () => json(404, { object: "error", status: 404, code: "object_not_found", message: "Not found" });
  const blocksOf = (blockId) => {
    if (pages.has(blockId)) return pages.get(blockId).blocks;
    for (const { blocks } of pages.values()) {
      const stack = [...blocks];
      while (stack.length) {
        const b = stack.pop();
        if (b.id === blockId) return b.kids ?? [];
        stack.push(...(b.kids ?? []));
      }
    }
    return null;
  };
  const strip = ({ kids, ...rest }) => rest;

  async function fetchImpl(url, init = {}) {
    const method = init.method ?? "GET";
    calls.push({ method, url: String(url) });
    const u = new URL(String(url));
    if (failing.some((re) => re.test(u.pathname))) return json(500, { object: "error", status: 500, code: "internal_server_error", message: "boom" });
    if (u.origin === FILE_HOST) {
      const f = files.get(u.pathname);
      if (!f) return new Response("missing", { status: 404 });
      return new Response(f.body, { status: 200, headers: { "Content-Length": String(f.size) } });
    }
    const path = u.pathname.replace(/^\/v1/, "");
    let m;
    if (method === "GET" && (m = path.match(/^\/pages\/([^/]+)$/))) {
      const p = pages.get(m[1]);
      return p ? json(200, p.page) : notFound();
    }
    if (method === "GET" && (m = path.match(/^\/blocks\/([^/]+)\/children$/))) {
      const blocks = blocksOf(m[1]);
      return blocks ? json(200, { object: "list", results: blocks.map(strip), has_more: false, next_cursor: null }) : notFound();
    }
    if (method === "GET" && (m = path.match(/^\/databases\/([^/]+)$/))) {
      const d = databases.get(m[1]);
      if (!d) return notFound();
      return d.status ? json(d.status, { object: "error", ...d }) : json(200, d);
    }
    if (method === "GET" && (m = path.match(/^\/data_sources\/([^/]+)$/))) {
      const s = sources.get(m[1]);
      return s ? json(200, s.source) : notFound();
    }
    if (method === "POST" && (m = path.match(/^\/data_sources\/([^/]+)\/query$/))) {
      const s = sources.get(m[1]);
      return s ? json(200, { object: "list", results: s.rows.map((r) => pages.get(r).page), has_more: false, next_cursor: null }) : notFound();
    }
    return json(400, { object: "error", status: 400, code: "invalid_request", message: `fixture has no ${method} ${path}` });
  }

  const touch = (pageId, at = "2026-10-05T10:00:00.000Z") => {
    pages.get(pageId).page.last_edited_time = at;
  };

  return {
    fetchImpl,
    calls,
    pages,
    /** Rewrites a page's blocks and moves its last_edited_time on. */
    edit(pageId, blocks) {
      pages.get(pageId).blocks = blocks;
      touch(pageId);
    },
    /** Removes a child page from its parent, as deleting it in Notion would. */
    remove(pageId) {
      const parent = pages.get(pageId).page.parent.page_id;
      pages.get(parent).blocks = pages.get(parent).blocks.filter((b) => b.id !== pageId);
      pages.delete(pageId);
      touch(parent);
    },
    /** Every call whose path matches answers 500 from now on. */
    fail(re) {
      failing.push(re);
    },
    para: (s) => para(text(s)),
  };
}
