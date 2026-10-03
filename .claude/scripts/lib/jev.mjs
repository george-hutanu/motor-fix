// The Jev lane: typed judgements for the checks that are not mechanical.
//
// Every other script here answers a question by reading files — does this
// token exist, is this checkbox ticked, did this path change. That leaves a
// class of defect nothing in the harness can see: a requirement that is
// structurally perfect and semantically untestable, a context line that no
// longer changes what the agent does, a finding whose severity nobody ranked.
// Those judgements existed only inside a Claude subagent, which means they
// ran once, in one skill, if someone remembered to invoke it.
//
// Jev (TypeSafe's System One model) answers exactly that shape and nothing
// else: closed questions against a state, returning typed answers with
// probabilities. It cannot read the tree, call a tool or write prose, so it
// complements the scripts rather than replacing any of them.
//
// Three rules hold everywhere this is used, and they are why it is a lane and
// not a gate:
//
//   1. ADVISORY ONLY. No Jev answer may decide an exit code. A gate that
//      blocks on a probabilistic call blocks the same edit on Tuesday and
//      passes it on Wednesday. Findings from here are reported; the
//      mechanical rules still own --check.
//   2. FAIL OPEN. No key, no network, a 500, a timeout — the caller gets
//      `unavailable` and prints its mechanical findings unchanged. Same
//      contract as libs/native-thread-priority and the same reading
//      /speckit-context applies to a disconnected MCP server: an unavailable
//      lane is recorded as unavailable, never as "nothing found".
//   3. NEVER PER-EDIT. post-edit-check and red-first-gate fire on every
//      Edit/Write; a network round trip there makes the harness slow enough
//      to turn off. Session start, pre-commit and on-demand scripts only.
//
// Zero dependencies on purpose: every file under .claude/ imports only node:*
// and its siblings, and .claude/ is not an npm workspace, so an SDK would
// have to land in the tracked root package.json for a tool only this machine
// runs. The wire format is three JSON shapes; fetch is enough.
//
//   https://docs.typesafe.ai/api.md
import { existsSync } from "node:fs";
import { join } from "node:path";

import { defaultRepo, readHarnessSettings } from "./harness-settings.mjs";

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const DEFAULT_MODEL = "jev-latest";

/** Questions per request. They evaluate in parallel against the same state,
 *  so the only reason to chunk is to keep one request from growing unbounded
 *  over a spec with a hundred requirements. */
const MAX_QUESTIONS_PER_CALL = 40;

/** Bounds the await. A wedged endpoint must degrade to an unavailable lane,
 *  not hang a session-start hook or a pre-commit run forever. */
const DEFAULT_TIMEOUT_MS = 20_000;

let envLoaded = false;

/**
 * The credential, from the environment or the repo's own `.env`.
 *
 * `TYPESAFE_API_KEY` is the name the vendor's SDKs read and takes precedence;
 * `JEV` is accepted because that is what this repo's `.env` already calls it.
 * `process.loadEnvFile` is Node's built-in reader — no dotenv dependency, and
 * it leaves an already-exported variable alone.
 */
export function jevKey(repo = defaultRepo()) {
  if (!envLoaded) {
    envLoaded = true;
    const file = join(repo, ".env");
    try {
      if (existsSync(file)) process.loadEnvFile(file);
    } catch {
      // A malformed .env is not this lane's problem to report.
    }
  }
  return process.env.TYPESAFE_API_KEY || process.env.JEV || "";
}

/**
 * Whether the lane is switched on AND credentialed.
 *
 * Precedence matches every other harness setting: environment, then
 * `.specify/harness-settings.json`, then the default (on). `SPECKIT_JEV=0`
 * turns it off for one command without touching a file.
 */
export function jevEnabled(repo = defaultRepo(), env = process.env) {
  const flag = env.SPECKIT_JEV;
  if (flag === "0" || flag === "false") return false;
  if (flag === "1" || flag === "true") return jevKey(repo) !== "";
  if (readHarnessSettings(repo).jev === false) return false;
  return jevKey(repo) !== "";
}

/** A yes/no question. `whenTrue`/`whenFalse` sharpen the boundary; both optional. */
export function noul(instructions, whenTrue, whenFalse) {
  const question = { type: "noul", instructions };
  if (whenTrue !== undefined || whenFalse !== undefined)
    question.criteria = { true: whenTrue ?? "", false: whenFalse ?? "" };
  return question;
}

