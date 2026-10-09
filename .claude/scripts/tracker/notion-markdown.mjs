// Renders a Notion story or epic page as the Markdown of its GitHub issue:
// every property, every block (sub-pages and inline databases included) and
// every comment, with no Notion URL left in it. A link to another story or
// epic becomes a reference token that the import resolves to `#<issue>`.
// It also reports what it could not account for, so the import can refuse
// to write an incomplete issue.
import { ISSUE_REPO, OWNER } from "./repos.mjs";

const REF_OPEN = "";
const REF_CLOSE = "";
/** A reference to a tracker item, resolved by `resolveRefs` once issue numbers are known. */
export const refToken = (key) => `${REF_OPEN}${key}${REF_CLOSE}`;
const REF = new RegExp(`${REF_OPEN}((?:ST|EP)-\\d+)${REF_CLOSE}`, "g");
/** The keys a body refers to. */
export const refsOf = (body) => [...body.matchAll(REF)].map((m) => m[1]);
/** The body with each reference as `#<n>` when its issue is known, else as the bare key. */
export const resolveRefs = (body, numberOf) => body.replace(REF, (_, key) => (numberOf(key) ? `#${numberOf(key)}` : key));

/** Any Notion address: none may reach GitHub. */
export const NOTION_URL = /notion\.(?:so|site|com)/i;
const NOTION_LINK = /https?:\/\/(?:[\w-]+\.)*notion\.(?:so|site|com)\/[^\s)\]>"']*/gi;
// A Notion address with no scheme ("notion.so", "acme.notion.site/x"): named, never written.
const NOTION_BARE = /(?:[\w-]+\.)*notion\.(?:so|site|com)(?:\/[^\s)\]>"']*)?/gi;
const pageIdIn = (url) => {
  const hex = url.replace(/-/g, "").match(/([0-9a-f]{32})(?![0-9a-f])/i)?.[1];
  return hex ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toLowerCase() : null;
};

/** The blob URL of a file stored in the issue repository. */
export const fileUrl = (path) => `https://github.com/${OWNER}/${ISSUE_REPO}/blob/trunk/${path.split("/").map(encodeURIComponent).join("/")}`;

const FILE_TYPES = new Set(["image", "file", "pdf", "video", "audio"]);
const STRUCTURE = new Set(["row", "table_of_contents", "breadcrumb", "divider", "column_list", "column", "synced_block", "template", "table_row"]);

/**
 * `ctx`: `keyOf(pageId)` the tracker key of a page or null, `titleOf(pageId)`,
 * `userOf(userId)`, `featureLink(pageId)` the URL of the feature's document or null.
 */
