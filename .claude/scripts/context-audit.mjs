#!/usr/bin/env node
// Audit and ratchet the agent context file. Borrowed from BMAD's theory of
// project context, which is blunt about it: "Most documentation written for AI
// agents makes them worse." Its two maintenance mechanisms are a **refresh**
// that re-checks every caveat against the current tree, and an **audit** that
// verifies each line still changes agent behaviour, "enforcing that blocks
// remain smaller or equal to previous versions, never larger."
//
// The inclusion test is the useful part: a line earns its place only if
// REMOVING it would change what the agent does. Excluded by construction —
// implementation details the agent can read directly, ecosystem defaults it
// already knows, repo structure maps, and anything merely interesting.
//
// This repository had the opposite pressure. CLAUDE.md gained a paragraph per
// feature and lost nothing; `/speckit-agent-context-update` only ever appends;
// `gc-scan.mjs` sweeps skills, hooks, instincts, telemetry and worktrees but
// never the context file itself. It reached the point of carrying its own
// history in strikethrough — a dependency listed as removed, in a file loaded
// into every session.
//
// The retention rule is BMAD's too, and it is why this proposes rather than
// deletes: "A policy or pitfall is removed only when what it is about is gone,
// or when a human removes it." Absence of recent failures is not evidence a
// rule is unnecessary — a working rule erases the evidence of its own need.
//
// Usage:
//   node .claude/scripts/context-audit.mjs                 audit + ratchet report
//   node .claude/scripts/context-audit.mjs --check         exit 1 if it grew past the baseline
//   node .claude/scripts/context-audit.mjs --jev           + ask the inclusion test directly
//   node .claude/scripts/context-audit.mjs --bless         record the current size
//   node .claude/scripts/context-audit.mjs --bless --allow-growth "<reason>"
//
// The four rules below are proxies for the inclusion test, not the test
// itself: strikethrough, a dead path, a bare path, a duplicated line. A
// paragraph that is simply true, well written and behaviourally inert passes
// all four. `--jev` asks the actual question of each block — would removing
// this change what the agent does — which is the one thing no regex can read.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The agent context file, most specific first. This repository keeps its rules
// in CLAUDE.md; the sibling repository sharing this harness keeps them in the
// git-excluded CLAUDE.local.md, because spec-driven development there is a
// local practice and CLAUDE.md is a one-line `@AGENTS.md` import pointing at
// the tracked, shared guidance.
//
// Two candidates are skipped rather than ratcheted:
//   * an empty file — a baseline of zero lines would block every edit that
//     ever added one;
//   * a file that is nothing but `@import` directives — it NAMES the context,
//     it is not the context, and ratcheting a pointer at one line is worse
//     than useless.
export const CONTEXT_CANDIDATES = ["CLAUDE.local.md", "CLAUDE.md", "AGENTS.md"];

const isPointerOnly = (text) => {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((l) => /^@\S+$/.test(l));
};

/** The repo-relative name of the context file, or null when there is none. */
export function contextFileName(repo) {
  for (const name of CONTEXT_CANDIDATES) {
    const file = join(repo, name);
    if (!existsSync(file) || statSync(file).size === 0) continue;
    if (isPointerOnly(readFileSync(file, "utf8"))) continue;
    return name;
  }
  return null;
}

export const contextFile = (repo) => {
  const name = contextFileName(repo);
  return name ? join(repo, name) : null;
};
export const baselinePath = (repo) => join(repo, ".specify", "context-baseline.json");

const MANAGED_START = "<!-- SPECKIT START -->";
const MANAGED_END = "<!-- SPECKIT END -->";

/** Non-empty lines and characters, for the whole file and for the managed block. */
export function measure(text) {
  const count = (s) => ({
    lines: s.split("\n").filter((l) => l.trim() !== "").length,
    chars: s.length,
  });
  const start = text.indexOf(MANAGED_START);
  const end = text.indexOf(MANAGED_END);
  const managed = start !== -1 && end > start ? text.slice(start + MANAGED_START.length, end) : "";
  return { total: count(text), managed: count(managed) };
}

