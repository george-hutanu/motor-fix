// Claude Code Stop hook — record what this session used. Adapted from ECC's
// stop:cost-tracker and post:skill:track.
//
// One JSON file per session under .specify/telemetry/ (git-ignored), rewritten
// in place rather than appended to, so a long session costs one small write per
// turn instead of an ever-growing log. The transcript is read incrementally
// from the byte offset the last write recorded.
//
// Never blocks: every failure path exits 0. A usage ledger is not worth
// interrupting a session for.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { emptyRecord, mergeTranscript } from "../scripts/lib/telemetry.mjs";
import { activeFeature } from "../scripts/lib/feature.mjs";

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

    const { record: merged, consumed } = mergeTranscript(record, readFrom(transcript, record.bytes_read ?? 0));
    merged.bytes_read = (record.bytes_read ?? 0) + consumed;
    try {
      merged.branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: repo,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      merged.branch = null;
    }
    merged.feature = activeFeature(repo)?.name ?? null;

    writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
  } catch {
    // Telemetry never blocks a session.
  }
  process.exit(0);
});