export function renderer(ctx) {
  const seen = { blocks: new Set(), comments: new Set() };
  const gaps = [];
  const fileName = (path) => path.split("/").at(-1);

  /** Text with every Notion address replaced by a reference, a title or a note. */
  function scrub(text) {
    return String(text).replace(NOTION_LINK, (url) => {
      const id = pageIdIn(url);
      const key = id && ctx.keyOf(id);
      if (key) return refToken(key);
      const title = id && ctx.titleOf(id);
      return title ? `“${title}”` : "(a Notion page)";
    }).replace(NOTION_BARE, "Notion");
  }
  const pageRef = (id, fallback) => {
    const key = ctx.keyOf(id);
    if (key) return refToken(key);
    const title = ctx.titleOf(id) ?? fallback;
    return title ? `“${scrub(title)}”` : "(a Notion page)";
  };

  function rich(parts = []) {
    return parts
      .map((p) => {
        let t;
        if (p.type === "mention" && p.mention?.type === "page") return pageRef(p.mention.page.id, p.plain_text);
        if (p.type === "mention" && p.mention?.type === "database") return `“${scrub(p.plain_text ?? "a database")}”`;
        // A fullwidth at sign: a Notion name must not notify a GitHub user of that name.
        if (p.type === "mention" && p.mention?.type === "user") t = `＠${(ctx.userOf(p.mention.user.id) ?? p.plain_text ?? "someone").replace(/^@/, "")}`;
        else if (p.type === "equation") t = `$${p.equation.expression}$`;
        else t = p.plain_text ?? p.text?.content ?? "";
        t = scrub(t);
        const a = p.annotations ?? {};
        if (a.code) t = `\`${t}\``;
        if (a.bold) t = `**${t}**`;
        if (a.italic) t = `*${t}*`;
        if (a.strikethrough) t = `~~${t}~~`;
        const href = p.href ?? p.text?.link?.url;
        if (href && !NOTION_URL.test(href) && t.trim()) t = `[${t}](${href})`;
        else if (href && NOTION_URL.test(href) && t.trim()) {
          const linked = scrub(href);
          if (linked !== t) t = `${t} (${linked})`;
        }
        return t;
      })
      .join("");
  }

  const indent = (text, pad) =>
    text
      .split("\n")
      .map((l) => (l ? pad + l : l))
      .join("\n");
  const cell = (text) => text.replace(/\|/g, "\\|").replace(/\n/g, "<br>");

  function fileBlock(b) {
    const v = b[b.type] ?? {};
    const caption = rich(v.caption);
    const name = caption || v.name || b.type;
    if (v.type === "external") {
      const url = v.external?.url ?? "";
      if (NOTION_URL.test(url)) return `${name}: ${scrub(url)}`;
      return b.type === "image" ? `![${name}](${url})` : `[${name}](${url})`;
    }
    if (!b._file) {
      gaps.push(`${b.type} block ${b.id}: the file was not stored`);
      return null;
    }
    const url = fileUrl(b._file);
    return b.type === "image" ? `![${caption || fileName(b._file)}](${url}?raw=true)` : `[${caption || fileName(b._file)}](${url})`;
  }

  function table(rows, header) {
    if (!rows.length) return "";
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r) => [...r, ...Array(width - r.length).fill("")];
    const lines = [];
    const head = header ? pad(rows[0]) : Array(width).fill("");
    lines.push(`| ${head.map(cell).join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`);
    for (const r of header ? rows.slice(1) : rows) lines.push(`| ${pad(r).map(cell).join(" | ")} |`);
    return lines.join("\n");
  }

  function comments(list = []) {
    return list.map((c) => {
      seen.comments.add(c.id);
      const who = ctx.userOf(c.created_by?.id) ?? "someone";
      const files = (c._files ?? []).map((p) => `[${fileName(p)}](${fileUrl(p)})`);
      if ((c.attachments ?? []).length > (c._files ?? []).length) gaps.push(`comment ${c.id}: an attachment was not stored`);
      return `- **${who}**, ${String(c.created_time ?? "").slice(0, 10)}: ${indent(rich(c.rich_text), "  ").trimStart()}${files.length ? ` (${files.join(", ")})` : ""}`;
    });
  }

  /** One block as Markdown, its children included; null when it renders to nothing. */
  function block(b, number) {
    seen.blocks.add(b.id);
    const v = b[b.type] ?? {};
    const kids = () => blocks(b.children ?? []);
    const nested = (pad) => {
      const inner = kids();
      return inner ? `\n${indent(inner, pad)}` : "";
    };
    let out;
    switch (b.type) {
      case "paragraph":
        out = rich(v.rich_text) + nested("  ");
        break;
      case "heading_1":
      case "heading_2":
      case "heading_3": {
        const level = "#".repeat(Number(b.type.at(-1)) + 1 > 4 ? 4 : Number(b.type.at(-1)) + 1);
        out = v.is_toggleable ? `<details><summary>${rich(v.rich_text)}</summary>\n\n${kids()}\n\n</details>` : `${level} ${rich(v.rich_text)}${nested("")}`;
        break;
      }
      case "bulleted_list_item":
        out = `- ${rich(v.rich_text)}${nested("  ")}`;
        break;
      case "numbered_list_item":
        out = `${number}. ${rich(v.rich_text)}${nested("   ")}`;
        break;
      case "to_do":
        out = `- [${v.checked ? "x" : " "}] ${rich(v.rich_text)}${nested("  ")}`;
        break;
      case "toggle":
        out = `<details><summary>${rich(v.rich_text) || "Details"}</summary>\n\n${kids()}\n\n</details>`;
        break;
      case "quote":
        out = indent(`${rich(v.rich_text)}${b.children?.length ? `\n\n${kids()}` : ""}`, "> ").replace(/^$/gm, ">");
        break;
      case "callout": {
        const icon = v.icon?.type === "emoji" ? `${v.icon.emoji} ` : "";
        out = indent(`${icon}${rich(v.rich_text)}${b.children?.length ? `\n\n${kids()}` : ""}`, "> ").replace(/^$/gm, ">");
        break;
      }
      case "code":
        out = `\`\`\`${(v.language ?? "").replace(/\s+/g, "-")}\n${scrub((v.rich_text ?? []).map((p) => p.plain_text ?? "").join(""))}\n\`\`\`${v.caption?.length ? `\n${rich(v.caption)}` : ""}`;
        break;
      case "equation":
        out = `$$\n${v.expression}\n$$`;
        break;
      case "divider":
        out = "---";
        break;
      case "table":
        for (const r of b.children ?? []) seen.blocks.add(r.id);
        out = table(
          (b.children ?? []).map((r) => (r.table_row?.cells ?? []).map((c) => rich(c))),
          v.has_column_header,
        );
        break;
      case "bookmark":
      case "embed":
      case "link_preview": {
        const url = v.url ?? "";
        out = NOTION_URL.test(url) ? scrub(url) : `[${rich(v.caption) || url}](${url})`;
        break;
      }
      case "link_to_page":
        out = `→ ${pageRef(v.page_id ?? v.database_id, null)}`;
        break;
      case "child_page":
        out = `<details><summary>Sub-page: ${scrub(v.title ?? "")}</summary>\n\n${kids()}${b.comments?.length ? `\n\n**Comments**\n\n${comments(b.comments).join("\n")}` : ""}\n\n</details>`;
        break;
      case "child_database": {
        const rows = b.rows ?? [];
        if (!b.rows) gaps.push(`child_database ${b.id}: its rows were not read`);
        const names = [...new Set(rows.flatMap((r) => Object.keys(r.properties ?? {})))];
        const title = (r) => scrub(Object.values(r.properties ?? {}).find((p) => p.type === "title")?.title?.map((t) => t.plain_text).join("") || "Untitled");
        const bodies = rows
          .map((r) => {
            const inner = [blocks(r.children ?? []), r.comments?.length ? `**Comments**\n\n${comments(r.comments).join("\n")}` : ""].filter(Boolean).join("\n\n");
            return inner ? `<details><summary>${title(r)}</summary>\n\n${inner}\n\n</details>` : "";
          })
          .filter(Boolean);
        out = [`**${scrub(v.title || "Database")}**`, rows.length ? table([names, ...rows.map((r) => names.map((n) => propText(r.properties[n], r)))], true) : "_(no rows)_", ...bodies].join("\n\n");
        break;
      }
      case "image":
      case "file":
      case "pdf":
      case "video":
      case "audio":
        out = fileBlock(b);
        break;
      case "column_list":
      case "column":
      case "synced_block":
      case "template":
        out = kids();
        break;
      case "table_of_contents":
      case "breadcrumb":
        out = null;
        break;
      default:
        seen.blocks.delete(b.id);
        gaps.push(`${b.type} block ${b.id}: not a block the import can render`);
        return null;
    }
    if (b.comments?.length && b.type !== "child_page") out = `${out ?? ""}\n\n> 💬 ${comments(b.comments).join("\n> ")}`;
    return out;
  }

  function blocks(list) {
    const parts = [];
    let n = 0;
    let previous = null;
    for (const b of list) {
      n = b.type === "numbered_list_item" ? n + 1 : 0;
      const text = block(b, n);
      if (text === null || text === "") {
        previous = b.type;
        continue;
      }
      const tight = previous === b.type && /list_item|to_do/.test(b.type);
      parts.push(`${parts.length ? (tight ? "\n" : "\n\n") : ""}${text}`);
      previous = b.type;
    }
    return parts.join("");
  }

  /** A property's value as one line of Markdown; "" when empty. */
  function propText(prop, page) {
    if (!prop) return "";
    const v = prop[prop.type];
    switch (prop.type) {
      case "title":
      case "rich_text":
        return rich(v);
      case "select":
      case "status":
        return v?.name ?? "";
      case "multi_select":
        return (v ?? []).map((o) => o.name).join(", ");
      case "number":
        return v === null || v === undefined ? "" : String(v);
      case "checkbox":
        return v ? "Yes" : "No";
      case "date":
        return v?.start ? `${v.start}${v.end ? ` → ${v.end}` : ""}` : "";
      case "people":
        return (v ?? []).map((p) => ctx.userOf(p.id) ?? p.name ?? "someone").join(", ");
      case "created_by":
      case "last_edited_by":
        return v ? (ctx.userOf(v.id) ?? v.name ?? "someone") : "";
      case "created_time":
      case "last_edited_time":
        return v ?? "";
      case "url":
      case "email":
      case "phone_number":
        return v ? scrub(v) : "";
      case "unique_id":
        return v ? (v.prefix ? `${v.prefix}-${v.number}` : String(v.number)) : "";
      case "relation":
        return (v ?? []).map((r) => (ctx.keyOf(r.id) ? refToken(ctx.keyOf(r.id)) : relationText(prop, r.id))).join(", ");
      case "formula":
        return v ? scrub(String(v[v.type] ?? (v.type === "date" ? (v.date?.start ?? "") : ""))) : "";
      case "rollup":
        if (!v) return "";
        if (v.type === "array") return v.array.map((item) => propText(item, page)).filter(Boolean).join(", ");
        if (v.type === "date") return v.date?.start ?? "";
        return v[v.type] === null || v[v.type] === undefined ? "" : String(v[v.type]);
      case "files": {
        const hosted = (v ?? []).filter((f) => f.type !== "external");
        const paths = page?._propFiles?.[prop.id] ?? [];
        if (hosted.length && (paths.length < hosted.length || paths.some((p) => !p))) gaps.push(`files property ${prop.id}: a file was not stored`);
        return [
          ...paths.filter(Boolean).map((p) => `[${fileName(p)}](${fileUrl(p)})`),
          ...(v ?? []).filter((f) => f.type === "external").map((f) => (NOTION_URL.test(f.external.url) ? scrub(f.external.url) : `[${f.name}](${f.external.url})`)),
        ].join(", ");
      }
      case "place":
        return v ? [v.name, v.address, v.lat !== undefined && v.lon !== undefined ? `${v.lat}, ${v.lon}` : null].filter(Boolean).map(scrub).join(" · ") : "";
      case "verification":
        return v?.state ?? "";
      case "button":
        return "";
      default:
        return v === null || v === undefined ? "" : scrub(JSON.stringify(v));
    }
  }
  const relationText = (prop, id) => {
    const title = ctx.titleOf(id);
    const text = title ? scrub(title) : "(an untitled Notion page)";
    const link = prop._feature ? ctx.featureLink?.(id) : null;
    return link ? `[${text}](${link})` : text;
  };


  return { rich, blocks, comments, propText, scrub, seen, gaps };
}

