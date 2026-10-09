// Notion blocks, rich text and properties as Markdown, for notion-export.mjs.
// Pure: every link goes through ctx.resolve(id) (a path relative to the file
// being written, or null when the target is outside the crawl), every hosted
// file through ctx.file(block) (a relative path, null, or { note } for a file
// left in Notion), and every type it does not know becomes an
// HTML comment naming it and a count in ctx.unknown, never dropped silently.

const NOTION_HOSTS = /(^|\.)(notion\.so|notion\.site|notion\.com)$/;
const HEX32 = /[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** A Notion id, dashed. */
export const dashed = (id) => {
  const hex = String(id).replaceAll("-", "").toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const compact = (id) => String(id).replaceAll("-", "");
export const notionUrl = (id) => `https://www.notion.so/${compact(id)}`;

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

// Titles seen while rendering, per ctx: a link_to_page block names its target by
// ctx.title(id) when the caller has one, else by a title met earlier on the page.
const seen = new WeakMap();
const remember = (ctx, id, title) => {
  if (!seen.has(ctx)) seen.set(ctx, new Map());
  seen.get(ctx).set(dashed(id), title);
};
const titleOf = (ctx, id, path) => ctx.title?.(id) ?? seen.get(ctx)?.get(id) ?? path.split("/").pop().replace(/\.md$/, "");

const count = (ctx, type) => {
  ctx.unknown[type] = (ctx.unknown[type] ?? 0) + 1;
  return `<!-- notion: ${type} -->`;
};

/** A link target: a Notion URL inside the crawl becomes its relative path; anything else is kept. */
function target(url, ctx) {
  const id = notionId(url);
  const path = id ? ctx.resolve(id) : null;
  return path ?? url;
}

function annotate(text, a = {}) {
  if (!text.trim()) return text;
  let out = text;
  if (a.code) out = `\`${out}\``;
  if (a.bold) out = `**${out}**`;
  if (a.italic) out = `*${out}*`;
  if (a.strikethrough) out = `~~${out}~~`;
  return out;
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
          const path = id ? ctx.resolve(dashed(id)) : null;
          return `[${part.plain_text}](${path ?? part.href ?? notionUrl(id)})`;
        }
        if (m.type === "date") return part.plain_text;
        return part.href ? `[${part.plain_text}](${target(part.href, ctx)})` : part.plain_text;
      }
      const text = annotate(part.plain_text ?? part.text?.content ?? "", part.annotations);
      const href = part.href ?? part.text?.link?.url;
      return href ? `[${text}](${target(href, ctx)})` : text;
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
  if (body.type === "file" && local === null) return count(ctx, `${block.type} without a file`);
  const src = local ?? body.external?.url ?? "";
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
    case "code":
      return `\`\`\`${body.language ?? ""}\n${plain(body.rich_text)}\n\`\`\``;
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
      const path = ctx.resolve(dashed(block.id));
      remember(ctx, block.id, body.title || "Untitled");
      return `- [${body.title || "Untitled"}](${path ?? notionUrl(block.id)})`;
    }
    case "link_to_page": {
      const id = body.page_id ?? body.database_id;
      const path = id ? ctx.resolve(dashed(id)) : null;
      const name = path ? titleOf(ctx, dashed(id), path) : "page";
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
          const path = ctx.resolve(dashed(id));
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

/** The four front-matter keys, in order; the title double-quoted. */
export function frontMatter({ title, id, url, edited }) {
  const quoted = `"${String(title).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  return `---\ntitle: ${quoted}\nnotion_id: ${dashed(id)}\nnotion_url: ${url}\nlast_edited: ${edited}\n---\n`;
}
