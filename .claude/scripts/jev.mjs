#!/usr/bin/env node
// The judgements with no script of their own.
//
// Most of the Jev lane lives inside the script that already owns the data —
// artifact-lint owns the spec, gc-scan owns the candidates, context-audit
// owns the context file. Three judgements have no such home: they belong to
// skills and subagents, which are prose and cannot compute anything. This is
// where those live, so a skill can call one line instead of describing an
// algorithm and hoping the model follows it.
//
//   node .claude/scripts/jev.mjs check
//       Is the lane reachable, and how fast. Run it before trusting a run
//       that came back with nothing to say.
//
//   node .claude/scripts/jev.mjs triage <findings.json>
//       Route each verified review finding to patch (a small or medium fix,
//       made in this PR) / defer (a large fix only, AGENTS.md's size test) /
//       decision-needed, and rank it by severity. The route already exists in code-reviewer and
//       spec-reviewer as prose; this makes it a typed answer with a confidence,
//       so a finding the model is unsure about goes to the human by rule rather
//       than by disposition. Feeds specs/<feature>/deferred.md.
//
//   node .claude/scripts/jev.mjs rank <items.json> --about "<what matters>"
//       Order candidate items by impact. Two callers: /speckit-clarify, which
//       must pick the five questions that matter most out of spec-challenger's
//       list, and /design-audit, which ranks its findings. Both used to order
//       by the sequence the generator happened to emit.
//
//   node .claude/scripts/jev.mjs commit-msg [--staged|--amend]
//       Does the subject line describe the diff it ships? commit-msg-policy.js
//       already enforces shape — type, scope, length, no trailers. Nothing
//       checks whether `fix(scanner): tidy` is telling the truth about four
//       hundred changed lines. Advisory: this never blocks a commit.
//
// The input files are JSON arrays of `{ id?, title, detail? }`. Everything
// prints a table and, with --json, the machine form a skill should read.
//
// Exit code is 0 unless the invocation itself was wrong. No judgement here
// decides an exit code — see the contract at the top of lib/jev.mjs.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { ask, choice, choiceOf, noul, noulOf, qid, score, scoreOf, jevEnabled, unavailableNote } from "./lib/jev.mjs";

const repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
};
/** Flags that consume the next argument, so it is not mistaken for the file. */
const VALUE_FLAGS = new Set(["--about", "--subject"]);
const positional = argv.filter((a, i) => !a.startsWith("--") && !VALUE_FLAGS.has(argv[i - 1]));

const die = (message) => {
  console.error(`jev: ${message}`);
  process.exit(2);
};

/** Items come from a subagent's output file, so a bad shape is a real case. */
function readItems(path) {
  if (!path) die("needs a JSON file of items — see the usage at the top of this file");
  if (!existsSync(path)) die(`${path} does not exist`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    return die(`${path} is not valid JSON (${cause.message})`);
  }
  const items = Array.isArray(parsed) ? parsed : (parsed.findings ?? parsed.items ?? parsed.questions);
  if (!Array.isArray(items)) die(`${path} must hold an array, or an object with findings/items/questions`);
  if (items.length === 0) die(`${path} holds no items`);
  return items.map((item, i) => (typeof item === "string" ? { id: String(i), title: item } : { id: String(i), ...item }));
}

const emit = (rows, render) => {
  if (flag("json")) console.log(JSON.stringify(rows, null, 2));
  else for (const row of rows) console.log(render(row));
};

const bail = (reason) => {
  console.log(unavailableNote(reason));
  process.exit(0);
};

const command = argv[0];

if (command === "check") {
  if (!jevEnabled(repo)) bail("no key, or SPECKIT_JEV=0");
  const started = Date.now();
  // A probe with a known answer, so the line distinguishes "reachable" from
  // "reachable and answering sensibly".
  const { answers, unavailable, reason, usage } = await ask(
    { language: "TypeScript", file: "apps/scanner/src/cli.ts" },
    { probe: noul("Is this state describing a TypeScript file?") },
    { repo, timeoutMs: 10_000 },
  );
  if (unavailable) bail(reason);
  const probe = noulOf(answers.probe) ?? 0;
  console.log(
    `jev: reachable in ${Date.now() - started}ms — probe ${probe.toFixed(2)} (expected > 0.5)${probe <= 0.5 ? " ← answering, but not sensibly" : ""}, ${usage?.input_tokens ?? 0} input tokens`,
  );
  process.exit(0);
}

