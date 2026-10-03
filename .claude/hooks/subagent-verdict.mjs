// Claude Code SubagentStop hook. The reviewer agents in .claude/agents
// (spec-reviewer, code-reviewer) are consumed mechanically: /speckit-auto and
// /speckit-harden read their `VERDICT:` line and their findings table. A
// reviewer that drifts into prose still "completes", and the caller then has
// nothing to parse — the failure is silent, which is the worst kind for a gate.
//
// So: when a stopping subagent's final message looks like one of our review
// reports but carries no VERDICT line, exit 2. Claude Code feeds stderr back to
// the subagent, which continues and returns the table. Anything that is not a
// review report passes untouched.
import { existsSync, readFileSync } from "node:fs";

const REPORT = /^## (Spec Review|Code Review|Spec Challenge|Adversarial tests|Mutation|Harden)\b/m;

let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let payload = {};
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  // Find the agent's last assistant text. The transcript is JSONL; the payload
  // shape has varied across versions, so read defensively and pass on doubt.
  const path = payload.transcript_path ?? payload.agent_transcript_path;
  if (!path || !existsSync(path)) process.exit(0);

  let last = "";
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    try {
      const o = JSON.parse(line);
      if (o.type !== "assistant") continue;
      const parts = o.message?.content ?? [];
      const text = (Array.isArray(parts) ? parts : [parts])
        .map((p) => (typeof p === "string" ? p : p?.type === "text" ? p.text : ""))
        .join("\n");
      if (text.trim()) last = text;
    } catch {
      // A malformed line is not this hook's concern.
    }
  }

  if (!REPORT.test(last)) process.exit(0);

  const isReview = /^## (Spec Review|Code Review)\b/m.test(last);
  if (isReview && !/^VERDICT:\s*(APPROVE|BLOCK)\b/m.test(last)) {
    console.error(
      "Your report has no `VERDICT: APPROVE | BLOCK` line. The caller parses it mechanically — " +
        "return the report in the exact format your agent definition specifies: heading, VERDICT, findings table.",
    );
    process.exit(2);
  }

  const lines = last.split("\n").length;
  if (lines > 120) {
    console.error(
      `Your report is ${lines} lines. The caller relays it into a running session; return the table ` +
        "and at most a few lines of context — never a transcript, a diff, or raw tool output.",
    );
    process.exit(2);
  }
  process.exit(0);
});
