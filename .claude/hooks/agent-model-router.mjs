// Claude Code PreToolUse hook on the Agent tool. Picks the model a reviewer
// subagent runs on, from the size of the diff it is about to read.
//
// Every other agent in .claude/agents is pinned in its own frontmatter, which
// is the right place for a fixed answer: mutation-runner formats a Stryker
// table and will never need more than haiku, org-researcher summarises four
// search lanes and will never need less than sonnet. Two agents have no fixed
// answer. code-reviewer and spec-reviewer read whatever the feature produced,
// and a three-line fix and a nine-hundred-line rewrite are not the same job.
// Frontmatter cannot tell them apart; this can, because by the time the Agent
// call is made the diff range is already in the prompt.
//
// Three properties, in the order they matter:
//
//   1. THE EXTREMES ARE MECHANICAL. A tiny diff takes sonnet and a huge one
//      takes fable without asking anything, so the common cases cost no
//      latency and answer the same way twice. Jev is asked only in the middle
//      band, which is the only place a judgement is actually being made. This
//      is also what keeps the hook honest about the lane's contract: the
//      network call is per-subagent, never per-edit.
//   2. IT NEVER REFUSES. No permissionDecision, no exit 2. The hook either
//      rewrites `model` in the tool input or does nothing at all, and every
//      rewrite is announced in systemMessage. A routing decision that nobody
//      can see in the transcript is a routing decision nobody can debug.
//   3. IT FAILS OPEN, TWICE OVER. No key, no network, no git, an unparseable
//      payload, a low-confidence answer — each one exits 0 with no output, and
//      the subagent runs on the model it would have run on anyway. The worst
//      case is that this file did nothing.
//
// An explicit `model` in the tool input always wins: the caller naming a model
// is a decision, and this hook is a default for the case where nobody made one.
//
//   SPECKIT_MODEL_ROUTER=0   turn the routing off, leaving the frontmatter
//   SPECKIT_JEV=0            turn the middle band off (extremes still apply)
import { execFileSync } from "node:child_process";

/** Only the agents whose difficulty varies per invocation. Everything else is
 *  a fixed answer and belongs in frontmatter, not here. */
export const ROUTED = new Set(["code-reviewer", "spec-reviewer"]);

/** Below this, the review is a read of a handful of lines. */
export const SMALL = { files: 3, lines: 40 };
/** At or above this, the review is the kind that finds what nobody else did. */
export const LARGE = { files: 20, lines: 600 };

/** Under this confidence Jev is choosing between two models it cannot separate,
 *  and the default is a better answer than a coin flip. Same bar as level.mjs. */
export const MIN_CONFIDENCE = 0.6;

/** Short: this sits in front of a tool call, and a stalled phase is worse than
 *  an unrouted one. */
const TIMEOUT_MS = 3000;

/**
 * The diff range the reviewer was given, e.g. `a1b2c3d..HEAD`.
 *
 * Both reviewer agents are invoked with an explicit range — /speckit-auto
 * passes `<start-commit>..HEAD` — so this is the size of the work under
 * review, not the size of the working tree. Returns null when the prompt names
 * no range, which is the signal to leave the call alone rather than guess.
 */
export function parseRange(prompt) {
  if (typeof prompt !== "string") return null;
  // `~` and `^` are part of a revision (`HEAD~2`, `abc^`), so a class without
  // them does not fail to match — it matches the tail, `2..abc`, and hands git
  // a range that does not exist.
  const match = prompt.match(/([A-Za-z0-9._/~^-]+)\.{2,3}([A-Za-z0-9._/~^-]+)/);
  if (!match) return null;
  const range = match[0];
  // A filename with two dots in it is not a range; a revision range needs
  // something on both sides and no path separator ambiguity beyond a ref.
  if (!match[1] || !match[2]) return null;
  return range;
}

/** Which band the diff falls in: mechanical at both ends, `ask` in between. */
export function band(size) {
  if (!size) return null;
  if (size.files <= SMALL.files && size.lines <= SMALL.lines) return "small";
  if (size.files >= LARGE.files || size.lines >= LARGE.lines) return "large";
  return "ask";
}

