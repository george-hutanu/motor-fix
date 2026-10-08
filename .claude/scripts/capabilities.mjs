#!/usr/bin/env node
// Living capability specs — what this system does TODAY, as opposed to what
// some feature once proposed. Borrowed from OpenSpec (openspec.dev): its
// `openspec/specs/<domain>/spec.md` holds current truth, a change carries only
// a DELTA against it, and `archive` merges the delta in.
//
// The gap this closes: `specs/NNN-*/spec.md` is written once and never revised,
// so after five features nothing in the repository states the current contract.
// Spec 005 kept describing a PrimeNG interface that 007 had deleted, and the
// only record of that was a strikethrough in CLAUDE.md. A frozen proposal is
// not a specification.
//
// Two files, two jobs:
//   .specify/capabilities/<slug>.md   current truth, one file per capability
//   specs/<feature>/spec.md           a proposal, carrying a `## Spec Delta`
//
// The delta block is the whole interface:
//
//   ## Spec Delta
//
//   ### Capability: `cli-tasks`
//
//   - **Adds**: FR-001–FR-008
//   - **Modifies**: `001-FR-004` → `FR-005`
//   - **Removes**: `001-FR-009`
//
// `Adds` names this feature's own ids (FR-XXX, ranges allowed). `Modifies` and
// `Removes` name requirements ALREADY IN the capability, feature-qualified
// (`NNN-FR-XXX`) because FR numbering restarts per feature.
//
// Validation catches the mistake OpenSpec itself reports as a bug (Fission-AI/
// OpenSpec#1112): a `Modifies`/`Removes` naming a requirement the base spec
// does not contain passes `validate` there and only fails later, at archive.
// Here the base-existence check runs at lint time, where the fix is cheap.
//
// Usage:
//   node .claude/scripts/capabilities.mjs list
//   node .claude/scripts/capabilities.mjs show <slug>
//   node .claude/scripts/capabilities.mjs validate [specs/NNN-x]   [--check]
//   node .claude/scripts/capabilities.mjs merge   [specs/NNN-x]    [--apply]
//   node .claude/scripts/capabilities.mjs retired [--json]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { activeFeature } from "./lib/feature.mjs";

export const capabilitiesDir = (repo) => join(repo, ".specify", "capabilities");

const today = () => new Date().toISOString().slice(0, 10);

// --- reading the living specs -----------------------------------------------

/**
 * One capability file, parsed. `requirements` maps a feature-qualified token to
 * its heading text; `retired` maps a token to the line that retired it. Both
 * are read from headings, never from prose, so a requirement merely MENTIONED
 * in a rationale is not mistaken for one the capability holds.
 */
export function parseCapability(text) {
  const requirements = new Map();
  const retired = new Map();
  let section = null;
  for (const line of text.split("\n")) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      section = heading[1].toLowerCase();
      continue;
    }
    if (section === "requirements") {
      const m = line.match(/^###\s+(\d{3}-FR-\d{3})\s*(?:—|-|:)?\s*(.*)$/);
      if (m) requirements.set(m[1], m[2].trim());
    } else if (section === "retired") {
      const m = line.match(/^-\s+`(\d{3}-FR-\d{3})`\s*(?:—|-|:)?\s*(.*)$/);
      if (m) retired.set(m[1], m[2].trim());
    }
  }
  const slug = text.match(/^capability:\s*(\S+)\s*$/m)?.[1] ?? null;
  const features = [...text.matchAll(/^\s+-\s+(\d{3}-[\w-]+)\s*$/gm)].map((m) => m[1]);
  return { slug, features, requirements, retired };
}

/** Every capability on disk, keyed by slug. */
export function loadCapabilities(repo) {
  const dir = capabilitiesDir(repo);
  const out = new Map();
  for (const name of existsSync(dir) ? readdirSync(dir).sort() : []) {
    if (!name.endsWith(".md")) continue;
    const file = join(dir, name);
    const text = readFileSync(file, "utf8");
    const parsed = parseCapability(text);
    out.set(parsed.slug ?? basename(name, ".md"), { ...parsed, file, name, text });
  }
  return out;
}

