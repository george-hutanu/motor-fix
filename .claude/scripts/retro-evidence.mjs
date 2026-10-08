#!/usr/bin/env node
// Evidence for a feature retrospective, gathered mechanically so the judgement
// is made over facts rather than recollection. Borrowed from BMAD's
// `bmad-retrospective`, which "analyzes epic completion by examining concrete
// artifacts: the specs, story records, full diff, commits, and tracking files"
// and requires that "every finding carries a source reference: a file, a line,
// a commit, a log."
//
// The gap this closes: `/speckit-harden` judges code mid-flight and
// `/speckit-learn` mines a SESSION for instincts, but nothing ever read a
// finished feature as a whole and said whether it was accepted. Feature 007
// reached seventy-three done tasks and no artifact in the repository recorded a
// verdict on it.
//
// This script decides nothing. It prints what happened; `/speckit-retro` reads
// it and judges.
//
// Usage:
//   node .claude/scripts/retro-evidence.mjs [specs/NNN-slug] [--json] [--since <ref>] [--jev]
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, join } from "node:path";
import { activeFeature, featureLevel, LEVELS } from "./lib/feature.mjs";
import { loadCapabilities, parseDelta, retiredTokens } from "./capabilities.mjs";

const git = (repo, args) => {
  try {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};

/**
 * Commits that belong to this feature, oldest first.
 *
 * By path when `specs/` is tracked. It is not tracked here, so the path
 * filter matches nothing and `--since <ref>` names the range instead — the
 * fallback this script's own output tells you to use. It was accepted and
 * then dropped: `featureCommits` never took the argument `gather` passed it,
 * so every run reported zero commits however it was invoked.
 */
export function featureCommits(repo, featureDir, { since } = {}) {
  const rel = featureDir.startsWith(repo) ? featureDir.slice(repo.length + 1) : featureDir;
  // A delimiter rather than spaces: a commit subject contains spaces, and
  // splitting on them would truncate every subject at its first word.
  const args = ["log", "--reverse", "--format=%h|%ad|%s", "--date=short"];
  const raw = git(repo, since ? [...args, `${since}..HEAD`] : [...args, "--", rel]);
  if (!raw) return [];
  return raw.split("\n").filter(Boolean).map((line) => {
    const [hash, date, ...rest] = line.split("|");
    return { hash, date, subject: rest.join("|") };
  });
}

/** Whether git tracks the feature's directory at all. */
export function specsTracked(repo, featureDir) {
  const rel = featureDir.startsWith(repo) ? featureDir.slice(repo.length + 1) : featureDir;
  return git(repo, ["ls-files", "--", rel]) !== "";
}

/** Insertions/deletions/files across the range the feature spans. */
export function diffStat(repo, from) {
  if (!from) return null;
  const parent = git(repo, ["rev-parse", "--verify", "--quiet", `${from}^`]);
  const range = `${parent || from}..HEAD`;
  const shortstat = git(repo, ["diff", "--shortstat", range]);
  const files = git(repo, ["diff", "--name-only", range]).split("\n").filter(Boolean);
  return {
    range,
    files: files.length,
    insertions: Number(shortstat.match(/(\d+) insertion/)?.[1] ?? 0),
    deletions: Number(shortstat.match(/(\d+) deletion/)?.[1] ?? 0),
    paths: files,
  };
}

/**
 * Findings a reviewer deliberately did not act on. Borrowed from BMAD's review
 * triage, which routes each verified finding to patch, defer or
 * decision-needed. Here defer holds only a large fix (AGENTS.md, "Technical
 * debt a review defers"); a small or medium one is made in the PR.
 */
export function parseDeferred(text) {
  const items = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*-\s+\[([ Xx])\]\s+(.*)$/);
    if (!m) continue;
    const body = m[2];
    items.push({
      open: m[1] === " ",
      severity: body.match(/\*\*(critical|high|medium|low)\*\*/i)?.[1].toLowerCase() ?? "unspecified",
      source: body.match(/`([^`]+:\d+)`/)?.[1] ?? null,
      text: body,
    });
  }
  return items;
}

/** Open action items carried out of an earlier feature's retrospective. */
export function carryover(repo, featureName) {
  const specsDir = join(repo, "specs");
  const out = [];
  for (const dir of existsSync(specsDir) ? readdirSync(specsDir).sort() : []) {
    if (dir >= featureName) continue;
    const file = join(specsDir, dir, "retrospective.md");
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const line of text.split("\n")) {
      if (/^\s*-\s+\[ \]/.test(line)) out.push({ feature: dir, item: line.replace(/^\s*-\s+\[ \]\s*/, "").trim() });
    }
  }
  return out;
}

export function gather(repo, feature, { since } = {}) {
  const read = (name) => {
    const p = join(feature.dir, name);
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  };
  const spec = read("spec.md");
  const tasks = read("tasks.md");
  const deferredText = read("deferred.md");

  const taskLines = (tasks ?? "").split("\n");
  const open = taskLines.filter((l) => /^\s*- \[ \]/.test(l));
  const done = taskLines.filter((l) => /^\s*- \[[Xx]\]/.test(l));

  const declared = [...new Set([...(spec ?? "").matchAll(/^\s*-\s+\*{0,2}(FR-\d{3})\*{0,2}\s*[:.]/gm)].map((m) => m[1]))];
  const retired = retiredTokens(repo);
  const commits = featureCommits(repo, feature.dir, { since });
  const tracked = specsTracked(repo, feature.dir);
  const delta = spec ? parseDelta(spec) : [];
  const caps = loadCapabilities(repo);

  return {
    feature: feature.name,
    level: { value: feature.level ?? featureLevel(repo, feature.dir), name: LEVELS[feature.level ?? featureLevel(repo, feature.dir)].name },
    artifacts: ["spec.md", "plan.md", "tasks.md", "research.md", "data-model.md", "quickstart.md", "retrospective.md", "deferred.md"]
      .filter((name) => existsSync(join(feature.dir, name))),
    tasks: { open: open.length, done: done.length, openTitles: open.map((l) => l.trim()).slice(0, 20) },
    requirements: {
      declared: declared.length,
      retired: declared.filter((fr) => retired.has(`${feature.num}-${fr}`)).length,
    },
    delta: delta.map((section) => ({
      capability: section.capability,
      known: caps.has(section.capability),
      adds: section.adds.length,
      modifies: section.modifies.length,
      removes: section.removes.length,
    })),
    commits,
    historyDerivable: commits.length > 0 || tracked,
    diff: diffStat(repo, commits[0]?.hash),
    deferred: deferredText ? parseDeferred(deferredText) : [],
    carryover: carryover(repo, feature.name),
  };
}

export function render(e) {
  const lines = [];
  lines.push(`Retrospective evidence — ${e.feature} (level ${e.level.value}, ${e.level.name})`);
  lines.push("");
  lines.push(`Artifacts     ${e.artifacts.join(", ") || "none"}`);
  lines.push(`Tasks         ${e.tasks.done} done, ${e.tasks.open} open`);
  lines.push(`Requirements  ${e.requirements.declared} declared, ${e.requirements.retired} retired`);
  lines.push(
    e.historyDerivable
      ? `Commits       ${e.commits.length}${e.commits.length ? ` (${e.commits[0].date} → ${e.commits.at(-1).date})` : ""}`
      : "Commits       not derivable — specs/ is not tracked in this repository; pass --since <ref>",
  );
  if (e.diff) lines.push(`Diff          ${e.diff.files} files, +${e.diff.insertions} −${e.diff.deletions} over ${e.diff.range}`);
  lines.push("");
  if (e.delta.length) {
    lines.push("Spec Delta");
    for (const d of e.delta)
      lines.push(`  ${d.capability}${d.known ? "" : " (UNKNOWN CAPABILITY)"}: +${d.adds} ~${d.modifies} -${d.removes}`);
    lines.push("");
  } else {
    lines.push("Spec Delta    none declared — nothing would merge into a capability on archive");
    lines.push("");
  }
  if (e.tasks.openTitles.length) {
    lines.push("Open tasks");
    for (const t of e.tasks.openTitles) lines.push(`  ${t}`);
    lines.push("");
  }
  const openDeferred = e.deferred.filter((d) => d.open);
  lines.push(`Deferred      ${openDeferred.length} open of ${e.deferred.length}`);
  for (const d of openDeferred) lines.push(`  [${d.severity}] ${d.source ?? "no source"} — ${d.text.slice(0, 120)}`);
  lines.push("");
  lines.push(`Carryover     ${e.carryover.length} open item(s) from earlier retrospectives`);
  for (const c of e.carryover) lines.push(`  ${c.feature}: ${c.item.slice(0, 120)}`);
  lines.push("");
  lines.push("Commits");
  for (const c of e.commits) lines.push(`  ${c.hash} ${c.date} ${c.subject}`);
  return lines.join("\n");
}

/**
 * A starting position for the retrospective's verdict, read off the evidence.
 *
 * /speckit-retro's three outcomes are a judgement, and this does not replace
 * making it — it stops the judgement being made from a blank page after
 * reading forty commits, which is where "accepted" wins by fatigue. The open
 * deferred findings are the part most often forgotten, so the second question
 * asks about them directly.
 *
 * Suggests only: nothing here writes a retro, and low confidence is reported
 * rather than rounded away.
 */
export async function suggestVerdict(evidence, { repo, fetchImpl } = {}) {
  const { ask, choice, choiceOf, noul, noulOf, unavailableNote } = await import("./lib/jev.mjs");
  const { answers, unavailable, reason } = await ask(
    {
      feature: evidence.feature,
      requirements: evidence.requirements ?? null,
      tasks: evidence.tasks ?? null,
      diff: evidence.diff ?? null,
      deferred: evidence.deferred ?? null,
      carryover: evidence.carryover ?? null,
      commits: (evidence.commits ?? []).map((c) => c.subject),
    },
    {
      verdict: choice("What is the honest verdict on this finished feature?", {
        accepted: "it did what it set out to do and left nothing open that matters",
        "accepted-with-open-items": "it shipped, but real findings were deferred and someone must carry them",
        rejected: "the work does not match what was specified, or it left the repository worse",
      }),
      deferred_matter: noul(
        "Do the open deferred findings need to be carried into the next feature?",
        "at least one is a real defect or a decision nobody has made",
        "they are cosmetic, or already resolved by later commits",
      ),
    },
    { repo, fetchImpl },
  );
  if (unavailable) return { unavailable: true, note: unavailableNote(reason) };
  const verdict = choiceOf(answers.verdict);
  return {
    unavailable: false,
    verdict: verdict?.choice ?? null,
    confidence: verdict?.confidence ?? 0,
    deferredMatter: noulOf(answers.deferred_matter),
  };
}

/** `out` receives the gathered evidence so the CLI can add the --jev lane
 *  without changing what `main` returns to every existing caller. */
export function main(argv, repo, out = {}) {
  // `--since` takes a value, so the ref must not be mistaken for the feature
  // directory — which is what made `--since` unusable: it resolved as
  // `specs/HEAD~5` and the run died on "no feature to read".
  const named = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--since");
  const feature = named
    ? { dir: join(repo, named), name: basename(named), num: basename(named).match(/^(\d{3})-/)?.[1] ?? "000", level: featureLevel(repo, join(repo, named)) }
    : activeFeature(repo);

  if (!feature || !existsSync(join(feature.dir, "spec.md"))) {
    console.error("retro-evidence: no feature to read (pass specs/NNN-slug, or set .specify/feature.json)");
    return 1;
  }
  const sinceIdx = argv.indexOf("--since");
  const evidence = gather(repo, feature, { since: sinceIdx === -1 ? undefined : argv[sinceIdx + 1] });
  out.evidence = evidence;
  console.log(argv.includes("--json") ? JSON.stringify(evidence, null, 2) : render(evidence));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const out = {};
  const code = main(argv, repo, out);
  if (code !== 0 || !out.evidence) process.exit(code);

  // Appended after the evidence, never inside it: the report is facts with a
  // source for each one, and a suggestion is not a fact.
  if (argv.includes("--jev")) {
    const suggested = await suggestVerdict(out.evidence, { repo });
    if (suggested.unavailable) console.log(`\n${suggested.note.trim()}`);
    else {
      console.log("\nSuggested verdict (a starting position, not the retro)");
      console.log(`  ${suggested.verdict} at ${suggested.confidence.toFixed(2)} confidence${suggested.confidence < 0.6 ? " — too close to call from the evidence alone" : ""}`);
      if (suggested.deferredMatter !== undefined)
        console.log(`  open deferred findings need carrying: ${suggested.deferredMatter.toFixed(2)}`);
    }
  }
  process.exit(code);
}