/**
 * Files changed and lines touched in a range.
 *
 * `--shortstat` is one line and one process; parsing a full diff here would put
 * the cost of the thing being measured into the measurement. Returns null on
 * any git failure — an unknown size routes nothing.
 */
export function diffSize(repo, range) {
  try {
    const out = execFileSync("git", ["diff", "--shortstat", range], {
      cwd: repo,
      encoding: "utf8",
      timeout: TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const files = Number(out.match(/(\d+) files? changed/)?.[1] ?? 0);
    const insertions = Number(out.match(/(\d+) insertions?/)?.[1] ?? 0);
    const deletions = Number(out.match(/(\d+) deletions?/)?.[1] ?? 0);
    if (files === 0 && insertions === 0 && deletions === 0) return null;
    return { files, lines: insertions + deletions };
  } catch {
    return null;
  }
}

/**
 * The model this review should run on, and why.
 *
 * Returns `{ model, why }`, or null for "leave it alone" — which covers the
 * unavailable lane, a low-confidence answer, and an answer naming something
 * that is not one of the two options.
 */
export async function chooseModel(size, subagent, opts = {}) {
  const where = band(size);
  if (where === null) return null;
  const shape = `${size.files} files, ${size.lines} lines`;
  if (where === "small") return { model: "sonnet", why: `${shape} — below the ${SMALL.files} file / ${SMALL.lines} line floor` };
  if (where === "large") return { model: "fable", why: `${shape} — at or above the ${LARGE.files} file / ${LARGE.lines} line ceiling` };

  const { ask, choice, choiceOf } = await import("../scripts/lib/jev.mjs");
  const { answers, unavailable } = await ask(
    {
      review: subagent,
      diff: shape,
      stakes:
        "This subagent reviews a feature diff in this repository. Its CRITICAL and HIGH findings block the feature from completing, and a finding it misses ships. sonnet is cheaper and faster; fable reasons further across files and is likelier to find a defect that spans them.",
    },
    {
      model: choice("Which model should run this review?", {
        sonnet: "The diff is small or mechanical enough that a careful line-by-line read finds everything there is to find.",
        fable: "The diff is large, spans several files, or changes behaviour in ways a line-by-line read would miss.",
      }),
    },
    // `apiKey` is injected by the specs so they do not pass or fail on whether
    // this machine's .env happens to carry a credential.
    { repo: opts.repo, fetchImpl: opts.fetchImpl, apiKey: opts.apiKey, timeoutMs: TIMEOUT_MS },
  );
  if (unavailable) return null;
  const picked = choiceOf(answers.model);
  if (!picked || !["sonnet", "fable"].includes(picked.choice)) return null;
  if (picked.confidence < MIN_CONFIDENCE) return null;
  return { model: picked.choice, why: `${shape} — jev ${picked.confidence.toFixed(2)}` };
}

/** The PreToolUse response. The whole tool input is echoed back: `updatedInput`
 *  replaces the call's arguments, so a partial object would drop the prompt. */
export function response(toolInput, subagent, { model, why }) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      updatedInput: { ...toolInput, model },
      systemMessage: `model router: ${subagent} on ${model} (${why})`,
    },
  });
}

export function routerOff(env = process.env) {
  return /^(0|false|no|off)$/i.test(env.SPECKIT_MODEL_ROUTER ?? "");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", async () => {
    try {
      if (routerOff()) process.exit(0);
      const payload = JSON.parse(raw);
      // `Agent` is this build's name for the subagent tool; `Task` is what
      // other builds call the same thing.
      if (payload.tool_name !== "Agent" && payload.tool_name !== "Task") process.exit(0);

      const input = payload.tool_input ?? {};
      if (input.model) process.exit(0); // the caller chose; that is a decision
      const subagent = input.subagent_type;
      if (!ROUTED.has(subagent)) process.exit(0);

      const range = parseRange(input.prompt);
      if (!range) process.exit(0);

      const choiceMade = await chooseModel(diffSize(repo, range), subagent, { repo });
      if (!choiceMade) process.exit(0);

      console.log(response(input, subagent, choiceMade));
      process.exit(0);
    } catch {
      // Routing is a default, never a gate. Anything unexpected leaves the
      // call exactly as the caller made it.
      process.exit(0);
    }
  });
}
