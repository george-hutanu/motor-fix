// The Chief mod's hard limits (FR-014, FR-015, FR-018), read from the files
// themselves: a plugin test runs inside the engine and cannot read the repo.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "..", "..");
const PLUGINS = join(REPO, ".claude", "plugins");

const sources = () =>
  readdirSync(PLUGINS, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && /\.(js|ts|tsx|json)$/.test(d.name))
    .map((d) => join(d.parentPath, d.name))
    .filter((f) => !f.includes(join(".claude-plugin", "types")))
    .map((f) => ({ file: relative(REPO, f), text: readFileSync(f, "utf8") }));

const onMain = (path) =>
  JSON.parse(execFileSync("git", ["show", `origin/main:${path}`], { cwd: REPO, encoding: "utf8" }));
const here = (path) => JSON.parse(readFileSync(join(REPO, path), "utf8"));

const offenders = (pattern) => sources().filter((s) => pattern.test(s.text)).map((s) => s.file);

describe("motorfix-chief limits", () => {
  it("never approves a permission: no tool.check and no session authorize call (FR-014)", () => {
    expect(offenders(/tool\.check|session\.authorize/)).toEqual([]);
  });

  it("runs subprocesses as argument lists, never through a shell (FR-018)", () => {
    expect(offenders(/process\.(run|spawn)\(\s*[`'"]/)).toEqual([]);
    expect(offenders(/['"](?:ba|z)?sh['"]\s*,\s*['"]-l?c['"]/)).toEqual([]);
  });

  it("never pushes (FR-018)", () => {
    expect(offenders(/['"]push['"]|git push/)).toEqual([]);
  });

  it("leaves the permission settings as main has them (FR-014)", () => {
    expect(here(".claude/settings.json").permissions).toEqual(onMain(".claude/settings.json").permissions);
  });

  it("leaves the 16 settings-hook gates and their fingerprints as main has them (FR-015)", () => {
    const gates = here(".claude/hooks/registry.json").hooks;
    expect(gates).toEqual(onMain(".claude/hooks/registry.json").hooks);
  });
});
