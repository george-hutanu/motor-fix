#!/usr/bin/env node
// Which Notion status a lifecycle event writes, decided here so the rules are
// tested rather than re-read from prose on every run. `speckit-notion-sync`
// asks this script, then makes the Notion writes it names.
//
// The story ladder is To do → In progress → In review → QA → Done; the build
// timeline row mirrors it (Not started … Merged). Blocked sits off the ladder:
// `blocked` records the status it left in run-state, and only `unblock` leaves
// Blocked, returning to that status — the one backwards move. Nothing moves a
// Done story.
//
//   node .claude/scripts/notion-status.mjs <event> --current "<story Status>"
//   events: start | review | qa | finish | blocked | unblock
// Prints { write, story, timeline, prior, note } as JSON.
import { readState, writeState } from "./run-state.mjs";

export const LADDER = ["To do", "In progress", "In review", "QA", "Done"];
const TIMELINE = { "To do": "Not started", "In progress": "In progress", "In review": "In review", QA: "QA", Done: "Merged", Blocked: "Blocked" };
const TARGET = { start: "In progress", review: "In review", qa: "QA", finish: "Done" };

const result = (write, story, prior, note) => ({ write, story, timeline: TIMELINE[story] ?? null, prior, note });

export function decide({ event, current, prior = null }) {
  if (!(event in TARGET) && event !== "blocked" && event !== "unblock") throw new Error(`unknown event "${event}"`);
  if (current === "Done") return result(false, current, prior, "Done never moves");

  if (event === "blocked") {
    if (current === "Blocked") return result(false, current, prior, "already Blocked; first record kept");
    return result(true, "Blocked", current, `${current} → Blocked`);
  }
  if (event === "unblock") {
    if (current !== "Blocked") return result(false, current, prior, `not Blocked (${current}); unchanged`);
    const back = prior ?? "In progress";
    return result(true, back, null, `Blocked → ${back}`);
  }
  if (current === "Blocked") return result(false, current, prior, `Blocked; only unblock leaves it (recorded: ${prior ?? "none"})`);

  const target = TARGET[event];
  const from = LADDER.indexOf(current);
  const to = LADDER.indexOf(target);
  if (to === from) return result(false, current, prior, `${current} unchanged`);
  if (from !== -1 && to < from) return result(false, current, prior, `${current} → ${target} would move backwards; unchanged`);
  return result(true, target, prior, `${current} → ${target}`);
}

export function main(argv, repo) {
  const i = argv.indexOf("--current");
  const current = i === -1 ? undefined : argv[i + 1];
  const event = argv.find((a, j) => !a.startsWith("--") && (i === -1 || j !== i + 1));
  if (!event || !current) {
    console.error('usage: notion-status.mjs <start|review|qa|finish|blocked|unblock> --current "<story Status>"');
    return 1;
  }
  const state = readState(repo);
  let decision;
  try {
    decision = decide({ event, current, prior: state.notion_prior_status ?? null });
  } catch (error) {
    console.error(`notion-status: ${error.message}`);
    return 1;
  }
  if (decision.write && (event === "blocked" || event === "unblock")) writeState(repo, { ...state, notion_prior_status: decision.prior });
  console.log(JSON.stringify(decision));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2), process.env.CLAUDE_PROJECT_DIR ?? process.cwd()));
}
