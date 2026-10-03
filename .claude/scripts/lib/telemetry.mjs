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
  tokens: { input: 0, output: 0, cache_read: 0, cache_creation: 0 },
  bytes_read: 0,
});

const bump = (map, key) => {
  if (key) map[key] = (map[key] ?? 0) + 1;
};

/**
 * Fold new transcript lines into a record. `text` is whatever was appended to
 * the transcript since `record.bytes_read`; a partial trailing line is dropped
 * (the next Stop re-reads it, because bytes_read only advances past newlines).
 *
 * Returns { record, consumed } — consumed is the byte length actually folded in.
 */
export function mergeTranscript(record, text) {
  const lastNewline = text.lastIndexOf("\n");
  const usable = lastNewline === -1 ? "" : text.slice(0, lastNewline + 1);

  for (const line of usable.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // a half-written or non-JSON line is not worth failing a hook over
    }

    const stamp = entry.timestamp ?? null;
    if (stamp) {
      record.started ??= stamp;
      record.updated = stamp;
    }
    if (entry.type !== "assistant") continue;
    record.turns += 1;

    const usage = entry.message?.usage ?? {};
    record.tokens.input += usage.input_tokens ?? 0;
    record.tokens.output += usage.output_tokens ?? 0;
    record.tokens.cache_read += usage.cache_read_input_tokens ?? 0;
    record.tokens.cache_creation += usage.cache_creation_input_tokens ?? 0;

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
    tokens: { input: 0, output: 0, cache_read: 0, cache_creation: 0 },
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
