// Claude Code PreToolUse hook (matcher: Edit|Write|MultiEdit) — protect the
// ratchets. Borrowed from ECC's `pre:config-protection` ("block modifications
// to linter/formatter config files; steer the agent to fix code instead of
// weakening configs").
//
// This repo has three ratchets that existed only as prose in CLAUDE.md, which
// means the cheapest way out of a red gate was always to edit the gate:
//
//   1. stryker.config.json `thresholds.break` — "raise it after a harden pass,
//      never lower it to make a run pass"
//   2. .specify/trace-baseline.json — "adding an entry to buy time defeats the
//      gate"
//   3. the NNN-FR- @traces tokens in the colocated *.spec.ts / *.test.ts files
//      — deleting one silences the traceability
//      gate for that requirement
//
// Each of those is now a block (exit 2) with the honest alternative in the
// message. The gate is evaluated on the PROPOSED file content: the edit is
// applied in memory first, so a fragment that looks innocent but lowers a
// floor is judged the same as a whole-file rewrite.
//
// Under SPECKIT_HOOK_PROFILE=strict the harness itself freezes too: edits to
// .claude/hooks/ and .claude/settings.json need SPECKIT_ALLOW_HOOK_EDIT=1.
// Under `standard` those edits pass with a reminder to re-bless fingerprints.
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { profileOf } from "../scripts/lib/hooks.mjs";
import { contextFileName, measure, readBaseline } from "../scripts/context-audit.mjs";
import { isEntryPoint } from "../scripts/lib/entry.mjs";

const repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

const block = (why) => {
  console.error(`Config protection: ${why}`);
  process.exit(2);
};

/** The file as it would look after this tool call — null when we cannot tell. */
export function proposedContent(current, toolInput) {
  if (typeof toolInput?.content === "string") return toolInput.content; // Write
  const edits = toolInput?.edits ?? (toolInput?.old_string !== undefined ? [toolInput] : []);
  if (!edits.length || current === null) return null;
  let next = current;
  for (const edit of edits) {
    if (typeof edit.old_string !== "string" || typeof edit.new_string !== "string") return null;
    if (!next.includes(edit.old_string)) return null; // stale edit — let the tool report it
    next = edit.replace_all
      ? next.split(edit.old_string).join(edit.new_string)
      : next.replace(edit.old_string, edit.new_string);
  }
  return next;
}

