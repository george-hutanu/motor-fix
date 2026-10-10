import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { specsClone } from "./repos.mjs";

// The forms live in the private specs clone (motor-fix-specs), which CI does
// not check out; the public repository keeps only a config that points there.
const DIR = `${join(specsClone(fileURLToPath(new URL("../../../", import.meta.url))), ".github", "ISSUE_TEMPLATE")}/`;
const CODE_DIR = fileURLToPath(new URL("../../../.github/ISSUE_TEMPLATE/", import.meta.url));
const FORMS = { story: "story", task: "task", bug: "bug", "tech-debt": "tech debt", decision: "decision" };
const read = (name) => readFileSync(`${DIR}${name}`, "utf8");
const topLevel = (text, key) => text.match(new RegExp(`^${key}:\\s*(.*)$`, "m"))?.[1];

// @traces 1017-FR-005
describe.skipIf(!existsSync(DIR))("the issue forms in the specs clone", () => {
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

// @traces 1017-FR-005
describe("the public repository's issue templates", () => {
  it("hold only a config that turns blank issues off and points at the private tracker", () => {
    assert.deepEqual(readdirSync(CODE_DIR), ["config.yml"]);
    const text = readFileSync(`${CODE_DIR}config.yml`, "utf8");
    assert.match(text, /^blank_issues_enabled: false$/m);
    assert.match(text, /url: https:\/\/github\.com\/george-hutanu\/motor-fix-specs\/issues$/m);
  });
});