if (command === "triage") {
  const items = readItems(positional[1]);
  const questions = {};
  items.forEach((item, i) => {
    questions[qid("route", i)] = choice(`How should finding ${i} be handled?`, {
      patch: "a small or medium fix, made in this PR whether or not this change caused it (pre-existing or adjacent included)",
      defer: "a large fix. A fix is large when it needs its own design or decision, a data migration, a different area or epic, or work clearly bigger than the story itself. Record it with its path:line",
      "decision-needed": "fixing it requires a judgement about intent that only the author can make",
    });
    questions[qid("sev", i)] = score(`How severe is finding ${i}?`, ["cosmetic", "low", "medium", "high", "critical"]);
  });

  const state = {
    context: "Verified findings from a code or spec review of one feature's diff, in a TypeScript monorepo.",
    findings: Object.fromEntries(items.map((item, i) => [String(i), item])),
  };
  const { answers, unavailable, reason } = await ask(state, questions, { repo });
  if (unavailable) bail(reason);

  const rows = items
    .map((item, i) => {
      const route = choiceOf(answers[qid("route", i)]);
      const severity = scoreOf(answers[qid("sev", i)]);
      // Low confidence is itself the answer: a route the model is unsure of
      // is exactly the finding a human should see, so it becomes one.
      const decided = route && route.confidence >= 0.6 ? route.choice : "decision-needed";
      return { ...item, route: decided, routeConfidence: route?.confidence ?? 0, severity: severity?.score ?? null, severityLabel: severity?.label ?? null };
    })
    .sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0));

  emit(rows, (r) => `[${r.route}] ${r.severityLabel ?? "?"} (${(r.severity ?? 0).toFixed(1)}) — ${r.title}${r.routeConfidence < 0.6 ? " (low confidence — routed to you)" : ""}`);
  process.exit(0);
}

if (command === "rank") {
  const items = readItems(positional[1]);
  const about = value("about", "the quality of this artifact");
  const questions = {};
  items.forEach((item, i) => {
    questions[qid("impact", i)] = score(
      `How much would resolving item ${i} improve ${about}?`,
      ["not worth doing", "minor", "worth doing", "the most valuable thing here"],
    );
  });

  const state = { about, items: Object.fromEntries(items.map((item, i) => [String(i), item])) };
  const { answers, unavailable, reason } = await ask(state, questions, { repo });
  if (unavailable) bail(reason);

  const rows = items
    .map((item, i) => ({ ...item, impact: scoreOf(answers[qid("impact", i)])?.score ?? 0 }))
    .sort((a, b) => b.impact - a.impact);

  emit(rows, (r) => `${r.impact.toFixed(2)}  ${r.title}`);
  process.exit(0);
}

if (command === "commit-msg") {
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  const subject = flag("amend") ? git("log", "-1", "--pretty=%s").trim() : value("subject", git("log", "-1", "--pretty=%s").trim());
  // --stat, not the patch: the question is whether the subject describes the
  // shape of the change, and a full diff would bury that in content.
  const stat = flag("staged") ? git("diff", "--cached", "--stat") : git("show", "--stat", "--pretty=", "HEAD");
  if (!stat.trim()) bail("no diff to judge");

  const { answers, unavailable, reason } = await ask(
    { subject, diffstat: stat },
    {
      describes: noul(
        "Does the commit subject describe what this diff actually changes?",
        "a reader scanning the log would correctly predict the files and the nature of the change",
        "it is vaguer than the diff, names the wrong area, or understates the size of the change",
      ),
      scoped: noul(
        "Does the subject's scope match the part of the repository the diff touches?",
        "the scope in parentheses names where the change is",
        "the scope names a different area, or the diff spans areas the scope does not cover",
      ),
    },
    { repo },
  );
  if (unavailable) bail(reason);

  const describes = noulOf(answers.describes) ?? 1;
  const scoped = noulOf(answers.scoped) ?? 1;
  console.log(`jev commit-msg: "${subject}"`);
  console.log(`  describes the diff: ${describes.toFixed(2)}${describes <= 0.4 ? "  ← the subject is vaguer than the change" : ""}`);
  console.log(`  scope matches:      ${scoped.toFixed(2)}${scoped <= 0.4 ? "  ← the scope names the wrong area" : ""}`);
  console.log("  advisory only — commit-msg-policy.js owns what blocks a commit");
  process.exit(0);
}

die(`unknown command "${command ?? ""}" — one of: check, triage, rank, commit-msg`);