/** thresholds.break, or null when the text is not parseable Stryker config. */
export function breakFloor(text) {
  try {
    const value = JSON.parse(text)?.thresholds?.break;
    return typeof value === "number" ? value : null;
  } catch {
    const m = text.match(/"break"\s*:\s*(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : null;
  }
}

/** Total exemptions listed in a trace-baseline.json text. */
export function baselineSize(text) {
  try {
    const parsed = JSON.parse(text);
    return (parsed.grandfathered?.length ?? 0) + (parsed.artifact_legacy?.length ?? 0);
  } catch {
    return null;
  }
}

export const frTokens = (text) => new Set(text.match(/\b\d{3}-FR-\d{3}\b/g) ?? []);

/** A colocated test file, wherever it sits: `foo.spec.ts`, `page.test.tsx`, an e2e spec. */
export const isTestFile = (rel) => /\.(spec|test)\.[cm]?[jt]sx?$/.test(rel);

/** The rule that fires for this file, or null. Exported for the tests. */
export function verdict({ rel, current, next, profile, allowHookEdit, contextBaseline, allowContextGrowth, contextFile }) {
  if (next === null) return null;

  // Mutation is per workspace here: apps/server and apps/scanner each own a
  // stryker.config.json, so match the basename rather than one fixed path.
  // The agent context file is a ratchet in the shrinking direction. Borrowed
  // from BMAD's context audit, which enforces that the block "remains smaller
  // or equal to previous versions, never larger": a rules file loaded into
  // every session is the one file where growth is the default failure mode, and
  // it had no gate at all.
  if (contextFile && rel === contextFile && contextBaseline) {
    const after = measure(next).total.lines;
    if (after > contextBaseline.lines && !allowContextGrowth)
      return (
        `${rel} is a ratchet in the shrinking direction — this takes it from ${contextBaseline.lines} to ${after} non-empty lines. ` +
        "A line earns its place there only if removing it would change what the agent does, and the file is loaded into every session. " +
        "Delete a line that no longer earns it, or record the growth on purpose: " +
        'node .claude/scripts/context-audit.mjs --bless --allow-growth "<reason>", or SPECKIT_ALLOW_CONTEXT_GROWTH=1 for one edit.'
      );
  }

  if (rel === "stryker.config.json" || rel.endsWith("/stryker.config.json")) {
    const before = current === null ? null : breakFloor(current);
    const after = breakFloor(next);
    if (before !== null && after !== null && after < before)
      return `the mutation floor is a ratchet — this lowers thresholds.break from ${before} to ${after}. Kill the surviving mutants (or mark a genuinely equivalent one with a \`Stryker disable\` comment saying why) instead of lowering the floor.`;
  }

  if (rel === ".specify/trace-baseline.json") {
    const before = current === null ? null : baselineSize(current);
    const after = baselineSize(next);
    if (before !== null && after !== null && after > before)
      return `this adds a grandfathering entry (${before} → ${after}). The baseline exempts features that predate a gate — adding one to buy time is what the gate is for. Cover the FRs with tagged tests instead.`;
  }

  // Tests are colocated across apps/, libs/ and e2e/ rather than gathered in
  // one tests/ directory, so the test file is recognised by its name.
  if (isTestFile(rel) && current !== null) {
    const lost = [...frTokens(current)].filter((t) => !frTokens(next).has(t));
    if (lost.length)
      return `this removes requirement token${lost.length > 1 ? "s" : ""} ${lost.join(", ")} from ${rel}. The traceability gate reads those tokens — deleting one silences the gate for that requirement. Keep the token on whichever test still covers it.`;
  }

  const harness = rel.startsWith(".claude/hooks/") || rel === ".claude/settings.json";
  if (harness && profile === "strict" && !allowHookEdit)
    return `SPECKIT_HOOK_PROFILE=strict freezes the harness. To change ${rel}, re-run with SPECKIT_ALLOW_HOOK_EDIT=1 — the point is that weakening a gate is never accidental.`;

  return null;
}

// Only listen on stdin when run as the hook itself — the tests import the
// rules above and must not block on a stdin that never ends.
if (isEntryPoint(import.meta.url)) main();

function main() {
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => onPayload(raw));
}

function onPayload(raw) {
  let toolInput;
  try {
    toolInput = JSON.parse(raw).tool_input ?? {};
  } catch {
    process.exit(0);
  }
  const filePath = toolInput.file_path ?? "";
  if (!filePath) process.exit(0);

  // The harness sends an absolute path; a repo-relative one (an eval case, a
  // script) means the same file and is read the same way.
  const rel = isAbsolute(filePath) ? relative(repo, filePath) : filePath;
  if (rel.startsWith("..")) process.exit(0); // outside the repo — not our business

  const abs = join(repo, rel);
  const current = existsSync(abs) ? readFileSync(abs, "utf8") : null;
  const reason = verdict({
    rel,
    current,
    next: proposedContent(current, toolInput),
    profile: profileOf(),
    allowHookEdit: /^(1|true|yes|on)$/i.test(process.env.SPECKIT_ALLOW_HOOK_EDIT ?? ""),
    contextFile: contextFileName(repo),
    contextBaseline: readBaseline(repo),
    allowContextGrowth: /^(1|true|yes|on)$/i.test(process.env.SPECKIT_ALLOW_CONTEXT_GROWTH ?? ""),
  });
  if (reason) block(reason);

  // Not a block: a hook script changed, so its registry fingerprint is now
  // stale and `npm test` will say so. Say it here, while the fix is cheap.
  if (rel.startsWith(".claude/hooks/") && rel.endsWith(".mjs"))
    console.error(
      `[config-protection] ${rel} is a gate script — re-bless the registry with \`node .claude/scripts/doctor.mjs --bless-hooks\` after reviewing the change.`,
    );
  process.exit(0);
}