export function readBaseline(repo) {
  const file = baselinePath(repo);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return typeof parsed?.lines === "number" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Lines that look like they stopped earning their place. Every rule here
 * answers the same question — would deleting this line change what the agent
 * does? — and every finding is a proposal, never an edit.
 */
export function audit(text, { repo, constitution = "" } = {}) {
  const findings = [];
  const lines = text.split("\n");
  const constitutionLines = new Set(
    constitution.split("\n").map((l) => l.trim()).filter((l) => l.length > 40),
  );

  lines.forEach((line, i) => {
    const n = i + 1;
    const trimmed = line.trim();
    if (!trimmed) return;

    // History. A file loaded into every session is not a changelog: what was
    // removed changes nothing an agent does, and it costs tokens on every call.
    if (/~~[^~]+~~/.test(line))
      findings.push({ line: n, rule: "history", message: "strikethrough records what a thing USED to be — that changes no behaviour" });
    else if (/\b(was replaced by|removed by|no longer used|used to be|formerly)\b/i.test(line) && !/^\s*[-*]\s*`/.test(line))
      findings.push({ line: n, rule: "history", message: "describes a past state rather than the current rule" });

    // A backticked repository path that no longer exists. The BMAD refresh:
    // "When a claim's source disappears, it's fixed or removed, never silently
    // redirected."
    if (repo) {
      for (const [, path] of line.matchAll(/`((?:bin|src|tests|scripts|packages|docs|evals)\/[^`\s]+)`/g)) {
        // `packages/<name>/` is a placeholder for a rule, not a claim that a
        // directory exists. Flagging it would train everyone to ignore this rule.
        if (path.includes("<") || path.includes(">")) continue;
        const bare = path.replace(/[.,;:]$/, "");
        if (!existsSync(join(repo, bare)))
          findings.push({ line: n, rule: "dead-reference", message: `\`${bare}\` does not exist` });
      }
    }

    // A whole line that only names a path. The agent can list the tree; a
    // stored copy goes stale and costs tokens on every call.
    if (/^\s*[-*]\s*`[^`]+`\s*$/.test(line))
      findings.push({ line: n, rule: "derivable", message: "names a path and says nothing about it — the agent can read the tree" });

    // Duplicated from the constitution, which the agent is told to read anyway.
    if (constitutionLines.has(trimmed))
      findings.push({ line: n, rule: "duplicate", message: "repeats a line from the constitution verbatim" });
  });

  return findings;
}

/**
 * The file as behavioural blocks, each with the line it starts on.
 *
 * The unit matters. This file is hard-wrapped prose, so a *line* is half a
 * sentence and asking whether it changes behaviour is meaningless. A block —
 * a paragraph, a bullet with its continuations, a fenced example, a table —
 * is the smallest thing that could actually be deleted.
 */
export function blocks(text) {
  const lines = text.split("\n");
  const out = [];
  let current = null;
  let fenced = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (!fenced && line.trim() === "") {
      current = null;
      return;
    }
    if (current === null) {
      current = { line: i + 1, text: line };
      out.push(current);
    } else {
      current.text += `\n${line}`;
    }
  });
  // A heading is a label for the block under it, never a rule of its own.
  return out.filter((b) => !/^#{1,6}\s/.test(b.text.trim()) || b.text.includes("\n"));
}

/**
 * BMAD's inclusion test, asked rather than approximated: a block earns its
 * place only if removing it would change what the agent does.
 *
 * Advisory like `audit` — it returns proposals a human judges, and the CLI
 * never lets it touch the exit code. An unavailable lane returns
 * `{ unavailable }` so the caller can say so instead of printing nothing and
 * implying the file is clean.
 */
export async function jevAudit(text, { repo, fetchImpl } = {}) {
  const { ask, noul, noulOf, qid, unavailableNote } = await import("./lib/jev.mjs");
  const units = blocks(text);
  if (units.length === 0) return { findings: [], unavailable: false };

  const questions = {};
  for (const unit of units) {
    questions[qid("b", unit.line)] = noul(
      `Would deleting block ${unit.line} from this agent instruction file change what a competent coding agent DOES in this repository?`,
      "it states a rule, a constraint, a gotcha or a command the agent would otherwise get wrong",
      "it is background, history, rationale the agent does not act on, a structure map it could read from the tree, or an ecosystem default it already knows",
    );
  }

  const state = {
    purpose: "An instruction file loaded into every session for a coding agent working in this repository.",
    blocks: Object.fromEntries(units.map((u) => [String(u.line), u.text])),
  };
  const { answers, unavailable, reason } = await ask(state, questions, { repo, fetchImpl });
  if (unavailable) return { findings: [], unavailable: true, note: unavailableNote(reason) };

  const findings = [];
  for (const unit of units) {
    const value = noulOf(answers[qid("b", unit.line)]);
    if (value === undefined || value > 0.3) continue;
    findings.push({
      line: unit.line,
      rule: "inert",
      value,
      message: `removing this would change nothing the agent does (jev ${value.toFixed(2)}): "${unit.text.replace(/\s+/g, " ").slice(0, 70)}…"`,
    });
  }
  // Weakest first: the point is which paragraph to cut, not a complete census.
  return { findings: findings.sort((a, b) => a.value - b.value), unavailable: false };
}

export function ratchet(current, baseline) {
  if (!baseline) return { state: "unset", message: "no baseline recorded — run --bless to set one" };
  const delta = current.total.lines - baseline.lines;
  if (delta > 0)
    return {
      state: "grown",
      delta,
      message:
        `the agent context file grew from ${baseline.lines} to ${current.total.lines} non-empty lines (+${delta}). ` +
        "The context file is a ratchet in the other direction: a line earns its place only if removing it would change what the agent does. " +
        "Delete a line that no longer does, or record the growth deliberately with --bless --allow-growth \"<reason>\".",
    };
  return {
    state: delta < 0 ? "shrunk" : "held",
    delta,
    message: delta < 0 ? `the agent context file shrank by ${-delta} line(s) — re-bless to lock it in` : "the agent context file held its size",
  };
}

export function main(argv, repo) {
  const name = contextFileName(repo);
  if (!name) {
    console.error(`context-audit: none of ${CONTEXT_CANDIDATES.join(", ")} exists with any content`);
    return 1;
  }
  const file = join(repo, name);
  const text = readFileSync(file, "utf8");
  const current = measure(text);
  const baseline = readBaseline(repo);
  const verdict = ratchet(current, baseline);

  if (argv.includes("--bless")) {
    const allowGrowth = argv.includes("--allow-growth");
    if (verdict.state === "grown" && !allowGrowth) {
      console.error(`context-audit: refusing to bless growth. ${verdict.message}`);
      return 1;
    }
    const reason = allowGrowth ? argv[argv.indexOf("--allow-growth") + 1] ?? "" : "";
    if (allowGrowth && !reason) {
      console.error('context-audit: --allow-growth needs a reason, e.g. --allow-growth "new companion boundary rule"');
      return 1;
    }
    writeFileSync(
      baselinePath(repo),
      `${JSON.stringify(
        {
          file: name,
          _comment:
            "High-water mark for the agent context file, in non-empty lines. A ratchet: the context file may shrink freely and may not grow without a recorded reason. Read by scripts/context-audit.mjs and by the pre:edit:config-protection hook.",
          lines: current.total.lines,
          chars: current.total.chars,
          managed_lines: current.managed.lines,
          recorded: new Date().toISOString().slice(0, 10),
          ...(reason ? { growth_reason: reason } : {}),
        },
        null,
        2,
      )}\n`,
    );
    console.log(`context-audit: baseline recorded at ${current.total.lines} non-empty lines${reason ? ` (growth allowed: ${reason})` : ""}`);
    return 0;
  }

  const constitutionFile = join(repo, ".specify", "memory", "constitution.md");
  const findings = audit(text, {
    repo,
    constitution: existsSync(constitutionFile) ? readFileSync(constitutionFile, "utf8") : "",
  });

  console.log(
    `context-audit: ${name} — ${current.total.lines} non-empty lines (${current.total.chars} chars), managed block ${current.managed.lines}`,
  );
  console.log(`  ${verdict.message}`);
  console.log(`  ${findings.length} line(s) worth re-reading:`);
  for (const f of findings) console.log(`    ${name}:${f.line} [${f.rule}] ${f.message}`);
  if (findings.length === 0) console.log("    ✓ every line still looks like it changes behaviour");

  // Findings never fail the check. They are proposals about lines a human has
  // to judge; only the size ratchet is mechanical enough to gate on.
  return argv.includes("--check") && verdict.state === "grown" ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const code = main(argv, repo);

  // Appended after the mechanical report, and deliberately outside `main`:
  // `main` stays synchronous so every existing spec keeps calling it the way
  // it does, and the lane can never reach the exit code.
  if (argv.includes("--jev") && !argv.includes("--bless")) {
    const file = contextFile(repo);
    if (file) {
      const { findings, unavailable, note } = await jevAudit(readFileSync(file, "utf8"), { repo });
      const name = contextFileName(repo);
      if (unavailable) console.log(note);
      else if (findings.length === 0) console.log("    ✓ jev: every block still looks like it changes behaviour");
      else {
        console.log(`  ${findings.length} block(s) the inclusion test says are inert:`);
        for (const f of findings) console.log(`    ${name}:${f.line} [${f.rule}] ${f.message}`);
      }
    }
  }
  process.exit(code);
}