const LONG = (text) => text.length > 120 || text.includes("\n");

/**
 * The issue body of one tracker page, with references as tokens, and what
 * it could not account for. `page` carries `properties`, and `content`
 * (`blocks`, `comments`, `propFiles`) once the loader has read it.
 */
export function renderPage(page, ctx, { head = [] } = {}) {
  const r = renderer(ctx);
  const content = page.content ?? { blocks: [], comments: [] };
  const holder = { _propFiles: content.propFiles ?? {} };
  const properties = content.properties ?? page.properties ?? {};
  const rows = [];
  const sections = [];
  const accounted = [];
  for (const [name, prop] of Object.entries(properties)) {
    if (prop.type === "title") {
      accounted.push(name);
      continue;
    }
    if (prop.type === "relation" && name === "Feature") prop._feature = true;
    const text = r.propText(prop, holder);
    if (!text.trim() || prop.type === "button") {
      accounted.push(name);
      continue;
    }
    if (prop.type === "rich_text" && LONG(text)) sections.push(`## ${name}\n\n${text}`);
    else rows.push(`| ${name} | ${text.replace(/\|/g, "\\|").replace(/\n/g, "<br>")} |`);
    accounted.push(name);
  }
  const body = r.blocks(content.blocks ?? []);
  const notes = r.comments(content.comments ?? []);
  const parts = [...head];
  if (rows.length) parts.push(["## Properties", "", "| Property | Value |", "| --- | --- |", ...rows].join("\n"));
  parts.push(...sections);
  if (body) parts.push(`## Page\n\n${body}`);
  if (notes.length) parts.push(`## Notes from Notion\n\n${notes.join("\n")}`);
  const gaps = [...r.gaps];
  for (const name of Object.keys(properties)) if (!accounted.includes(name)) gaps.push(`property ${name}: not rendered`);
  const walk = (list, out = []) => {
    for (const b of list ?? []) {
      out.push(b);
      walk(b.children, out);
      for (const r of b.rows ?? []) {
        walk(r.children, out);
        out.push({ id: r.id, type: "row", comments: r.comments });
      }
    }
    return out;
  };
  const all = walk(content.blocks);
  const reported = (id) => gaps.some((g) => g.includes(` ${id}: `));
  for (const b of all) if (!r.seen.blocks.has(b.id) && !STRUCTURE.has(b.type) && !FILE_TYPES.has(b.type) && !reported(b.id)) gaps.push(`${b.type} block ${b.id}: not rendered`);
  const allComments = [...(content.comments ?? []), ...all.flatMap((b) => b.comments ?? [])];
  for (const c of allComments) if (!r.seen.comments.has(c.id)) gaps.push(`comment ${c.id}: not rendered`);
  return { body: parts.join("\n\n"), gaps: [...new Set(gaps)] };
}

/** Text with every Notion address replaced by a note: for text kept from an issue filed by hand. */
export const withoutNotion = (text) => renderer({ keyOf: () => null, titleOf: () => null, userOf: () => null }).scrub(text);
