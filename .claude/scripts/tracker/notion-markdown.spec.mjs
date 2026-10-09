// @traces 1017-FR-007
import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { fileUrl, refsOf, refToken, renderPage, resolveRefs, withoutNotion } from "./notion-markdown.mjs";

const ST2 = "50000000-0000-0000-0000-000000000002";
const ctx = {
  keyOf: (id) => (id.replaceAll("-", "") === ST2.replaceAll("-", "") ? "ST-2" : null),
  titleOf: (id) => (id === "f1" ? "Sign-in feature" : null),
  userOf: (id) => ({ u1: "George" })[id] ?? null,
  featureLink: () => null,
};
const t = (text, extra = {}) => ({ type: "text", plain_text: text, text: { content: text }, annotations: {}, ...extra });
const block = (id, type, value = {}, children) => ({ id, type, has_children: Boolean(children), [type]: value, ...(children ? { children } : {}) });
const render = (blocks, rest = {}) => renderPage({ properties: rest.properties ?? {}, content: { blocks, comments: rest.comments ?? [], propFiles: rest.propFiles ?? {} } }, ctx, { head: ["<!-- motorfix:ST-1 -->"] });

describe("renderPage", () => {
  it("renders headings, nested lists, to-dos, toggles, quotes, code and tables as Markdown", () => {
    const { body, gaps } = render([
      block("h", "heading_2", { rich_text: [t("Build brief")] }),
      block("p", "paragraph", { rich_text: [t("bold", { annotations: { bold: true } }), t(" and "), t("code", { annotations: { code: true } })] }),
      block("l1", "bulleted_list_item", { rich_text: [t("one")] }, [block("l1a", "bulleted_list_item", { rich_text: [t("one a")] })]),
      block("l2", "bulleted_list_item", { rich_text: [t("two")] }),
      block("n1", "numbered_list_item", { rich_text: [t("first")] }),
      block("n2", "numbered_list_item", { rich_text: [t("second")] }),
      block("d", "to_do", { rich_text: [t("done")], checked: true }),
      block("tg", "toggle", { rich_text: [t("More")] }, [block("tgp", "paragraph", { rich_text: [t("hidden")] })]),
      block("q", "quote", { rich_text: [t("said")] }),
      block("c", "code", { language: "typescript", rich_text: [t("const a = 1;")], caption: [] }),
      block("tb", "table", { has_column_header: true, table_width: 2 }, [
        block("r1", "table_row", { cells: [[t("A")], [t("B")]] }),
        block("r2", "table_row", { cells: [[t("1|2")], [t("x")]] }),
      ]),
      block("toc", "table_of_contents", {}),
      block("dv", "divider", {}),
    ]);
    assert.deepEqual(gaps, []);
    for (const part of [
      "## Page",
      "### Build brief",
      "**bold** and `code`",
      "- one\n  - one a\n- two",
      "1. first\n2. second",
      "- [x] done",
      "<details><summary>More</summary>\n\nhidden\n\n</details>",
      "> said",
      "```typescript\nconst a = 1;\n```",
      "| A | B |\n| --- | --- |\n| 1\\|2 | x |",
      "---",
    ]) {
      assert.ok(body.includes(part), part);
    }
  });

  it("turns a mention or link to another story into a reference and any other Notion page into its name", () => {
    const { body } = render([
      block("p", "paragraph", {
        rich_text: [
          { type: "mention", plain_text: "Garage hours", mention: { type: "page", page: { id: ST2 } }, href: `https://www.notion.so/${ST2.replaceAll("-", "")}` },
          t(" and "),
          t("the feature", { href: "https://www.notion.so/f1", text: { content: "the feature", link: { url: "https://www.notion.so/f1" } } }),
          t(" by "),
          { type: "mention", plain_text: "@George", mention: { type: "user", user: { id: "u1" } } },
        ],
      }),
    ]);
    assert.deepEqual(refsOf(body), ["ST-2"]);
    assert.ok(body.includes(`${refToken("ST-2")} and the feature ((a Notion page)) by ＠George`), body);
    assert.equal(resolveRefs(refToken("ST-2"), () => 42), "#42");
    assert.equal(resolveRefs(refToken("ST-2"), () => null), "ST-2");
  });

  it("puts every non-empty property in a table, long text in its own section, and skips empty ones", () => {
    const { body, gaps } = render([], {
      properties: {
        Story: { type: "title", title: [t("Driver signs in")] },
        Took: { type: "rich_text", rich_text: [t("2 h")] },
        "User story": { type: "rich_text", rich_text: [t("As a driver\nI want to sign in")] },
        Place: { type: "place", place: { name: "Garage", lat: 44.4, lon: 26.1 } },
        Assignee: { type: "people", people: [{ id: "u1" }] },
        Date: { type: "date", date: { start: "2026-10-01", end: "2026-10-03" } },
        Feature: { type: "relation", relation: [{ id: "f1" }] },
        Epic: { type: "relation", relation: [{ id: ST2 }] },
        Component: { type: "rollup", rollup: { type: "array", array: [{ type: "select", select: { name: "API" } }] } },
        Design: { type: "url", url: null },
        Session: { type: "select", select: null },
      },
    });
    assert.deepEqual(gaps, []);
    for (const row of ["| Took | 2 h |", "| Place | Garage · 44.4, 26.1 |", "| Assignee | George |", "| Date | 2026-10-01 → 2026-10-03 |", "| Feature | Sign-in feature |", `| Epic | ${refToken("ST-2")} |`, "| Component | API |"]) {
      assert.ok(body.includes(row), row);
    }
    assert.ok(body.includes("## User story\n\nAs a driver\nI want to sign in"));
    assert.ok(!body.includes("| Design |") && !body.includes("| Session |") && !body.includes("| Story |"));
  });

  it("collects the page's comments under Notes from Notion and a block's under the block", () => {
    const comment = (id, text) => ({ id, created_by: { id: "u1" }, created_time: "2026-10-01T10:00:00Z", rich_text: [t(text)] });
    const { body, gaps } = render([{ ...block("p", "paragraph", { rich_text: [t("text")] }), comments: [comment("c2", "on the block")] }], { comments: [comment("c1", "on the page")] });
    assert.deepEqual(gaps, []);
    assert.ok(body.endsWith("## Notes from Notion\n\n- **George**, 2026-10-01: on the page"));
    assert.ok(body.includes("text\n\n> 💬 - **George**, 2026-10-01: on the block"));
  });

  it("links a stored file from the issue repository and reports one that was not stored", () => {
    const stored = { ...block("i", "image", { type: "file", file: { url: "https://s3/x.png" }, caption: [] }), _file: "tracker/ST-1/abc-x.png" };
    const lost = block("f", "file", { type: "file", file: { url: "https://s3/y.pdf" }, caption: [] });
    const { body, gaps } = render([stored, lost]);
    assert.ok(body.includes(`![abc-x.png](${fileUrl("tracker/ST-1/abc-x.png")}?raw=true)`));
    assert.deepEqual(gaps, ["file block f: the file was not stored"]);
  });

  it("reports a block it cannot render, so the import stops before writing", () => {
    const { gaps } = render([block("u", "unsupported", {}), block("p", "paragraph", { rich_text: [t("ok")] })]);
    assert.deepEqual(gaps, ["unsupported block u: not a block the import can render"]);
  });

  it("reports an inline database whose rows were not read, and renders one that was", () => {
    const row = { id: "row1", properties: { Name: { type: "title", title: [t("Row one")] }, Size: { type: "number", number: 3 } }, children: [block("rp", "paragraph", { rich_text: [t("row body")] })], comments: [] };
    const read = render([{ ...block("db", "child_database", { title: "Checks" }), rows: [row] }]);
    assert.deepEqual(read.gaps, []);
    assert.ok(read.body.includes("**Checks**\n\n| Name | Size |\n| --- | --- |\n| Row one | 3 |"));
    assert.ok(read.body.includes("<details><summary>Row one</summary>\n\nrow body"));
    assert.deepEqual(render([block("db", "child_database", { title: "Linked" })]).gaps, ["child_database db: its rows were not read"]);
  });
});

describe("withoutNotion", () => {
  it("removes every Notion address from text kept from a person", () => {
    assert.equal(withoutNotion("see https://www.notion.so/a-0123456789abcdef0123456789abcdef and acme.notion.site/x"), "see (a Notion page) and Notion");
  });
});
