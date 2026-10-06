// Session telemetry — what actually gets used in this harness.
//
// Borrowed from ECC's `post:skill:track` and `stop:cost-tracker` hooks. The
// problem they solve here: this repo ships 30+ skills, 6 subagents and 9 gates,
// and nothing records which of them ever fire. Without that, "which skills are
// dead?" is a guess, and so is "what did this session cost?".
//
// Deliberately NOT recorded: prompts, file contents, message text, anything a
// user typed. Counts and token totals only — the file is a usage ledger, not a
// transcript copy. Token counts come from the model's own usage blocks; no
// pricing table lives here, because a stale price is worse than no price.
const zero = () => ({ input: 0, output: 0, cache_read: 0, cache_creation: 0 });
const TOKEN_FIELDS = [
  ["input", "input_tokens"],
  ["output", "output_tokens"],
  ["cache_read", "cache_read_input_tokens"],
  ["cache_creation", "cache_creation_input_tokens"],
];
const add = (into, delta) => {
  for (const [k] of TOKEN_FIELDS) into[k] = (into[k] ?? 0) + delta[k];
};

export const emptyRecord = (sessionId) => ({
  session_id: sessionId,
  started: null,
  updated: null,
  branch: null,
  feature: null,
  turns: 0,
  tools: {},
  skills: {},
  agents: {},
  tokens: zero(),
  bytes_read: 0,
  // The level and phase of the last write; `buckets` holds the tokens folded
  // in while each "<level>/<phase>" pair was current, so a promotion splits a
  // run's cost instead of rewriting it.
  level: null,
  phase: null,
  buckets: {},
  // Per subagent transcript file: its agent type, read offset and the message
  // it last counted. `subagent_tokens` totals them per agent type.
  subagents: {},
  subagent_tokens: {},
  last_message_id: null,
  last_usage: null,
  too_heavy: [],
});

const bump = (map, key) => {
  if (key) map[key] = (map[key] ?? 0) + 1;
};

/**
 * Fold new transcript lines into a record. `text` is whatever was appended to
 * the transcript since its offset; a partial trailing line is dropped (the next
 * Stop re-reads it, because the offset only advances past newlines).
 *
 * A streamed message repeats one `message.id` over several lines, and its
 * output count grows from line to line, so a message is counted once at its
 * last usage: a repeat adds only the difference. `cursor` holds the id last
 * counted (the record itself for the session transcript, the subagent's entry
 * for a subagent transcript). `bucket` names the "<level>/<phase>" pair the
 * new tokens belong to; `agentType` marks a subagent transcript, whose tokens
 * are counted but whose tool calls are not the session's.
 *
 * Returns { record, consumed } — consumed is the byte length actually folded in.
 */
export function mergeTranscript(record, text, { bucket, agentType, cursor = record } = {}) {
  const lastNewline = text.lastIndexOf("\n");
  const usable = lastNewline === -1 ? "" : text.slice(0, lastNewline + 1);
  record.buckets ??= {};
  record.subagent_tokens ??= {};

  for (const line of usable.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // a half-written or non-JSON line is not worth failing a hook over
    }

    const stamp = entry.timestamp ?? null;
    if (stamp && !agentType) {
      record.started ??= stamp;
      record.updated = stamp;
    }
    if (entry.type !== "assistant") continue;

    const usage = entry.message?.usage ?? {};
    const now = Object.fromEntries(TOKEN_FIELDS.map(([k, field]) => [k, usage[field] ?? 0]));
    const id = entry.message?.id ?? null;
    const repeat = id !== null && id === cursor.last_message_id;
    const before = repeat ? (cursor.last_usage ?? zero()) : zero();
    const delta = Object.fromEntries(TOKEN_FIELDS.map(([k]) => [k, Math.max(0, now[k] - before[k])]));
    cursor.last_message_id = id;
    cursor.last_usage = Object.fromEntries(TOKEN_FIELDS.map(([k]) => [k, Math.max(now[k], before[k])]));

    add(record.tokens, delta);
    if (bucket) {
      record.buckets[bucket] ??= { tokens: zero(), subagent_tokens: zero() };
      add(record.buckets[bucket].tokens, delta);
      if (agentType) add(record.buckets[bucket].subagent_tokens, delta);
    }
    if (agentType) {
      record.subagent_tokens[agentType] ??= zero();
      add(record.subagent_tokens[agentType], delta);
      continue;
    }

    if (!repeat) record.turns += 1;
    for (const block of entry.message?.content ?? []) {
      if (block?.type !== "tool_use") continue;
      bump(record.tools, block.name);
      if (block.name === "Skill") bump(record.skills, block.input?.skill);
      if (block.name === "Agent" || block.name === "Task") bump(record.agents, block.input?.subagent_type);
    }
  }

  return { record, consumed: Buffer.byteLength(usable, "utf8") };
}

/** Roll a set of session records into one report. */
export function summarize(records) {
  const total = {
    sessions: records.length,
    turns: 0,
    tokens: zero(),
    tools: {},
    skills: {},
    agents: {},
  };
  for (const r of records) {
    total.turns += r.turns ?? 0;
    for (const k of Object.keys(total.tokens)) total.tokens[k] += r.tokens?.[k] ?? 0;
    for (const field of ["tools", "skills", "agents"])
      for (const [name, n] of Object.entries(r[field] ?? {})) total[field][name] = (total[field][name] ?? 0) + n;
  }
  return total;
}

/** Descending [name, count] pairs — what a report actually prints. */
export const ranked = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

/** The four token counts as one number, for a report line. */
export const tokenTotal = (t) => TOKEN_FIELDS.reduce((sum, [k]) => sum + (t?.[k] ?? 0), 0);