/** A pick from a closed set — an array of option names, or {option: gloss}. */
export function choice(instructions, options) {
  return {
    type: "choice",
    instructions,
    criteria: Array.isArray(options) ? Object.fromEntries(options.map((o) => [o, null])) : options,
  };
}

/** A rating against an ordered rubric, lowest level first. */
export function score(instructions, levels) {
  return { type: "score", instructions, criteria: levels };
}

/** Question ids travel as JSON object keys and come back as the answer keys;
 *  callers build them from FR ids, file paths and instinct slugs. */
export const qid = (...parts) => parts.join("_").replace(/[^A-Za-z0-9_]/g, "_");

const chunk = (entries, size) => {
  const out = [];
  for (let i = 0; i < entries.length; i += size) out.push(entries.slice(i, i + size));
  return out;
};

/**
 * Ask Jev a batch of typed questions about one state.
 *
 * Returns `{ answers, unavailable, reason, usage }` and never throws or
 * rejects: a caller that forgets to check `unavailable` still gets an empty
 * answer map rather than a stack trace out of a hook. `fetchImpl` is injected
 * so the specs can exercise every branch without a network.
 */
export async function ask(state, questions, opts = {}) {
  const {
    repo = defaultRepo(),
    model = process.env.SPECKIT_JEV_MODEL || DEFAULT_MODEL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
    apiKey,
  } = opts;

  const entries = Object.entries(questions ?? {});
  if (entries.length === 0) return { answers: {}, unavailable: false, usage: null };

  // "Switched off" and "no credential" are different facts and a report that
  // conflates them sends someone looking for a key they already have.
  const key = apiKey ?? (jevEnabled(repo) ? jevKey(repo) : "");
  if (!key) {
    const reason =
      jevKey(repo) === ""
        ? "no TYPESAFE_API_KEY (or JEV) in env or .env"
        : "switched off — SPECKIT_JEV=0, or jev:false in .specify/harness-settings.json";
    return { answers: {}, unavailable: true, reason };
  }

  const batches = chunk(entries, MAX_QUESTIONS_PER_CALL);
  const results = await Promise.all(
    batches.map((batch) => post(state, Object.fromEntries(batch), { model, timeoutMs, fetchImpl, key })),
  );

  const answers = {};
  const usage = { input_tokens: 0, output_tokens: 0 };
  let reason;
  for (const result of results) {
    if (result.reason) reason ??= result.reason;
    Object.assign(answers, result.answers);
    usage.input_tokens += result.usage?.input_tokens ?? 0;
    usage.output_tokens += result.usage?.output_tokens ?? 0;
  }
  // Partial is still useful: one failed batch of forty questions should not
  // discard the three batches that came back.
  return { answers, unavailable: Object.keys(answers).length === 0 && reason !== undefined, reason, usage };
}

async function post(state, questions, { model, timeoutMs, fetchImpl, key }) {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetchImpl(JEV_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, state, questions }),
      signal,
    });
    if (!response.ok) return { answers: {}, reason: `HTTP ${response.status} from ${JEV_ENDPOINT}` };
    const body = await response.json();
    return { answers: body?.answers ?? {}, usage: body?.usage ?? null };
  } catch (cause) {
    return { answers: {}, reason: cause?.name === "TimeoutError" ? `timed out after ${timeoutMs}ms` : String(cause?.message ?? cause) };
  }
}

// Answer readers. Every one returns `undefined` for a missing or malformed
// answer so a caller can treat "Jev did not answer this" and "Jev is off" the
// same way, with `??`.

/** 0–1 truth value of a noul answer. */
export const noulOf = (answer) => (typeof answer?.noul === "number" ? answer.noul : undefined);

/** `{ choice, confidence }` of a choice answer. */
export const choiceOf = (answer) =>
  typeof answer?.choice === "string" ? { choice: answer.choice, confidence: answer.confidence ?? 0 } : undefined;

/** `{ score, confidence, label }` of a score answer; `label` is the nearest rubric level. */
export function scoreOf(answer) {
  if (typeof answer?.score !== "number") return undefined;
  const label = answer.legend?.[String(Math.round(answer.score))];
  return { score: answer.score, confidence: answer.confidence ?? 0, label };
}

/** The one line every caller prints when the lane did not answer. */
export const unavailableNote = (reason) => `  · jev lane unavailable (${reason ?? "disabled"}) — mechanical findings only`;
