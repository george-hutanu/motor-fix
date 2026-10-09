#!/usr/bin/env node
// What a requirement change would break. Borrowed from BMAD's
// `bmad-correct-course`, which "assesses mid-sprint changes and produces impact
// analysis" as a named step rather than letting a changed intent be edited
// straight into the spec.
//
// The gap this closes: `.claude/scripts/spec-drift.mjs` enforces that code and spec
// move together, but nothing answers the question that comes first — if this
// requirement changes, which tasks, which tests and which capability
// requirement stop being true? Answering it by hand means grepping three
// places and missing the fourth.
//
// Usage:
//   node .claude/scripts/impact.mjs FR-004 FR-007        # for the active feature
//   node .claude/scripts/impact.mjs specs/002-x FR-004
//   node .claude/scripts/impact.mjs --all                # every requirement
//   node .claude/scripts/impact.mjs FR-004 --json
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { activeFeature, locateFeature } from "./lib/feature.mjs";
import { testsFor } from "./lib/tests.mjs";
import { loadCapabilities } from "./capabilities.mjs";

/**
 * Everything that rests on one requirement. `token` is the feature-qualified
 * form the tests and capabilities use; `fr` is the bare id the spec and tasks
 * use. Both are needed because FR numbering restarts per feature.
 */
export function impactOf(repo, feature, fr) {
  const token = `${feature.num}-${fr}`;
  const read = (name) => {
    const p = join(feature.dir, name);
    return existsSync(p) ? readFileSync(p, "utf8") : "";
  };

  const specLine =
    read("spec.md")
      .split("\n")
      .find((l) => new RegExp(`^\\s*-\\s+\\*{0,2}${fr}\\*{0,2}\\s*[:.]`).test(l))
      ?.trim() ?? null;

  const tasks = read("tasks.md")
    .split("\n")
    .filter((l) => l.includes(fr) && /^\s*- \[[ Xx]\]/.test(l))
    .map((l) => ({ done: /^\s*- \[[Xx]\]/.test(l), line: l.trim() }));

  const tests = testsFor(repo, token);

  // Where the requirement lives once it has been archived, and who has already
  // spoken about it. A requirement another feature supersedes is not one you
  // can quietly rewrite.
  let capability = null;
  const supersededBy = [];
  for (const [slug, cap] of loadCapabilities(repo)) {
    if (cap.requirements.has(token)) capability = { slug, text: cap.requirements.get(token) };
    if (cap.retired.has(token)) supersededBy.push({ slug, note: cap.retired.get(token) });
  }

  return { fr, token, specLine, tasks, tests, capability, supersededBy };
}

export function render(feature, impacts) {
  const lines = [`Impact — ${feature.name}`, ""];
  for (const i of impacts) {
    lines.push(`${i.fr}  (token ${i.token})`);
    lines.push(`  spec        ${i.specLine ?? "NOT DECLARED in spec.md"}`);
    lines.push(
      `  tasks       ${i.tasks.length ? i.tasks.map((t) => `${t.done ? "[X]" : "[ ]"} ${t.line.replace(/^- \[[ Xx]\]\s*/, "")}`).join("\n              ") : "none"}`,
    );
    lines.push(`  tests       ${i.tests.join(", ") || "none — nothing would fail if this changed"}`);
    lines.push(`  capability  ${i.capability ? `${i.capability.slug} holds it` : "not merged into any capability yet"}`);
    if (i.supersededBy.length)
      lines.push(`  retired     ${i.supersededBy.map((s) => `${s.slug}: ${s.note}`).join("; ")}`);
    lines.push("");
  }
  const silent = impacts.filter((i) => i.tests.length === 0);
  if (silent.length)
    lines.push(
      `${silent.length} requirement(s) have no test: ${silent.map((i) => i.fr).join(", ")}. ` +
        "Changing those changes behaviour nothing would catch.",
    );
  return lines.join("\n");
}

export function main(argv, repo) {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const named = positional.find((a) => a.startsWith("specs/"));
  const feature = named
    ? { dir: locateFeature(repo, named, "spec.md"), name: basename(named), num: basename(named).match(/^(\d{3,})-/)?.[1] ?? "000" }
    : activeFeature(repo);

  if (!feature || !existsSync(join(feature.dir, "spec.md"))) {
    console.error("impact: no feature to read (pass specs/NNN-slug, or set .specify/feature.json)");
    return 1;
  }

  const spec = readFileSync(join(feature.dir, "spec.md"), "utf8");
  const declared = [...new Set([...spec.matchAll(/^\s*-\s+\*{0,2}(FR-\d{3})\*{0,2}\s*[:.]/gm)].map((m) => m[1]))];
  const asked = positional.filter((a) => /^FR-\d{3}$/.test(a));
  const wanted = argv.includes("--all") || asked.length === 0 ? declared : asked;

  if (wanted.length === 0) {
    console.error(`impact: ${feature.name} declares no requirements`);
    return 1;
  }

  const impacts = wanted.map((fr) => impactOf(repo, feature, fr));
  console.log(argv.includes("--json") ? JSON.stringify({ feature: feature.name, impacts }, null, 2) : render(feature, impacts));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2), process.env.CLAUDE_PROJECT_DIR ?? process.cwd()));
}
