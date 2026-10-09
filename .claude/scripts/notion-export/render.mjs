// Notion blocks, rich text and properties as Markdown, for notion-export.mjs.
// Pure: every link goes through ctx.resolve(id) (a path relative to the file
// being written, or null when the target is outside the crawl), every hosted
// file through ctx.file(block) (a relative path, null, or { note } for a file
// left in Notion), and every type it does not know becomes an
// HTML comment naming it and a count in ctx.unknown, never dropped silently.

const NOTION_HOSTS = /(^|\.)(notion\.so|notion\.site|notion\.com)$/;
const HEX32 = /[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** A Notion id, dashed. Throws on anything but 32 hex digits, so an id can never become a path. */
export const dashed = (id) => {
  const hex = String(id).replaceAll("-", "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error(`not a Notion id: ${String(id).slice(0, 40)}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
/** A Notion id, dashed, or null when it is not one: a link lookup, never a path. */
const idOrNull = (id) => {
  try {
    return dashed(id);
  } catch {
    return null;
  }
};
/** The path a link to this id resolves to, or null (outside the crawl, or no id at all). */
const lookup = (ctx, id) => {
  const d = id ? idOrNull(id) : null;
  return d ? ctx.resolve(d) : null;
};
const compact = (id) => String(id).replaceAll("-", "");
export const notionUrl = (id) => `https://www.notion.so/${compact(id)}`;

const FILE_HOSTS = ["amazonaws.com", "notion.so", "notion-static.com"];

/** A Notion-hosted file: a signed URL on S3 or Notion's own hosts, matched by exact host or a true subdomain. */
export function hosted(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return FILE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) && /X-Amz-/i.test(u.search);
  } catch {
    return false;
  }
}

/** The page id a notion.so, notion.site or app.notion.com URL points at (the last id in its path), or null. */
export function notionId(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!NOTION_HOSTS.test(u.hostname)) return null;
  const ids = u.pathname.match(HEX32);
  return ids ? dashed(ids.at(-1)) : null;
}

/** A Markdown code fence longer than any run of backticks in the text, three at least. */
function fence(text) {
  const longest = Math.max(0, ...(String(text).match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longest + 1));
}

// Titles seen while rendering, per ctx: a link_to_page block names its target by
// ctx.title(id) when the caller has one, else by a title met earlier on the page.
const seen = new WeakMap();
const remember = (ctx, id, title) => {
  if (!seen.has(ctx)) seen.set(ctx, new Map());
  const d = idOrNull(id);
  if (d) seen.get(ctx).set(d, title);
};
const titleOf = (ctx, id, path) => ctx.title?.(id) ?? seen.get(ctx)?.get(id) ?? path.split("/").pop().replace(/\.md$/, "");

const count = (ctx, type) => {
  ctx.unknown[type] = (ctx.unknown[type] ?? 0) + 1;
  return `<!-- notion: ${type} -->`;
};

/**
 * A link target: a Notion URL inside the crawl becomes its relative path; a
 * signed file URL becomes the Notion page that holds it (ctx.page), or null to
 * drop the link, so neither its signature nor its S3 host is ever written;
 * anything else is kept.
 */
function target(url, ctx) {
  if (hosted(url)) return ctx.page ?? null;
  const id = notionId(url);
  const path = id ? ctx.resolve(id) : null;
  return path ?? url;
}

function annotate(text, a = {}) {
  if (!text.trim()) return text;
  // Markers hug the words: `**word **` is not emphasis in Markdown.
  const [, lead, core, trail] = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  let out = core;
  if (a.code) out = `\`${out}\``;
  if (a.bold) out = `**${out}**`;
  if (a.italic) out = `*${out}*`;
  if (a.strikethrough) out = `~~${out}~~`;
  return `${lead}${out}${trail}`;
}

