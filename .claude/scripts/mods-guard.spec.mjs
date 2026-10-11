// The Chief mod's hard limits, read from the files
// themselves: a plugin test runs inside the engine and cannot read the repo.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
// @traces 1168-FR-001 1168-FR-014 1168-FR-015 1168-FR-018 1168-FR-019

const REPO = join(import.meta.dirname, "..", "..");
const PLUGINS = join(REPO, ".claude", "plugins");

const sources = () =>
  readdirSync(PLUGINS, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && /\.(js|ts|tsx|json)$/.test(d.name))
    .map((d) => join(d.parentPath, d.name))
    .filter((f) => !f.includes(join(".claude-plugin", "types")))
    .map((f) => ({ file: relative(REPO, f), text: readFileSync(f, "utf8") }));

const here = (path) => JSON.parse(readFileSync(join(REPO, path), "utf8"));

const offenders = (pattern) => sources().filter((s) => pattern.test(s.text)).map((s) => s.file);

describe("motorfix-chief limits", () => {
  it("never approves a permission: no tool.check and no session authorize call", () => {
    expect(offenders(/tool\.check|session\.authorize/)).toEqual([]);
  });

  it("runs subprocesses as argument lists, never through a shell", () => {
    expect(offenders(/process\.(run|spawn)\(\s*[`'"]/)).toEqual([]);
    expect(offenders(/['"](?:ba|z)?sh['"]\s*,\s*['"]-l?c['"]/)).toEqual([]);
  });

  it("never pushes", () => {
    expect(offenders(/['"]push['"]|git push/)).toEqual([]);
  });

  // Durable forms of the permission and gate limits: they hold on main after the merge too,
  // where a later PR may still bless a gate or add a permission rule.
  it("adds no permission rule for the mod", () => {
    const permissions = JSON.stringify(here(".claude/settings.json").permissions ?? {});
    expect(permissions).not.toMatch(/motorfix-chief/);
  });

  it("keeps every registered gate a settings hook run through run-hook.mjs, none named by the mod", () => {
    const settings = readFileSync(join(REPO, ".claude", "settings.json"), "utf8");
    const gates = here(".claude/hooks/registry.json").hooks;
    expect(gates.filter((g) => !settings.includes(`run-hook.mjs ${g.id}`))).toEqual([]);
    const names = gates.flatMap((g) => [g.id, g.script]);
    expect(sources().filter((s) => names.some((n) => s.text.includes(n))).map((s) => s.file)).toEqual([]);
  });
});

describe("motorfix-chief layout and CI", () => {
  it("is one in-repo plugin, enabled from the repo's own marketplace, loading one register module", () => {
    const root = ".claude/plugins/motorfix-chief";
    expect(here(`${root}/.claude-plugin/plugin.json`).name).toBe("motorfix-chief");
    expect(here(`${root}/hooks/hooks.json`)).toEqual({ modules: ["./register.js"] });
    const market = here(".claude/plugins/.claude-plugin/marketplace.json");
    expect(market.plugins.map((p) => p.name)).toEqual(["motorfix-chief"]);
    const settings = here(".claude/settings.json");
    expect(settings.extraKnownMarketplaces.motorfix.source).toEqual({ source: "directory", path: "./.claude/plugins" });
    expect(settings.enabledPlugins["motorfix-chief@motorfix"]).toBe(true);
  });

  it("imports nothing from outside the plugin; only its .ts test files import the engine's test kit", () => {
    const outside = sources()
      .flatMap((s) => [...s.text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => `${s.file}: ${m[1]}`))
      .filter((line) => !/: \.\.?\//.test(line) && !/\.ts: claude-code\/testing$/.test(line));
    expect(outside).toEqual([]);
  });

  it("validates and tests the plugin on a pinned CLI in CI's Harness step", () => {
    const script = here("package.json").scripts["test:mods"];
    expect(script).toMatch(/@anthropic-ai\/claude-code@\d+\.\d+\.\d+ plugin validate --strict \.claude\/plugins\/motorfix-chief/);
    expect(script).toMatch(/@anthropic-ai\/claude-code@\d+\.\d+\.\d+ plugin test \.claude\/plugins\/motorfix-chief/);
    const ci = readFileSync(join(REPO, ".github", "workflows", "ci.yml"), "utf8");
    const harness = ci.slice(ci.indexOf("npm run test:harness"));
    expect(harness.slice(0, 200)).toContain("npm run test:mods");
  });
});
