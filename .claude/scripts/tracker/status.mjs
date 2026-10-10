#!/usr/bin/env node
// Which status a lifecycle event writes to the story's tracker issue, decided
// here so the rules are tested rather than re-read from prose on every run.
// `tracker-sync.mjs` asks it, then makes the writes it names.
//
// The story ladder is To do → Planning → Implementing → QA → Done:
// Planning from the task's start until /speckit-implement, Implementing from
// there, QA from the moment the PR is marked ready. There is no In review
// stage (folded into QA by the owner, 2026-10-04): `review` is kept as an
// alias of `qa` so a running agent that still sends it lands on QA. A legacy
// In progress reads as Implementing and a legacy In review as QA. Blocked sits
// off the ladder: `blocked` records the status it left in run-state, and only
// `unblock` leaves Blocked, returning to that status — the one backwards move.
// Nothing moves a Done story.
//
// The PR mirrors the story with exactly one stage label: `stage` names it
// (a Blocked story keeps the one it left, with `blocked` beside it; To do and
// Done carry none) and `labels` is the `gh pr edit` arguments that leave the PR
// with exactly that, whatever it carried before. They come with every
// decision, written or not, so a late, repeated or catch-up event converges
// instead of stacking a second stage label.
//
//   node .claude/scripts/tracker/status.mjs <event> --current "<story Status>"
//   events: start | implement | review | qa | finish | blocked | unblock
// Prints { write, story, prior, note, stage, labels } as JSON.
import { readState, writeState } from "../run-state.mjs";

export const LADDER = ["To do", "Planning", "Implementing", "QA", "Done"];
const TARGET = { start: "Planning", implement: "Implementing", review: "QA", qa: "QA", finish: "Done" };
const STAGE = { Planning: "planning", Implementing: "in development", QA: "QA" };

function stageLabels(story, prior) {
  const blocked = story === "Blocked";
  const stage = STAGE[blocked ? prior : story] ?? null;
  // Blocked with no known stage: the stage labels it has are the best guess left.
  if (blocked && !stage) return { stage, labels: '--add-label "blocked"' };
  const add = blocked ? [stage, "blocked"] : [stage].filter(Boolean);
  const remove = [...Object.values(STAGE), "blocked"].filter((label) => !add.includes(label));
  return { stage, labels: [...add.map((l) => `--add-label "${l}"`), ...remove.map((l) => `--remove-label "${l}"`)].join(" ") };
}

const result = (write, story, prior, note) => ({ write, story, prior, note, ...stageLabels(story, prior) });

const RETIRED = { "In progress": "Implementing", "In review": "QA" };
const LEGACY = (status) => (Object.hasOwn(RETIRED, status) ? RETIRED[status] : status);

export function decide({ event, current: raw, prior: rawPrior = null }) {
  const current = LEGACY(raw);
  const prior = rawPrior && LEGACY(rawPrior);
  if (!Object.hasOwn(TARGET, event) && event !== "blocked" && event !== "unblock") throw new Error(`unknown event "${event}"`);
  if (current === "Done") return result(false, current, prior, "Done never moves");

  if (event === "blocked") {
    if (current === "Blocked") return result(false, current, prior, "already Blocked; first record kept");
    return result(true, "Blocked", current, `${current} → Blocked`);
  }
  if (event === "unblock") {
    if (current !== "Blocked") return result(false, current, prior, `not Blocked (${current}); unchanged`);
    const back = prior ?? "Implementing";
    return result(true, back, null, `Blocked → ${back}`);
  }
  if (current === "Blocked") return result(false, current, prior, `Blocked; only unblock leaves it (recorded: ${prior ?? "none"})`);

  const target = TARGET[event];
  const from = LADDER.indexOf(current);
  const to = LADDER.indexOf(target);
  if (to === from && raw === current) return result(false, current, prior, `${current} unchanged`);
  if (from !== -1 && to < from) return result(false, current, prior, `${current} → ${target} would move backwards; unchanged`);
  return result(true, target, prior, `${raw} → ${target}`);
}

/** After the writes land: `blocked` records the status it left, for `unblock` to read back. */
export function recordPrior(repo, event, decision) {
  if (decision.write && (event === "blocked" || event === "unblock")) writeState(repo, { ...readState(repo), prior_status: decision.prior });
}

export function main(argv, repo) {
  const i = argv.indexOf("--current");
  const current = i === -1 ? undefined : argv[i + 1];
  const event = argv.find((a, j) => !a.startsWith("--") && (i === -1 || j !== i + 1));
  if (!event || !current) {
    console.error('usage: tracker/status.mjs <start|implement|review|qa|finish|blocked|unblock> --current "<story Status>"');
    return 1;
  }
  let decision;
  try {
    decision = decide({ event, current, prior: readState(repo).prior_status ?? null });
  } catch (error) {
    console.error(`tracker/status: ${error.message}`);
    return 1;
  }
  recordPrior(repo, event, decision);
  console.log(JSON.stringify(decision));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2), process.env.CLAUDE_PROJECT_DIR ?? process.cwd()));
}
