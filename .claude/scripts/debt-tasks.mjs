#!/usr/bin/env node
// Technical debt a review defers becomes a task in Notion. Every bullet in
// specs/<feature>/deferred.md — routed there by spec-reviewer, code-reviewer
// or the PR tester — is one "To do" row in MotorFix stories, linked to the
// story and epic it came from: Issue type "Tech debt", or "Decision" when the
// finding waits on the owner, so each has its own board in Notion.
//
// This script decides; `speckit-notion-sync debt` makes the Notion writes:
//
//   node .claude/scripts/debt-tasks.mjs plan <deferred.md> --story <url> [--epic <url>] --pr <url> --id ST-<n> [--feature <url>]
//     prints the pending entries as [{ line, properties, content }]; a story
//     with no epic omits --epic and its tasks carry no Epic relation
//   node .claude/scripts/debt-tasks.mjs mark <deferred.md> --line <n> --url <notion url>
//     writes the task's URL onto that bullet, so no later run files it again
//
// A bullet already carrying "— Notion: <url>", or ticked `[x]`, is not pending.
import { readFileSync, writeFileSync } from "node:fs";

const SEVERITIES = ["blocker", "high", "medium", "low"];
const PRIORITY = { blocker: "Highest", high: "High", medium: "Medium", low: "Low" };
const NOTION = /\s+—\s+Notion:\s+(\S+)\s*$/;

export function parseDeferred(markdown) {
  const lines = markdown.split("\n");
  const entries = [];
  lines.forEach((text, line) => {
    if (/^- /.test(text)) entries.push({ line, text });
    else if (entries.length && /^\s+\S/.test(text)) entries.at(-1).text += ` ${text.trim()}`;
  });
  return entries.map(({ line, text }) => {
    const done = /^- \[[xX]\]/.test(text);
    const notion = lines[line].match(NOTION)?.[1] ?? null;
    const sev = text.match(/\*\*(blocker|high|medium|low)\*\*/i)?.[1] ?? text.match(/^- (?:\[[ xX]\] )?(BLOCKER|HIGH|MEDIUM|LOW)\b/i)?.[1] ?? "low";
    const severity = SEVERITIES.includes(sev.toLowerCase()) ? sev.toLowerCase() : "low";
    const where = text.match(/`([^`]+)`/)?.[1] ?? "";
    const decision = /\bdecisions?\b|open questions?\b/i.test(text.replace(/`[^`]*`/g, ""));
    const reviewer = text.match(/\b(spec-reviewer|code-reviewer|pr-tester|test-adversary)\b/)?.[1] ?? "review";
    const title = text
      .replace(NOTION, "")
      .replace(/^- (\[[ xX]\] )?/, "")
      .replace(/^(BLOCKER|HIGH|MEDIUM|LOW)\b[^:]*:\s*/i, "")
      .replace(/\s+—\s+\*\*\w+\*\*\s+—\s+/, " — ")
      .replace(/\s*\([^()]*(reviewer|pr-tester|adversary)[^()]*\)\.?\s*$/, "")
      .trim();
    return { line, text, title, severity, where, reviewer, decision, notion, done, pending: !done && !notion };
  });
}

const shorten = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** The MotorFix stories row for one deferred finding. */
export function taskFor(entry, { story, epic, feature, pr, storyId }) {
  const summary = entry.title.replace(/`|\*\*/g, "").replace(/^\S+\s+—\s+/, "");
  const kind = entry.decision ? "Decision" : "Tech debt";
  const properties = {
    Story: shorten(`${kind} (${storyId}): ${summary}`, 120),
    "Issue type": kind,
    Role: "System",
    Status: "To do",
    Priority: PRIORITY[entry.severity],
    "User story": shorten(
      entry.decision
        ? `So that the build can go on, decide what ${entry.reviewer} left open in ${storyId}: ${summary}`
        : `So that the code stays sound, fix what ${entry.reviewer} deferred in ${storyId}: ${summary}`,
      400,
    ),
    // A story with no epic gets no Epic relation: `[null]` makes Notion answer 400.
    ...(epic ? { Epic: JSON.stringify([epic]) } : {}),
    ...(feature ? { Feature: JSON.stringify([feature]) } : {}),
  };
  const content = [
    entry.decision ? "## Decision to take" : "## Technical debt",
    `- **Severity:** ${entry.severity}`,
    `- **Where:** \`${entry.where || "see the finding"}\``,
    `- **Found by:** ${entry.reviewer}`,
    `- **Pull request:** ${pr}`,
    `- **From story:** ${story} (${storyId})`,
    "",
    "## Finding",
    entry.text.replace(NOTION, "").replace(/^- (\[[ xX]\] )?/, ""),
  ].join("\n");
  return { line: entry.line, properties, content };
}

export function markFiled(markdown, line, url) {
  const lines = markdown.split("\n");
  if (!/^- /.test(lines[line] ?? "")) throw new Error(`line ${line} is not a bullet of deferred.md`);
  if (NOTION.test(lines[line])) return markdown;
  lines[line] = `${lines[line]} — Notion: ${url}`;
  return lines.join("\n");
}

const flag = (argv, name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};

export function main(argv) {
  const [command, file] = argv;
  if (command === "plan" && file) {
    const ctx = { story: flag(argv, "story"), epic: flag(argv, "epic"), feature: flag(argv, "feature"), pr: flag(argv, "pr"), storyId: flag(argv, "id") };
    if (!ctx.story || !ctx.pr || !ctx.storyId) {
      console.error("debt-tasks: plan needs --story, --pr and --id (--epic when the story has one)");
      return 64;
    }
    const plan = parseDeferred(readFileSync(file, "utf8")).filter((e) => e.pending).map((e) => taskFor(e, ctx));
    console.log(JSON.stringify(plan));
    return 0;
  }
  if (command === "mark" && file && flag(argv, "line") && flag(argv, "url")) {
    writeFileSync(file, markFiled(readFileSync(file, "utf8"), Number(flag(argv, "line")), flag(argv, "url")));
    return 0;
  }
  console.error("usage: debt-tasks.mjs plan <deferred.md> --story <url> [--epic <url>] --pr <url> --id ST-<n> [--feature <url>] | mark <deferred.md> --line <n> --url <url>");
  return 64;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
