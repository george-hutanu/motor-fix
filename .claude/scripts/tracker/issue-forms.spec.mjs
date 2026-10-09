import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("../../../.github/ISSUE_TEMPLATE/", import.meta.url));
const FORMS = { story: "story", task: "task", bug: "bug", "tech-debt": "tech debt", decision: "decision" };
const read = (name) => readFileSync(`${DIR}${name}`, "utf8");
const topLevel = (text, key) => text.match(new RegExp(`^${key}:\\s*(.*)$`, "m"))?.[1];

// @traces 1017-FR-005
describe("the issue forms", () => {
  for (const [file, type] of Object.entries(FORMS)) {
    describe(`${file}.yml`, () => {
      it("exists with a name and a description", () => {
        assert.ok(existsSync(`${DIR}${file}.yml`));
        const text = read(`${file}.yml`);
        assert.ok(topLevel(text, "name"));
        assert.ok(topLevel(text, "description"));
      });

      it(`applies exactly the "type: ${type}" label`, () => {
        assert.equal(topLevel(read(`${file}.yml`), "labels"), `["type: ${type}"]`);
      });

      // The Project's number exists only after the bootstrap's first live run,
      // which inserts the key; an unresolvable value would break the form.
      // TODO: until the owner's live `node .claude/scripts/tracker/bootstrap.mjs`
      // (quickstart.md §3) writes `projects:` into the forms, this assertion never runs.
      it("names the Project by number once the bootstrap has written the key", () => {
        const projects = topLevel(read(`${file}.yml`), "projects");
        if (projects !== undefined) assert.match(projects, /^\["george-hutanu\/\d+"\]$/);
      });

      it("asks for at least one required textarea and sets no title prefix", () => {
        const text = read(`${file}.yml`);
        assert.match(text, /- type: textarea[\s\S]*?required: true/);
        assert.equal(topLevel(text, "title"), undefined);
      });
    });
  }

  it("turns blank issues off", () => {
    assert.match(read("config.yml"), /^blank_issues_enabled: false$/m);
  });
});
