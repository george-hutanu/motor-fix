// Claude Code PreCompact hook. When the context is about to be summarised, the
// run log is the only durable memory an autonomous run has: speckit-auto's
// rule is "after a compaction, re-read auto-run.md, tasks.md and plan.md; the
// log and the [X] markers are the truth, not memory". That rule is only as
// good as the log's last line — so this writes one, mechanically, at the
// moment it matters, with the facts a resumed run needs and cannot recall:
// where HEAD is, what is uncommitted, how many tasks are still open.
//
// Silent no-op when no feature is active or it has no run log yet.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { activeFeature } from "../scripts/lib/feature.mjs";

const repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const git = (args) => {
  try {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};

let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let trigger = "unknown";
  try {
    trigger = JSON.parse(raw).trigger ?? trigger;
  } catch {
    // No payload is not a reason to skip the flush.
  }

  const feature = activeFeature(repo);
  if (!feature) process.exit(0);
  const log = join(feature.dir, "auto-run.md");
  if (!existsSync(log)) process.exit(0);

  const tasks = existsSync(join(feature.dir, "tasks.md")) ? readFileSync(join(feature.dir, "tasks.md"), "utf8") : "";
  const open = (tasks.match(/^\s*- \[ \]/gm) ?? []).length;
  const done = (tasks.match(/^\s*- \[[Xx]\]/gm) ?? []).length;
  const dirty = git(["status", "--porcelain"]).split("\n").filter(Boolean);
  const stamp = new Date().toISOString();

  appendFileSync(
    log,
    [
      "",
      `## Compaction ${stamp} (${trigger})`,
      "",
      `- branch \`${git(["rev-parse", "--abbrev-ref", "HEAD"])}\` at \`${git(["rev-parse", "--short", "HEAD"])}\``,
      `- tasks: ${done} done, ${open} open`,
      dirty.length ? `- uncommitted (${dirty.length}):` : "- working tree clean",
      ...dirty.slice(0, 20).map((l) => `  - ${l}`),
      ...(dirty.length > 20 ? [`  - … ${dirty.length - 20} more`] : []),
      "- resume from here: re-read this log, tasks.md and plan.md before the next edit",
      "",
    ].join("\n"),
  );
  process.exit(0);
});
