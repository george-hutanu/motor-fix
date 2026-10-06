// Claude Code Stop hook — record what this session used. Adapted from ECC's
// stop:cost-tracker and post:skill:track.
//
// One JSON file per session under .specify/telemetry/ (git-ignored), rewritten
// in place rather than appended to, so a long session costs one small write per
// turn instead of an ever-growing log. The transcript is read incrementally
// from the byte offset the last write recorded, and so is every subagent
// transcript beside it (`<session>/subagents/agent-*.jsonl`), each from its own
// offset. Tokens are bucketed under the active feature's level and the run's
// phase at the time of the write. A `too heavy` mark left by
// `level.mjs check --ready` in `pending.json` is moved into this ledger.
//
// Never blocks: every failure path exits 0. A usage ledger is not worth
// interrupting a session for.
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { emptyRecord, mergeTranscript } from "../scripts/lib/telemetry.mjs";
import { activeFeature, featureKey, featureLevel } from "../scripts/lib/feature.mjs";

const repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

/** Read a file from `offset` to EOF without pulling the whole thing into memory. */
function readFrom(file, offset) {
  const size = statSync(file).size;
  if (size <= offset) return "";
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(size - offset);
    readSync(fd, buf, 0, buf.length, offset);
    return buf.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

/** Fold every subagent transcript the session dispatched, each from its own offset. */
function foldSubagents(record, transcript, bucket) {
  const dir = join(transcript.replace(/\.jsonl$/, ""), "subagents");
  let names;
  try {
    names = readdirSync(dir).filter((f) => /^agent-.+\.jsonl$/.test(f)).sort();
  } catch {
    return; // no folder, or not a folder: the session's own tokens still count
  }
  for (const name of names) {
    try {
      const text = readFrom(join(dir, name), record.subagents[name]?.bytes_read ?? 0);
      const entry = (record.subagents[name] ??= { agent_type: "unknown", bytes_read: 0, last_message_id: null, last_usage: null });
      if (entry.agent_type === "unknown") entry.agent_type = readJson(join(dir, name.replace(/\.jsonl$/, ".meta.json")))?.agentType ?? "unknown";
      const { consumed } = mergeTranscript(record, text, { bucket, agentType: entry.agent_type, cursor: entry });
      entry.bytes_read += consumed;
    } catch {
      // one unreadable transcript costs only its own tokens
    }
  }
}

let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  try {
    const payload = JSON.parse(raw);
    const sessionId = payload.session_id;
    const transcript = payload.transcript_path;
    if (!sessionId || !transcript || !existsSync(transcript)) process.exit(0);

    const dir = join(repo, ".specify", "telemetry");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${sessionId.replace(/[^A-Za-z0-9_-]/g, "")}.json`);

    let record = emptyRecord(sessionId);
    if (existsSync(file)) {
      try {
        record = { ...record, ...JSON.parse(readFileSync(file, "utf8")) };
      } catch {
        // Corrupt ledger: start it over rather than lose the session entirely.
      }
    }

    // A ledger from before levels lacks these; fill them rather than start over.
    record.buckets ??= {};
    record.subagents ??= {};
    record.subagent_tokens ??= {};
    record.too_heavy ??= [];

    const active = activeFeature(repo);
    record.level = active ? featureLevel(repo, featureKey(repo, active.dir)) : null;
    // The run's phase only while that run is live and is this feature's.
    const run = readJson(join(repo, ".specify", "run-state.json"));
    const live = run && run.status !== "done" && (!run.feature || run.feature.replace(/\/+$/, "").split("/").pop() === active?.name);
    record.phase = (live && run.phase) || "none";
    const bucket = `${record.level ?? "none"}/${record.phase}`;

    const { record: merged, consumed } = mergeTranscript(record, readFrom(transcript, record.bytes_read ?? 0), { bucket });
    merged.bytes_read = (record.bytes_read ?? 0) + consumed;
    foldSubagents(merged, transcript, bucket);

    const pending = join(dir, "pending.json");
    const marks = readJson(pending)?.too_heavy;
    if (Array.isArray(marks)) merged.too_heavy.push(...marks);
    try {
      merged.branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: repo,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      merged.branch = null;
    }
    merged.feature = active?.name ?? null;

    writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
    if (existsSync(pending)) rmSync(pending, { force: true });
  } catch {
    // Telemetry never blocks a session.
  }
  process.exit(0);
});
