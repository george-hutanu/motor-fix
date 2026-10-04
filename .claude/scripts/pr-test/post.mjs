// Post the PR tester's verdict: a review, the `agent-review` commit status and
// the PR description's "Agent review" section.
//
// GitHub refuses APPROVE and REQUEST_CHANGES on a PR its own author reviews,
// and here the implementer and the tester are the same account. So the real
// event is tried first and a COMMENT review that states the verdict is the
// fallback; the commit status is what the gates read.
//
//   node .claude/scripts/pr-test/post.mjs --report <report.json> [--add <findings.json>] [--repo o/r] [--dry-run]
// --add folds the agent's own findings (a JSON array) into the report first.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

import { isBlocking, reportMarkdown, verdict } from "./findings.mjs";

export const STATUS_CONTEXT = "agent-review";
const SECTION = "Agent review";

/** `gh` as a function: { code, stdout, stderr }, never throws. */
export function realGh(args, { input } = {}) {
  try {
    const stdout = execFileSync("gh", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"], timeout: 60000 });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    return { code: error.status ?? 1, stdout: `${error.stdout ?? ""}`, stderr: `${error.stderr ?? error.message}` };
  }
}

/** The body with one `##`/`###` section's content replaced, or null when the section is absent. */
export function replaceSection(body, heading, content) {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^(#{2,3})\\s*${heading}\\s*$`, "i").test(l.trim()));
  if (start === -1) return null;
  const level = lines[start].trim().match(/^#+/)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s/);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return [...lines.slice(0, start + 1), content, "", ...lines.slice(end)].join("\n");
}

const ownPrRefusal = (stderr) => /own pull request|HTTP 422/i.test(stderr);

export function postVerdict({ pr, repo, sha, verdict, summary, body, lap, gh = realGh, dryRun = false }) {
  const wanted = verdict === "failure" ? "REQUEST_CHANGES" : "APPROVE";
  const headline = `Verdict: ${verdict} (agent-review on ${String(sha).slice(0, 7)}${lap ? `, lap ${lap}` : ""})`;
  const reviewBody = `${headline}\n\n${summary}\n\n${body ?? ""}`.trimEnd();
  const status = {
    state: verdict === "failure" ? "failure" : "success",
    description: summary.slice(0, 140),
  };
  const section = `${headline}\n\n${summary}`;

  const read = gh(["pr", "view", String(pr), "--repo", repo, "--json", "body"]);
  const current = read.code === 0 ? (JSON.parse(read.stdout).body ?? "") : "";
  const nextBody = replaceSection(current, SECTION, section);

  if (dryRun) return { dryRun: true, review: wanted, reviewBody, status, section: nextBody === null ? "comment" : "description", sectionText: section };

  const review = (event) =>
    gh(["api", "-X", "POST", `repos/${repo}/pulls/${pr}/reviews`, "--input", "-"], {
      input: JSON.stringify({ commit_id: sha, event, body: reviewBody }),
    });
  let posted = wanted;
  let result = review(wanted);
  if (result.code !== 0 && ownPrRefusal(result.stderr)) {
    posted = "COMMENT";
    result = review("COMMENT");
  }
  const reviewError = result.code === 0 ? null : result.stderr.trim();

  const set = gh([
    "api",
    "-X",
    "POST",
    `repos/${repo}/statuses/${sha}`,
    "-f",
    `state=${status.state}`,
    "-f",
    `context=${STATUS_CONTEXT}`,
    "-f",
    `description=${status.description}`,
  ]);
  if (set.code !== 0) throw new Error(`could not set the ${STATUS_CONTEXT} status on ${sha}: ${set.stderr.trim()}`);

  let where = "comment";
  if (nextBody !== null) {
    const patch = gh(["api", "-X", "PATCH", `repos/${repo}/pulls/${pr}`, "--input", "-"], { input: JSON.stringify({ body: nextBody }) });
    if (patch.code === 0) where = "description";
  }
  if (where === "comment") gh(["pr", "comment", String(pr), "--repo", repo, "--body-file", "-"], { input: section });

  return { dryRun: false, review: posted, reviewError, status, section: where };
}

function flag(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

/** Fold the agent's own findings into run.mjs's report and recompute the verdict, summary and Markdown. */
export function addFindings(report, extra) {
  const findings = [...report.findings, ...extra];
  const v = verdict(findings);
  const blocking = findings.filter(isBlocking).length;
  const summary = `${v === "failure" ? `${blocking} blocking finding(s)` : "No blocking findings"}; ${findings.length} in all. Booted ${report.booted.join(", ") || "nothing"}.`;
  const markdown = reportMarkdown({ ...report, findings, verdict: v });
  return { ...report, findings, verdict: v, summary, markdown };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const file = flag(argv, "report");
  let report = JSON.parse(readFileSync(file, "utf8"));
  const add = flag(argv, "add");
  if (add) {
    report = addFindings(report, JSON.parse(readFileSync(add, "utf8")));
    writeFileSync(file, JSON.stringify(report, null, 2));
    writeFileSync(file.replace(/\.json$/, ".md"), report.markdown);
  }
  const repo = flag(argv, "repo") ?? report.repo;
  try {
    const out = postVerdict({
      pr: report.pr,
      repo,
      sha: report.sha,
      verdict: report.verdict,
      summary: report.summary,
      body: report.markdown,
      lap: report.lap,
      dryRun: argv.includes("--dry-run"),
    });
    console.log(JSON.stringify(out, null, 2));
  } catch (error) {
    console.error(`post: ${error.message}`);
    process.exit(1);
  }
}