/**
 * Every requirement any capability has retired. `.claude/scripts/trace-matrix.mjs`
 * reads this: a retired requirement is not an untested one, and this is the
 * honest way out of the coverage gate — the one `.specify/trace-baseline.json`
 * was being asked to provide by growing, which the config-protection hook
 * blocks precisely because it is not honest.
 */
export function retiredTokens(repo) {
  const out = new Set();
  for (const cap of loadCapabilities(repo).values()) for (const t of cap.retired.keys()) out.add(t);
  return out;
}

// --- reading a feature's delta ----------------------------------------------

/** `FR-001–FR-004` / `FR-001-FR-004` / `FR-007` → the ids it covers. */
function expandRange(token) {
  const range = token.match(/^(FR-\d{3})\s*[–—-]+\s*(FR-\d{3})$/);
  if (!range) return /^FR-\d{3}$/.test(token) ? [token] : [];
  const from = Number(range[1].slice(3));
  const to = Number(range[2].slice(3));
  if (to < from) return [];
  return Array.from({ length: to - from + 1 }, (_, i) => `FR-${String(from + i).padStart(3, "0")}`);
}

const listValues = (line) =>
  line
    .replace(/^[\s-]*\*{0,2}[A-Za-z]+\*{0,2}\s*:\s*/, "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !/^none$/i.test(s));

/**
 * The `## Spec Delta` block of a feature spec, as a list of per-capability
 * sections. Returns [] when the spec declares no delta at all — the caller
 * decides whether that is a finding, because a spec with no requirements
 * legitimately has nothing to merge.
 */
export function parseDelta(specText) {
  const lines = specText.split("\n");
  const start = lines.findIndex((l) => /^##\s+Spec Delta\b/i.test(l));
  if (start === -1) return [];
  const sections = [];
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/.test(line) && !/^###/.test(line)) break; // next top-level section ends the block
    const cap = line.match(/^###\s+Capability:\s*`?([\w-]+)`?/i);
    if (cap) {
      current = { capability: cap[1], adds: [], modifies: [], removes: [] };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    if (/^[\s-]*\*{0,2}Adds\*{0,2}\s*:/i.test(line)) {
      for (const value of listValues(line)) current.adds.push(...expandRange(value.replace(/`/g, "")));
    } else if (/^[\s-]*\*{0,2}Modifies\*{0,2}\s*:/i.test(line)) {
      for (const value of listValues(line)) {
        const m = value.match(/`?(\d{3}-FR-\d{3})`?\s*(?:→|->)\s*`?(FR-\d{3})`?/);
        if (m) current.modifies.push({ base: m[1], by: m[2] });
        else current.modifies.push({ base: value.replace(/`/g, ""), by: null });
      }
    } else if (/^[\s-]*\*{0,2}Removes\*{0,2}\s*:/i.test(line)) {
      for (const value of listValues(line)) {
        const m = value.match(/`?(\d{3}-FR-\d{3})`?\s*(?:—|-|:)?\s*(.*)$/);
        if (m) current.removes.push({ base: m[1], why: m[2].trim() });
      }
    }
  }
  return sections;
}

/**
 * The FR ids a spec DECLARES, with the text of each — same rule as artifact-lint.
 * A requirement wrapped over indented lines is one text: the continuation runs
 * until a blank line, an unindented line or another bullet.
 */
export function declaredRequirements(specText) {
  const out = new Map();
  let current = null;
  for (const line of specText.split("\n")) {
    const m = line.match(/^\s*-\s+\*{0,2}(FR-\d{3})\*{0,2}\s*[:.]\s*(.*)$/);
    if (m) {
      current = out.has(m[1]) ? null : m[1];
      if (current) out.set(current, m[2].trim());
    } else if (current && /^\s+\S/.test(line) && !/^\s*-\s/.test(line)) {
      out.set(current, `${out.get(current)} ${line.trim()}`);
    } else {
      current = null;
    }
  }
  return out;
}

// --- validation --------------------------------------------------------------

/**
 * Findings for one feature's delta. ERROR is a defect that would corrupt a
 * capability on merge; WARN is worth a look. Imported by artifact-lint so the
 * rules live in one place and fire from both entry points.
 */
export function validateFeature(repo, feature) {
  const findings = [];
  const add = (level, rule, message) => findings.push({ level, rule, message });
  const specFile = join(feature.dir, "spec.md");
  if (!existsSync(specFile)) return findings;

  const specText = readFileSync(specFile, "utf8");
  const declared = declaredRequirements(specText);
  const delta = parseDelta(specText);
  const caps = loadCapabilities(repo);
  // The archive merges a feature's delta and then marks it Archived; after
  // that, the capability holding its Adds, and tombstones naming this feature
  // for its Modifies and Removes bases, are the merge done, not a second one.
  // Only the spec's own status line counts: a fenced example of one does not,
  // nor a status word that merely starts with Archived ("Archived-pending").
  const isArchived = /^\*\*Status\*\*:[ \t]*archived(?=\s|\(|$)/im.test(specText.replace(/^```[\s\S]*?^```/gm, ""));
  // Its Modifies and Removes are tombstones by then: a base this feature's
  // own archive retired is that merge, not a retired requirement reused.
  const mergedHere = (cap, base, mark) => isArchived && (cap.retired.get(base) ?? "").startsWith(mark);

  if (delta.length === 0) {
    if (declared.size > 0)
      add("WARN", "delta-missing", `spec.md declares ${declared.size} FR(s) but has no "## Spec Delta" block — nothing says which capability they change`);
    return findings;
  }

  const assigned = new Set();
  for (const section of delta) {
    const cap = caps.get(section.capability);
    if (!cap) {
      add("ERROR", "delta-unknown-capability", `the delta names capability "${section.capability}", which has no file in .specify/capabilities/`);
      // The ids this section claimed still count as assigned. One defect earns
      // one finding: reporting every requirement in an unknown capability as
      // "unassigned" as well buries the line that says what is actually wrong.
      for (const id of section.adds) assigned.add(id);
      for (const { by } of section.modifies) if (by) assigned.add(by);
      continue;
    }

    for (const id of section.adds) {
      assigned.add(id);
      if (!declared.has(id)) add("ERROR", "delta-adds-undeclared", `Adds names ${id}, which spec.md does not declare`);
      const token = `${feature.num}-${id}`;
      if (!isArchived && cap.requirements.has(token))
        add("ERROR", "delta-adds-existing", `Adds names ${id}, but ${token} is already in ${cap.name} — that is a Modifies, not an Adds`);
    }

    // The rule OpenSpec's own validate misses (Fission-AI/OpenSpec#1112): a
    // base that is not in the capability is caught here, not at merge time.
    for (const { base, by } of section.modifies) {
      if (by) assigned.add(by);
      if (by && !declared.has(by)) add("ERROR", "delta-modifies-undeclared", `Modifies replaces ${base} with ${by}, which spec.md does not declare`);
      if (!by) add("ERROR", "delta-modifies-malformed", `Modifies entry "${base}" names no replacement — write \`${base}\` → \`FR-XXX\``);
      if (!cap.requirements.has(base) && !(by && mergedHere(cap, base, `superseded by \`${feature.num}-${by}\``))) {
        add(
          "ERROR",
          cap.retired.has(base) ? "delta-base-retired" : "delta-base-missing",
          cap.retired.has(base)
            ? `Modifies names ${base}, which ${cap.name} already retired — a retired requirement cannot be modified`
            : `Modifies names ${base}, which is not a requirement of ${cap.name}`,
        );
      }
    }

    for (const { base } of section.removes) {
      if (!cap.requirements.has(base) && !mergedHere(cap, base, `removed by ${feature.name} `)) {
        add(
          "ERROR",
          cap.retired.has(base) ? "delta-base-retired" : "delta-base-missing",
          cap.retired.has(base)
            ? `Removes names ${base}, which ${cap.name} already retired`
            : `Removes names ${base}, which is not a requirement of ${cap.name}`,
        );
      }
    }
  }

  // An archived feature's requirements already live in a capability under its
  // own number; they are assigned even when its delta no longer names them.
  const archived = (id) =>
    [...caps.values()].some((cap) => cap.requirements.has(`${feature.num}-${id}`) || cap.retired.has(`${feature.num}-${id}`));
  for (const id of declared.keys()) {
    if (!assigned.has(id) && !archived(id)) add("WARN", "delta-unassigned", `${id} is declared in spec.md but named in no Adds or Modifies — it will merge into no capability`);
  }
  return findings;
}

// --- merging ------------------------------------------------------------------

const renderRequirement = (token, text, feature) =>
  `### ${token} — ${text}\n\n_From ${feature.name}._\n`;

/**
 * The edits archiving this feature would make, per capability. Pure: it returns
 * the new file text and never writes, so `merge` without `--apply` is an honest
 * preview rather than a description of what it intends to do.
 */
export function planMerge(repo, feature) {
  const specText = readFileSync(join(feature.dir, "spec.md"), "utf8");
  const declared = declaredRequirements(specText);
  const caps = loadCapabilities(repo);
  const plans = [];

  for (const section of parseDelta(specText)) {
    const cap = caps.get(section.capability);
    if (!cap) continue;
    const added = [];
    const modified = [];
    const removed = [];
    let text = cap.text;

    for (const { base, by } of section.modifies) {
      if (!by || !cap.requirements.has(base)) continue;
      const token = `${feature.num}-${by}`;
      // The replacement takes the base's place in the document, so the reading
      // order of a capability stays the order its behaviour was built in.
      const pattern = new RegExp(`^### ${base} —[^\\n]*\\n(?:(?!^### )[\\s\\S])*`, "m");
      text = text.replace(pattern, renderRequirement(token, declared.get(by) ?? "", feature) + "\n");
      modified.push({ base, token });
    }

    for (const { base, why } of section.removes) {
      if (!cap.requirements.has(base)) continue;
      const pattern = new RegExp(`^### ${base} —[^\\n]*\\n(?:(?!^### )[\\s\\S])*`, "m");
      text = text.replace(pattern, "");
      removed.push({ base, why });
    }

    const newRequirements = section.adds
      .filter((id) => declared.has(id))
      .map((id) => renderRequirement(`${feature.num}-${id}`, declared.get(id), feature));
    if (newRequirements.length) {
      added.push(...section.adds.filter((id) => declared.has(id)).map((id) => `${feature.num}-${id}`));
      text = insertUnder(text, "Requirements", newRequirements.join("\n"));
    }

    const tombstones = [
      ...removed.map(({ base, why }) => `- \`${base}\` — removed by ${feature.name} (${today()})${why ? `: ${why}` : ""}`),
      ...modified.map(({ base, token }) => `- \`${base}\` — superseded by \`${token}\` (${today()})`),
    ];
    if (tombstones.length) text = insertUnder(text, "Retired", `${tombstones.join("\n")}\n`);

    text = text.replace(/^updated:.*$/m, `updated: ${today()}`);
    if (!cap.features.includes(feature.name)) {
      // `features: []` is how a capability with no feature yet is often written;
      // turn it into the block list the rest of this file reads and appends to.
      text = text.replace(/^features:\s*\[\s*\]\s*$/m, "features:");
      text = text.replace(/^(features:\n(?:\s+-\s+\S+\n)*)/m, (m) => `${m}  - ${feature.name}\n`);
    }
    plans.push({ capability: section.capability, file: cap.file, text, added, modified, removed });
  }
  return plans;
}

/** Append a block at the end of a `## <heading>` section, creating it if absent. */
function insertUnder(text, heading, block) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${heading}\\s*$`, "i").test(l));
  if (start === -1) return `${text.replace(/\n+$/, "")}\n\n## ${heading}\n\n${block}`;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i]) && !/^###/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const body = lines.slice(start + 1, end).join("\n").replace(/\n+$/, "");
  return [...lines.slice(0, start + 1), body ? `${body}\n` : "", block.replace(/\n+$/, ""), "", ...lines.slice(end)]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

// --- CLI -----------------------------------------------------------------------

function main() {
  const repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const [command, target] = argv.filter((a) => !a.startsWith("--"));
  const check = flags.has("--check");

  const resolve = () =>
    target
      ? { dir: join(repo, target), name: basename(target), num: basename(target).match(/^(\d{3})-/)?.[1] ?? "000" }
      : activeFeature(repo);

  if (command === "list" || command === undefined) {
    const caps = loadCapabilities(repo);
    if (caps.size === 0) {
      console.log("No capabilities yet. Create one from .specify/templates/capability-template.md.");
      return 0;
    }
    for (const [slug, cap] of caps) {
      console.log(`${slug}  ${cap.requirements.size} requirement(s), ${cap.retired.size} retired  (${cap.features.join(", ") || "no features merged"})`);
    }
    return 0;
  }

  if (command === "show") {
    const cap = loadCapabilities(repo).get(target);
    if (!cap) {
      console.error(`capabilities: no capability "${target}"`);
      return 1;
    }
    console.log(cap.text);
    return 0;
  }

  if (command === "retired") {
    const tokens = [...retiredTokens(repo)].sort();
    console.log(flags.has("--json") ? JSON.stringify(tokens) : tokens.join("\n") || "(none)");
    return 0;
  }

  const feature = resolve();
  if (!feature || !existsSync(join(feature.dir, "spec.md"))) {
    console.error("capabilities: no feature to read (pass specs/NNN-slug, or set .specify/feature.json)");
    return check ? 1 : 0;
  }

  if (command === "validate") {
    const findings = validateFeature(repo, feature);
    const errors = findings.filter((f) => f.level === "ERROR");
    console.log(`capabilities: ${feature.name} — ${errors.length} error(s), ${findings.length - errors.length} warning(s)`);
    for (const f of findings) console.log(`  ${f.level === "ERROR" ? "✗" : "!"} [${f.rule}] ${f.message}`);
    if (findings.length === 0) console.log("  ✓ the delta merges cleanly");
    return check && errors.length ? 1 : 0;
  }

  if (command === "merge") {
    const blocking = validateFeature(repo, feature).filter((f) => f.level === "ERROR");
    if (blocking.length) {
      console.error(`capabilities: ${feature.name} has ${blocking.length} delta error(s) — fix them before merging:`);
      for (const f of blocking) console.error(`  ✗ [${f.rule}] ${f.message}`);
      return 1;
    }
    const plans = planMerge(repo, feature);
    if (plans.length === 0) {
      console.log(`capabilities: ${feature.name} changes no capability.`);
      return 0;
    }
    for (const plan of plans) {
      console.log(
        `${plan.capability}: +${plan.added.length} added, ~${plan.modified.length} modified, -${plan.removed.length} removed`,
      );
      if (flags.has("--apply")) writeFileSync(plan.file, plan.text);
    }
    console.log(flags.has("--apply") ? "Applied." : "Dry run — pass --apply to write.");
    return 0;
  }

  console.error(`capabilities: unknown command "${command}" (list, show, validate, merge, retired)`);
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(capabilitiesDir(process.env.CLAUDE_PROJECT_DIR ?? process.cwd()), { recursive: true });
  process.exit(main());
}