/** Rich text as inline Markdown. */
export function richText(parts = [], ctx) {
  return parts
    .map((part) => {
      if (part.type === "equation") return `$${part.equation.expression}$`;
      if (part.type === "mention") {
        const m = part.mention;
        const id = m[m.type]?.id;
        if (m.type === "page" || m.type === "database") {
          const path = lookup(ctx, id);
          return `[${part.plain_text}](${path ?? part.href ?? notionUrl(id)})`;
        }
        if (m.type === "date") return part.plain_text;
        const to = part.href ? target(part.href, ctx) : null;
        return to ? `[${part.plain_text}](${to})` : part.plain_text;
      }
      const text = annotate(part.plain_text ?? part.text?.content ?? "", part.annotations);
      const href = part.href ?? part.text?.link?.url;
      const to = href ? target(href, ctx) : null;
      return to ? `[${text}](${to})` : text;
    })
    .join("");
}

const plain = (parts = []) => parts.map((p) => p.plain_text ?? "").join("");
const indent = (text, by) => text.replace(/^(?=.)/gm, by);
const cell = (text) => text.replaceAll("|", "\\|").replaceAll("\n", " ");

function media(block, ctx) {
  const body = block[block.type];
  const caption = richText(body.caption ?? [], ctx);
  const local = ctx.file(block);
  if (local && typeof local === "object") return local.note;
  const remote = body.type === "file" ? body.file?.url : body.external?.url;
  // A signed file the export did not download is never linked by its URL.
  if (local === null && (!remote || hosted(remote))) return count(ctx, `${block.type} without a file`);
  const src = local ?? remote;
  if (block.type === "image") return `![${caption}](${src})`;
  const name = caption || body.name || src.split("/").pop();
  return `[${name}](${src})`;
}

/** One block (with its `children` already fetched) as Markdown, or null to leave it out. */
function one(block, ctx) {
  const t = block.type;
  const body = block[t] ?? {};
  const kids = block.children ?? [];
  const nested = () => (kids.length ? renderBlocks(kids, ctx).trimEnd() : "");
  const text = () => richText(body.rich_text, ctx);
  switch (t) {
    case "paragraph":
      return [text(), nested()].filter(Boolean).join("\n\n");
    case "heading_1":
    case "heading_2":
    case "heading_3":
      return `${"#".repeat(Number(t.at(-1)))} ${text()}${kids.length ? `\n\n${nested()}` : ""}`;
    case "bulleted_list_item":
    case "numbered_list_item":
    case "to_do": {
      const mark = t === "bulleted_list_item" ? "- " : t === "numbered_list_item" ? "1. " : `- [${body.checked ? "x" : " "}] `;
      const sub = kids.length ? `\n${indent(renderBlocks(kids, ctx).trimEnd().replace(/\n\n(?=\s*(- |1\. ))/g, "\n"), "  ")}` : "";
      return `${mark}${text()}${sub}`;
    }
    case "quote":
      return indent([text(), nested()].filter(Boolean).join("\n\n"), "> ").replace(/^$/gm, ">");
    case "callout": {
      const icon = body.icon?.type === "emoji" ? `${body.icon.emoji} ` : "";
      return indent([`${icon}${text()}`, nested()].filter(Boolean).join("\n\n"), "> ").replace(/^$/gm, ">");
    }
    case "toggle":
      return `<details>\n<summary>${text()}</summary>\n\n${nested()}\n\n</details>`;
    case "code": {
      const code = plain(body.rich_text);
      return `${fence(code)}${body.language ?? ""}\n${code}\n${fence(code)}`;
    }
    case "divider":
      return "---";
    case "equation":
      return `$$\n${body.expression}\n$$`;
    case "table": {
      const rows = kids.filter((k) => k.type === "table_row").map((k) => k.table_row.cells.map((c) => cell(richText(c, ctx))));
      if (!rows.length) return null;
      const width = Math.max(...rows.map((r) => r.length));
      const line = (r) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
      const [head, ...rest] = body.has_column_header ? rows : [Array(width).fill(""), ...rows];
      return [line(head), `| ${Array(width).fill("---").join(" | ")} |`, ...rest.map(line)].join("\n");
    }
    case "column_list":
    case "column":
    case "synced_block":
      return kids.length ? renderBlocks(kids, ctx).trimEnd() : null;
    case "child_page":
    case "child_database": {
      const path = lookup(ctx, block.id);
      remember(ctx, block.id, body.title || "Untitled");
      return `- [${body.title || "Untitled"}](${path ?? notionUrl(block.id)})`;
    }
    case "link_to_page": {
      const id = body.page_id ?? body.database_id;
      const path = lookup(ctx, id);
      const name = path ? titleOf(ctx, idOrNull(id), path) : "page";
      return `- [${name}](${path ?? notionUrl(id)})`;
    }
    case "image":
    case "file":
    case "pdf":
    case "video":
    case "audio":
      return media(block, ctx);
    case "bookmark":
    case "embed":
    case "link_preview": {
      const caption = richText(body.caption ?? [], ctx);
      const url = target(body.url, ctx);
      if (!url) return caption || count(ctx, `${t} of a file left in Notion`);
      return caption ? `[${caption}](${url})` : `<${url}>`;
    }
    case "table_of_contents":
    case "breadcrumb":
      return null;
    default:
      return count(ctx, t);
  }
}

/** Blocks as Markdown: one blank line between blocks, a trailing newline. */
export function renderBlocks(blocks, ctx) {
  const parts = blocks.map((b) => one(b, ctx)).filter((p) => p !== null && p !== "");
  return parts.length ? `${parts.join("\n\n")}\n` : "";
}

/** A database property's value as one line of Markdown. */
export function renderProperty(prop, ctx) {
  const v = prop[prop.type];
  switch (prop.type) {
    case "title":
    case "rich_text":
      return richText(v, ctx);
    case "select":
    case "status":
      return v?.name ?? "";
    case "multi_select":
      return (v ?? []).map((o) => o.name).join(", ");
    case "number":
      return v === null || v === undefined ? "" : String(v);
    case "checkbox":
      return v ? "yes" : "no";
    case "date":
      return v ? (v.end ? `${v.start} → ${v.end}` : v.start) : "";
    case "url":
    case "email":
    case "phone_number":
    case "created_time":
    case "last_edited_time":
      return v ?? "";
    case "people":
    case "created_by":
    case "last_edited_by":
      return [v].flat().filter(Boolean).map((p) => p.name ?? p.id).join(", ");
    case "relation":
      return (v ?? [])
        .map(({ id }) => {
          const path = lookup(ctx, id);
          return path ? `[${path.split("/").pop().replace(/\.md$/, "")}](${path})` : notionUrl(id);
        })
        .join(", ");
    case "formula":
      return v ? String(v[v.type] ?? "") : "";
    case "rollup":
      return v?.type === "array" ? v.array.map((x) => renderProperty(x, ctx)).join(", ") : String(v?.[v?.type] ?? "");
    case "unique_id":
      return v ? `${v.prefix ? `${v.prefix}-` : ""}${v.number}` : "";
    case "files":
      return (v ?? []).map((f) => f.name).join(", ");
    default:
      return count(ctx, prop.type);
  }
}

// A value that is safe bare in YAML stays bare; anything else is a JSON string,
// which is a valid YAML double-quoted scalar and cannot break the fence.
const scalar = (value) => (/^[\w:/.+-]+$/.test(String(value)) ? String(value) : JSON.stringify(String(value)));

/** The four front-matter keys, in order; the title always double-quoted, newlines and quotes escaped. */
export function frontMatter({ title, id, url, edited }) {
  return `---\ntitle: ${JSON.stringify(String(title))}\nnotion_id: ${dashed(id)}\nnotion_url: ${scalar(url)}\nlast_edited: ${scalar(edited)}\n---\n`;
}
