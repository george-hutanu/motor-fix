// Claude Code PreToolUse hook (Bash) — Constitution VII: a PR merges only
// after the PR tester passed it. Refuses `gh pr merge`, the REST merge call
// and a `gh api graphql` mergePullRequest or enablePullRequestAutoMerge
// mutation while the PR's head commit has no `agent-review` success status.
// A GraphQL merge is tied to its PR through the pull request id it names
// (inline, or a -f/-F field), which must be this repository's PR of that
// number, and judged the same way. The command is split into words as the
// shell splits it (shellCommands: quotes, escapes, substitutions, `sh -c`,
// eval). A merge naming a repository (-R, --repo, GH_REPO, also exported by an
// earlier command, a PR URL, a REST owner/repo) must name this one, and gh is
// read where a literal `cd` moved it: only a top-level cd joined to the merge
// by one unbroken && chain is followed (speckit-watch merges with
// `cd <worktree> && …`). Refused unread: a command merging more than one PR;
// a CLI merge taking its PR from xargs, from a substitution, or after a branch
// switch with no PR named; a REST merge with no literal number; a merge after
// any other cd (after || or in a pipe, not the head word, in a group), a
// pushd, a repo set-default, env -C, --hostname, or a GIT_DIR, GIT_WORK_TREE,
// GH_HOST or CDPATH setting; a GraphQL merge naming no id the gate can
// read, or more than one, or repeating a field; any `gh api graphql` whose
// query the gate cannot see (none, a file, stdin, --input, a shell
// expansion); and, as the backstop, any command whose text (quotes and
// escapes dropped) still holds gh with a merge the parser placed nowhere: a
// string another program runs (`node -e`, `| sh`, a here-string) or a mere
// mention (echo, grep). The gate reads command text only: a merge made
// outside gh, or a command the shell computes (a variable holding gh, an
// alias), is out of its reach.
//
// A PR opened by Dependabot (its author, read from gh) whose every commit
// Dependabot wrote, and GitHub or Dependabot committed under a verified
// signature (read off the REST pulls commits list), needs no agent-review
// status, only the same CI rule below: a failing, pending or missing check
// still refuses it, and so does an agent review that failed. A failing check
// on such a PR is sent back through Dependabot, not to the PR tester: a
// commit of anyone else's would take the exemption away.
//
// The status is per commit, so a push after the tester ran (a fix, a merge of
// origin/main) leaves the new head without one, and the tester runs again.
//
// The tester runs beside CI rather than after it, so an agent-review success
// does not imply CI finished: the gate also refuses while any other check is
// failing or still running, or while CI OK or PR title has not reported at
// all: pr-title.yml runs apart from CI and CI OK does not wait for it, so each
// is required by name. A Dependabot PR needs both as well.
//
// A carried success (`carried from <sha>: docs-only change`, `...: QA fixes`
// or `...: merge of main`, set by .claude/scripts/pr-test/carry.mjs) is
// verified, not trusted: the
// named commit must be one of the PR's own commits with a success of its own,
// an ancestor of head, with no real failing lap after it; a docs carry differs
// from it by documentation only (scripts/docs-only.ts), a QA-fixes carry
// names a lap that reported medium or low findings and adds only single-parent
// fix, test, docs, style or refactor commits (Constitution VII step 5); a
// merge-of-main carry adds only merges of main whose own diff shares no file
// with the PR's (Constitution VII step 6), and a fixes carry may ride over one
// too; otherwise the merge is refused as if there were no verdict. A carry the
// gate cannot verify is refused too. SPECKIT_CARRY_STATE replaces those reads for the eval cases.
//
// Fail-closed where the gate cannot see. A PR it cannot read is refused, and
// so is every merge it cannot finish checking within DEADLINE_MS: Claude Code
// does not block on a hook it stopped for running long, so the gate stops
// itself first (run-hook.mjs stops it at the registry's timeout_ms, inside the
// hook timeout in settings.json, should it hang anyway). The reads are bounded
// too: the PR, head's statuses, the compare, then every other statuses read at
// once, each sha read once.
//
// A success counts only when the PR under test could not have written it
// (.claude/scripts/pr-test/provenance.mjs): written by the owner's tester, or
// by a passing run of pr-qa.yml for this head that ran the default branch's
// copy of the workflow; and never against a failing tester review of the head,
// the only place a cloud tester's verdict lands. A carry's named commit is
// traced the same way. A success the gate cannot trace is refused.
// SPECKIT_PROVENANCE_STATE (one judgeProvenance input, used for every commit)
// replaces those reads for the eval cases.
//
// An earlier attempt GitHub left unfinished after a newer attempt of the same
// run completed (orphanedChecks below) is no pending check: the newer attempt
// decides it, and the gate names each one it ignored, on stdout when it
// approves and at the end of a refusal. Only the REST read carries the run
// state the rule needs; the branch read through `gh pr view` judges as before.
//
// The PR QA workflow's own check run is left out of the CI rule: its verdict
// is agent-review, which the workflow sets, and a run a newer lap cancelled is
// history, not a red check.
//
// GraphQL is one hourly budget every session shares, and a cloud session
// (CLAUDE_CODE_REMOTE=true) has none, so a PR named by number or URL is read
// over REST everywhere: its commits, head's combined status, its check runs
// and their workflows, shaped as gh's rollup, under the same rule. Off the
// cloud a branch or no target still goes through `gh pr view`; in the cloud
// the command must name the PR. `lifecycle.mjs merge` merges with
// `gh api -X PUT repos/{owner}/{repo}/pulls/<n>/merge`.
//
// SPECKIT_PR_STATE (the PR as JSON) replaces the gh read for the eval cases,
// with SPECKIT_CARRY_DELAY_MS to slow the carry read down;
// SPECKIT_MERGE_GATE_DEADLINE_MS can only shorten the deadline. Hook processes
// take Claude Code's environment, not a Bash call's, so an agent cannot set
// them for a real gate run.
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { isEntryPoint } from "../scripts/lib/entry.mjs";
import { isMutationCheck } from "../scripts/lib/mutation-check.mjs";
import { carriedFrom, carryKind, fetchCarryState, judgeCarry, latestReview, statusesArgs } from "../scripts/pr-test/carry.mjs";
import { judgeProvenance, readProvenance } from "../scripts/pr-test/provenance.mjs";
import { committerArgs, hasAgentReview, isDependabot, openedByDependabot, withCommitters } from "./pr-lifecycle-gate.mjs";

// An orphaned check attempt: an unfinished check run for which another check
// run of the same name in the same Actions run (the run id in its details URL)
// completed and started after it, while that run, whose status is its latest
// attempt's, has completed. Re-running a workflow keeps its run id and adds an
// attempt, and GitHub can leave the earlier attempt's check run in_progress
// for good. Anything less stays pending: no run id or start date (a third-party
// check), the run still going, or no newer completed attempt. Each check is
// { name, status, startedAt, runId, runStatus }, statuses in either case.
const completed = (status) => String(status ?? "").toLowerCase() === "completed";
const started = (c) => Date.parse(c.startedAt ?? "");

/** The Actions run id in a check run's details URL, or null. */
export const runIdOf = (url) => /\/actions\/runs\/(\d+)/.exec(String(url ?? ""))?.[1] ?? null;

/** The orphaned attempts among `checks`. */
export function orphanedChecks(checks = []) {
  return (checks ?? []).filter(
    (c) =>
      !completed(c.status) &&
      c.runId != null &&
      completed(c.runStatus) &&
      Number.isFinite(started(c)) &&
      checks.some((d) => d !== c && d.name === c.name && String(d.runId) === String(c.runId) && completed(d.status) && started(d) > started(c)),
  );
}

/** One line naming the orphans a reader ignored on `sha`, or null for none. */
export function orphanLine(orphans, sha) {
  if (!orphans.length) return null;
  const each = orphans.map((c) => `${c.workflowName ? `${c.workflowName} / ` : ""}${c.name} (check run ${c.checkRunId ?? "?"}, run ${c.runId}, started ${c.startedAt})`);
  return `ignored ${orphans.length === 1 ? "an orphaned check attempt" : `${orphans.length} orphaned check attempts`} on ${String(sha ?? "").slice(0, 7)}, left unfinished after a newer attempt of the same run completed: ${each.join("; ")}`;
}

/** How long the gate may spend reading GitHub before it refuses: well inside run-hook.mjs's limit for it. */
export const DEADLINE_MS = 30000;

/** The deadline for this run: SPECKIT_MERGE_GATE_DEADLINE_MS when it is shorter, else DEADLINE_MS. */
export function deadlineMs(env = process.env) {
  const asked = Number(env.SPECKIT_MERGE_GATE_DEADLINE_MS);
  return asked > 0 && asked < DEADLINE_MS ? asked : DEADLINE_MS;
}

const GREEN = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const checkName = (c) => c.context ?? c.name;
/** The checks a head needs by name: CI's aggregate, and the PR title job, which runs apart (pr-title.yml) and CI OK does not wait for. */
const REQUIRED_CHECKS = ["CI OK", "PR title"];
/** The workflow (.github/workflows/pr-qa.yml) whose verdict is agent-review. */
const QA_WORKFLOW = "PR QA";

// Flags of `gh`, `gh pr merge` and `gh api` that take a value, so the value is not read as the PR or the path
// (-R, --repo and the field flags are read apart).
const VALUED = new Set(["-t", "--subject", "-b", "--body", "--body-file", "--match-head-commit", "-A", "--author-email", "-H", "--header", "-X", "--method", "-q", "--jq", "--template", "--hostname", "-p", "--preview", "--cache"]);
/** `gh api` flags whose value is a `name=value` field. */
const FIELD_FLAGS = new Set(["-f", "-F", "--field", "--raw-field"]);
/** Shells whose `-c` string is a command of its own. */
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
/** Commands that set shell variables from their arguments. */
const DECLARERS = new Set(["export", "declare", "typeset", "local", "readonly"]);
/** Variables that move gh to another repository, checkout or host, or a cd elsewhere, which the gate does not follow. */
const MOVERS = /^(?:GIT_DIR|GIT_WORK_TREE|GH_HOST|CDPATH)=/;

/** The GraphQL mutations that merge a PR, or arm it to merge once green. */
const MERGE_MUTATION = /\b(?:mergePullRequest|enablePullRequestAutoMerge)\b/;
/** A GraphQL node id as GitHub writes one; anything else (a shell variable, a substitution) is unreadable. */
const NODE_ID = /^[A-Za-z0-9_=+/-]+$/;
/** A PR the gate can read in a named repository: a number, or a PR URL. */
const NUMBERED = /^(?:\d+|https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+)$/;

const unresolved = (why) => ({ pr: null, unresolved: why });
const base = (v) => v.slice(v.lastIndexOf("/") + 1);

/**
 * The command as the shell splits it: its simple commands, each a list of
 * words { v, expands }. `v` is the word with quotes and escapes resolved;
 * `expands` says the shell substitutes part of it ($, a backtick) outside
 * single quotes, which the gate cannot read. A substitution ($(…), `…`) and a
 * string a shell runs (`bash -c "…"`, `eval …`) become commands of their own,
 * every word of an expanding string marked as expanding. Redirections and
 * comments are dropped.
 */
export function shellCommands(src, depth = 0, taint = false) {
  const commands = [];
  let words = [];
  let word = null;
  let redirect = false;
  let parens = 0;
  const at = () => (word ??= { v: "", expands: taint });
  const endWord = () => {
    if (word && !redirect) words.push(word);
    if (word) redirect = false;
    word = null;
  };
  // Each command carries `top` (outside any subshell or substitution) and `after`, the operator that ends it.
  const endCommand = (after) => {
    endWord();
    redirect = false;
    if (words.length) commands.push(Object.assign(words, { top: depth === 0 && parens === 0 && !taint, after }));
    words = [];
  };
  const nested = (inner) => depth < 8 && commands.push(...shellCommands(inner, depth + 1, taint));
  const closing = (from) => {
    for (let d = 1, j = from; j < src.length; j++) if (src[j] === "(") d++; else if (src[j] === ")" && --d === 0) return j;
    return src.length;
  };
  const upTo = (ch, from) => (src.indexOf(ch, from) === -1 ? src.length : src.indexOf(ch, from));
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      if (src[i + 1] === "\n") i++;
      else at().v += src[++i] ?? "";
    } else if (c === "'") {
      const end = upTo("'", i + 1);
      at().v += src.slice(i + 1, end);
      i = end;
    } else if (c === "$" && src[i + 1] === "'") {
      // ANSI-C quoting: \' does not end it, and a code escape (\x67, \0, \u…) is computed text the gate cannot read.
      const w = at();
      let j = i + 2;
      for (; j < src.length && src[j] !== "'"; j++) {
        if (src[j] === "\\") {
          if (/[0-7xuUc]/.test(src[j + 1] ?? "")) w.expands = true;
          w.v += src[++j] ?? "";
        } else w.v += src[j];
      }
      i = j;
    } else if (c === '"') {
      const w = at();
      let j = i + 1;
      for (; j < src.length && src[j] !== '"'; j++) {
        const d = src[j];
        if (d === "\\" && '"\\$`'.includes(src[j + 1] ?? "")) w.v += src[++j];
        else if (d === "\\" && src[j + 1] === "\n") j++;
        else if (d === "$" && src[j + 1] === "(") {
          const end = closing(j + 2);
          nested(src.slice(j + 2, end));
          w.expands = true;
          j = end;
        } else if (d === "`") {
          const end = upTo("`", j + 1);
          nested(src.slice(j + 1, end));
          w.expands = true;
          j = end;
        } else {
          if (d === "$") w.expands = true;
          w.v += d;
        }
      }
      i = j;
    } else if (c === "$" && src[i + 1] === "(") {
      const end = closing(i + 2);
      nested(src.slice(i + 2, end));
      at().expands = true;
      i = end;
    } else if (c === "`") {
      const end = upTo("`", i + 1);
      nested(src.slice(i + 1, end));
      at().expands = true;
      i = end;
    } else if (c === "$") {
      at().expands = true;
      word.v += c;
    } else if (c === "#" && word === null) i = upTo("\n", i) - 1;
    else if (c === "<" || c === ">") {
      // `2>/dev/null`: the fd number and the target are no words of the command.
      if (word && /^\d*$/.test(word.v)) word = null;
      else endWord();
      while (src[i + 1] === "<" || src[i + 1] === ">" || src[i + 1] === "&") i++;
      redirect = true;
    } else if ((c === "&" || c === "|") && src[i + 1] === c) {
      endCommand(c + c);
      i++;
    } else if (c === "\n" || c === ";" || c === "&" || c === "|") endCommand(c === "\n" ? ";" : c);
    else if (c === "(") {
      endCommand("(");
      parens++;
    } else if (c === ")") {
      endCommand(")");
      parens = Math.max(0, parens - 1);
    }
    else if (/\s/.test(c)) endWord();
    else at().v += c;
  }
  endCommand(";");
  // A string a shell runs is read as the commands it holds.
  for (const cmd of [...commands]) {
    const vs = cmd.map((w) => w.v);
    const first = vs.findIndex((v) => !/^\w+=/.test(v));
    if (depth >= 8 || first === -1) continue;
    if (vs[first] === "eval") commands.push(...shellCommands(vs.slice(first + 1).join(" "), depth + 1, cmd.slice(first + 1).some((w) => w.expands)));
    const c = vs.findIndex((v, i) => i > first && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(v));
    if (c > first && cmd[c + 1] && vs.slice(first, c).some((v) => SHELLS.has(base(v)))) commands.push(...shellCommands(cmd[c + 1].v, depth + 1, cmd[c + 1].expands));
  }
  return commands;
}

/** A `name=value` field, or null for a word without `=`. */
function field(w, text) {
  const eq = text.indexOf("=");
  return eq === -1 ? null : { name: text.slice(0, eq), value: text.slice(eq + 1), expands: w.expands };
}

/**
 * For one `gh api graphql` call's fields: { nodeId } for the one pullRequestId
 * a merge mutation names (inline, or a variable's field), unresolved when it
 * cannot be told, null when the call merges nothing. A query the gate cannot
 * read (none given, a file, stdin, --input, a shell expansion, a field it
 * cannot name) may hold a merge, so it is refused too; gh sends the last of a
 * repeated field, so a repeated query or id field is refused rather than read.
 */
function graphqlTarget(fields, input) {
  const queries = fields.filter((f) => f?.name === "query");
  if (input || !queries.length || fields.some((f) => !f || !/^\w+$/.test(f.name)) || queries.some((q) => q.expands || q.value.startsWith("@")))
    return unresolved("the gate cannot read the query it sends (none given, a file, stdin, --input or a shell expansion), which may merge a pull request");
  const text = queries.map((q) => q.value).join("\n");
  if (!MERGE_MUTATION.test(text)) return null;
  if (queries.length > 1) return unresolved("it gives the query field more than once");
  const ids = [...text.matchAll(/pullRequestId\s*:\s*"([^"\s]+)"/g)].map((m) => m[1]);
  for (const m of text.matchAll(/pullRequestId\s*:\s*\$(\w+)/g)) {
    const values = fields.filter((f) => f.name === m[1]).map((f) => (f.expands ? "" : f.value));
    if (new Set(values).size === 1 && values.length > 1) return unresolved(`it gives the ${m[1]} field more than once`);
    ids.push(...(values.length ? values : [""]));
  }
  const distinct = [...new Set(ids)];
  if (distinct.length > 1) return unresolved(`it names more than one pull request (${distinct.map((id) => id || "an unset variable").join(", ")})`);
  if (distinct.length === 0 || !NODE_ID.test(distinct[0])) return unresolved("it names no pull request id the gate can read: a literal id, inline or as a -f/-F field");
  return { pr: null, nodeId: distinct[0] };
}

/**
 * The PR a command merges, or null for any other command: { pr } from
 * `gh pr merge` (null for the current branch) or the REST merge call, with
 * `repo` when the command names a repository (-R, --repo, GH_REPO, a PR URL, a
 * REST owner/repo), which the entry point compares with the PR it read, and
 * `cwd` when a literal `cd` before it moves gh, where the gate reads it;
 * { pr: null, nodeId } from a `gh api graphql` merge mutation, whose PR
 * prOfNode reads; { pr: null, unresolved } for a merge the gate cannot tie to
 * one PR, which is refused, never guessed. Words are read as the shell reads
 * them (shellCommands); what the shell computes (a variable holding gh, an
 * alias, a built string) is out of the gate's sight.
 */
export function mergeTarget(command) {
  const targets = [];
  // What earlier commands changed for gh: its directory, GH_REPO, the branch, a repository set-default.
  let cwd = null;
  let cdBroken = false;
  let prevAfter = null;
  let shellRepo = null;
  let moved = null;
  let branchMoved = false;
  for (const cmd of shellCommands(command)) {
    const vs = cmd.map((w) => w.v);
    const first = vs.findIndex((v) => !/^\w+=/.test(v));
    // A followed cd holds only while every command after it, up to the merge, is joined by &&;
    // one the shell may skip (after ||) or run apart (in a pipe) is not followed.
    const skippable = prevAfter === "||" || prevAfter === "|";
    if (cmd.top) {
      if (cwd != null && prevAfter !== "&&") cdBroken = true;
      prevAfter = cmd.after;
    }
    if (cmd.slice(0, first === -1 ? cmd.length : first).some((w) => MOVERS.test(w.v))) moved = "a change of GIT_DIR, GIT_WORK_TREE, GH_HOST or CDPATH";
    // A cd that is not the head word (command cd, if cd, { cd …) moves the shell where the gate does not look.
    if (vs.some((v, i) => i !== first && ["cd", "pushd", "popd"].includes(base(v)))) moved = "a cd inside another command";
    const declares = first === -1 || DECLARERS.has(vs[first]);
    const settings = declares ? cmd.slice(first === -1 ? 0 : first + 1) : [];
    if (settings.some((w) => MOVERS.test(w.v))) moved = "a change of GIT_DIR, GIT_WORK_TREE, GH_HOST or CDPATH";
    if (declares) {
      const w = settings.find((x) => /^GH_REPO=/.test(x.v));
      if (w) shellRepo = w.expands ? "" : w.v.slice("GH_REPO=".length);
      continue;
    }
    const head = base(vs[first]);
    if (head === "cd") {
      const to = cmd[first + 1];
      if (!cmd.top || cdBroken || skippable || to?.expands || to?.v === "-") moved = "a cd outside one && chain";
      else cwd = to == null ? "~" : cwd == null || /^[/~]/.test(to.v) ? to.v : join(cwd, to.v);
      continue;
    }
    if (head === "pushd" || head === "popd") moved = `a ${head}`;
    if (head === "unset" && vs.includes("GH_REPO")) shellRepo = null;
    if (head === "git" && vs.slice(first + 1).some((v) => v === "switch" || v === "checkout")) branchMoved = true;
    // A bare gh counts anywhere in the command (after xargs, env, sudo…), the first one that runs pr, api or repo;
    // a quoted phrase is one word, so it never does.
    const call = vs
      .flatMap((v, i) => (base(v) === "gh" ? [i] : []))
      .map((i) => readCall(cmd, i, shellRepo))
      .find((c) => ["pr", "api", "repo"].includes(c.sub));
    if (!call) continue;
    const { before, positional, fields, input, sub, verb, arg } = call;
    if (before.some((w) => MOVERS.test(w.v))) moved = "a change of GIT_DIR, GIT_WORK_TREE, GH_HOST or CDPATH";
    if (before.some((w) => w.v === "-C" || w.v.startsWith("--chdir"))) moved = "an env -C";
    if (call.host != null) moved = "a --hostname";
    let target = null;
    if (sub === "repo" && verb === "set-default") moved = "a repository set-default";
    if (sub === "pr" && verb === "merge") {
      if (arg == null && before.some((w) => base(w.v) === "xargs")) return unresolved("it takes the pull request from its input (xargs), which the gate cannot see");
      if (positional[2]?.expands) return unresolved("its pull request is built by the shell, which the gate cannot read");
      if (arg == null && branchMoved) return unresolved("it switches branch before merging the current branch's PR");
      target = { pr: arg ?? null, repo: /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+$/.exec(arg ?? "")?.[1] ?? call.repo };
    } else if (sub === "api") {
      const path = positional.slice(1).find((w) => /(?:^|\/)repos\/[^/]*\/[^/]*\/pulls\//.test(w.v));
      const m = path && /(?:^|\/)repos\/([^/]+)\/([^/]+)\/pulls\/([^/?]*)\/merge(?![\w-])/.exec(path.v);
      if (path?.expands) return unresolved("its REST path is built by the shell, so the gate cannot read its pull request number");
      if (m) {
        if (!/^\d+$/.test(m[3])) return unresolved("its REST merge names no pull request number the gate can read");
        const named = `${m[1]}/${m[2]}`;
        target = { pr: m[3], repo: named === "{owner}/{repo}" ? call.repo : named };
      } else if (positional.slice(1).some((w) => w.v === "graphql" || w.v.endsWith("/graphql"))) {
        const merge = graphqlTarget(fields, input);
        if (merge?.unresolved) return merge;
        if (merge) targets.push({ ...merge, key: `node#${merge.nodeId}` });
      }
    }
    if (!target) continue;
    if (moved) return unresolved(`it runs ${moved} before merging, which the gate cannot follow`);
    if (cwd != null && (!cmd.top || cdBroken)) return unresolved("it merges after a cd outside one && chain, which the gate cannot follow");
    if (target.repo != null && !NUMBERED.test(target.pr ?? "")) return unresolved("it names a repository but no pull request number");
    targets.push({ ...target, cwd, key: `${target.repo ?? ""}#${target.pr}@${cwd ?? ""}` });
  }
  const distinct = [...new Map(targets.map((t) => [t.key, t])).values()];
  if (distinct.length > 1) return unresolved("it merges more than one pull request, or names one in more than one way");
  if (!distinct.length) return mentionsMerge(command) ? unresolved("it holds a merge the gate cannot place (a string another program runs, a heredoc, or a mention); run the merge as its own gh command") : null;
  const { key, ...one } = distinct[0];
  for (const k of ["repo", "cwd"]) if (one[k] == null) delete one[k];
  return one;
}

/**
 * One gh call read from its words, gh at `gh`: the words before it, its
 * positional words, its -f/-F fields, whether it sends --input, the
 * repository it names (or GH_REPO), and its first three positional values.
 */
function readCall(cmd, gh, shellRepo) {
  const before = cmd.slice(0, gh);
  const rest = cmd.slice(gh + 1);
  const own = before.find((w) => /^GH_REPO=/.test(w.v));
  let repo = own ? (own.expands ? "" : own.v.slice("GH_REPO=".length)) : shellRepo;
  const positional = [];
  const fields = [];
  let input = false;
  let host = null;
  for (let i = 0; i < rest.length; i++) {
    const v = rest[i].v;
    if (v === "-R" || v === "--repo") repo = rest[++i] ? (rest[i].expands ? "" : rest[i].v) : "";
    else if (v.startsWith("--repo=") || /^-R./.test(v)) repo = rest[i].expands ? "" : v.slice(v.startsWith("-R") ? 2 : "--repo=".length);
    else if (FIELD_FLAGS.has(v)) {
      if (rest[i + 1]) fields.push(field(rest[i + 1], rest[++i].v));
    } else if (/^--(?:raw-)?field=/.test(v)) fields.push(field(rest[i], v.slice(v.indexOf("=") + 1)));
    else if (/^-[fF]./.test(v)) fields.push(field(rest[i], v.slice(2)));
    else if (v === "--input") input = Boolean(++i);
    else if (v.startsWith("--input=")) input = true;
    else if (v === "--hostname" || v.startsWith("--hostname=")) host = v === "--hostname" ? rest[++i]?.v ?? "" : v.slice(11);
    else if (VALUED.has(v)) i++;
    else if (!v.startsWith("-")) positional.push(rest[i]);
  }
  const [sub, verb, arg] = positional.map((w) => w.v);
  return { before, positional, fields, input, repo, host, sub, verb, arg };
}

/**
 * Whether the command's text, quotes and escapes dropped, still holds a merge
 * the parser placed nowhere: gh with `pr merge`, a REST `pulls/…/merge`, or a
 * GraphQL merge mutation. The backstop for a string another program runs
 * (`node -e`, `| sh`, a here-string) and for a mere mention, both refused:
 * fail-closed where the gate cannot see.
 */
export function mentionsMerge(command) {
  const text = command.replace(/['"\\]/g, "");
  // gh, pr and merge as whole words: a branch named …-merge-…, gh-pages or a JSON field is none of them.
  const end = "(?![^\\s)`;&|])";
  if (!new RegExp(`(?<![^\\s(\`/])gh${end}`).test(text)) return false;
  return (
    new RegExp(`(?<![^\\s(\`/])gh${end}[^;&|\\n]*?\\spr${end}[^;&|\\n]*?\\smerge${end}`).test(text) ||
    /pulls\/[^\s/]*\/merge(?![\w-])/.test(text) ||
    (MERGE_MUTATION.test(text) && /\bgraphql\b/.test(text))
  );
}

/** The directory gh runs in for this merge: the hook's, or where a literal `cd` before the merge moved it. */
export function ghCwd(dir, target, home = homedir()) {
  if (target?.cwd == null) return dir;
  return resolve(dir, target.cwd.replace(/^~(?=\/|$)/, home));
}

/**
 * The number of the PR behind a GraphQL node id, read in one call; a node that
 * is not a pull request, or a failed read, throws, and the merge is refused (a
 * cloud session has no GraphQL, so there it always is). SPECKIT_PR_STATE
 * answers instead for the eval cases.
 */
export async function prOfNode(nodeId, gh, env = process.env) {
  if (env.SPECKIT_PR_STATE) return String(JSON.parse(env.SPECKIT_PR_STATE).number);
  const out = await gh(["api", "graphql", "-f", "query=query($id: ID!) { node(id: $id) { __typename ... on PullRequest { number } } }", "-f", `id=${nodeId}`, "--jq", ".data.node"]);
  if (out.code !== 0) throw new Error(String(out.stderr).trim());
  const node = JSON.parse(String(out.stdout).trim() || "null");
  if (node?.__typename !== "PullRequest" || !Number.isInteger(node.number) || node.number < 1) throw new Error(`${nodeId} is not a pull request`);
  return String(node.number);
}

/**
 * The refusal for this PR, or null when it may merge. `carry` reads what a
 * carried verdict needs: `description(head)`, since gh's rollup never carries
 * a status description, and `state(from, head)` for judgeCarry. `provenance`
 * (from prefetchProvenance) judges who wrote each success; the entry point
 * always passes it, and leaving it out skips that check.
 */
export function decideMerge(pr, carry, provenance) {
  if (pr.state && pr.state !== "OPEN") return null;
  const checks = pr.statusCheckRollup ?? [];
  const sha = String(pr.headRefOid ?? "").slice(0, 7);
  const review = checks.find((c) => (c.context ?? c.name) === "agent-review");
  if (hasAgentReview(checks)) return carryRefusal(pr, review, sha, carry) ?? ciRefusal(pr, checks, sha) ?? provenanceRefusal(pr, sha, provenance);
  if (!review && isDependabot(pr)) return ciRefusal(pr, checks, sha, { dependabot: true });
  const said = review ? `agent-review is ${String(review.state ?? review.conclusion).toLowerCase()}` : "there is no agent-review status";
  return `PR #${pr.number} cannot merge: on its head commit ${sha} ${said}. Run the PR tester (/speckit-pr-test ${pr.number}), fix every blocking finding, and merge on an agent-review success.`;
}

/** Why a carried agent-review success does not hold, or null when it holds or is not a carry. */
function carryRefusal(pr, review, sha, carry) {
  let description = review.description;
  if (description == null && carry) {
    try {
      description = carry.description(pr.headRefOid);
    } catch (e) {
      return `PR #${pr.number} cannot merge: could not read the agent-review status on ${sha} to tell a carried verdict from a tested one (${e.message}). Try the merge again.`;
    }
  }
  const from = carriedFrom(description);
  if (!from) return null;
  const rerun = `Run the PR tester (/speckit-pr-test ${pr.number}) for a real lap on this head.`;
  // A commit off main, before the branch, was tested for another PR.
  if (!(pr.commits ?? []).some((c) => String(c.oid ?? "").startsWith(from)))
    return `PR #${pr.number} cannot merge: agent-review on ${sha} is carried from ${from.slice(0, 7)}, which is not one of this PR's commits. ${rerun}`;
  let state;
  try {
    if (!carry) throw new Error("no way to read GitHub");
    state = carry.state(from, pr.headRefOid);
  } catch (e) {
    return `PR #${pr.number} cannot merge: agent-review on ${sha} is carried from ${from.slice(0, 7)}, and the gate could not verify it (${e.message}). ${rerun}`;
  }
  const why = judgeCarry({ from, head: pr.headRefOid, kind: carryKind(description), ...state });
  return why ? `PR #${pr.number} cannot merge: agent-review on ${sha} is carried from ${from.slice(0, 7)}, but ${why}. ${rerun}` : null;
}

/** Why a success on head (or the commit a carry names) may be the PR's own doing, or null. */
function provenanceRefusal(pr, sha, provenance) {
  if (provenance === undefined) return null;
  let why;
  try {
    if (!provenance) throw new Error("nothing was read");
    why = provenance.judge();
  } catch (e) {
    return `PR #${pr.number} cannot merge: could not verify who wrote agent-review on ${sha} (${e.message}). Try the merge again.`;
  }
  return why ? `PR #${pr.number} cannot merge: ${why}. Run the PR tester (/speckit-pr-test ${pr.number}) for a lap the PR cannot write itself.` : null;
}

/** Why CI does not yet allow the merge, or null when every other check is green. */
function ciRefusal(pr, checks, sha, { dependabot = false } = {}) {
  // A check re-run or cancelled by a newer run appears once per run: judge the latest only.
  // gh dates a run that has not started 0001-01-01, so an unfinished run counts as the newest;
  // a run cancelled before it started is finished and keeps that date, the oldest.
  const when = (c) => (c.status && c.status !== "COMPLETED" ? Infinity : Date.parse(c.startedAt ?? c.createdAt ?? "") || 0);
  // Jobs in different workflows may share a name; a status context has one entry per context.
  const key = (c) => c.context ?? `${c.workflowName ?? ""}\u0000${c.name}`;
  // A skip never outranks a run that did something (other than be cancelled), whatever the
  // order: E2E runs on demand, and a later PR run on the same head skips it again, which
  // must not hide the on-demand run's result.
  const ran = (c) => c.conclusion !== "SKIPPED" && c.conclusion !== "CANCELLED";
  const outranks = (c, cur) => {
    if (c.conclusion === "SKIPPED" && ran(cur)) return false;
    if (cur.conclusion === "SKIPPED" && ran(c)) return true;
    return when(c) >= when(cur);
  };
  // Neither the PR QA run (judged through agent-review) nor a Mutation run (never part of a task) is CI,
  // and an orphaned earlier attempt is decided by its newer completed one.
  const orphans = new Set(orphanedChecks(checks));
  const latest = new Map();
  for (const c of checks) {
    const k = key(c);
    if (!orphans.has(c) && checkName(c) !== "agent-review" && c.workflowName !== QA_WORKFLOW && !isMutationCheck(c) && (!latest.has(k) || outranks(c, latest.get(k)))) latest.set(k, c);
  }
  const ci = [...latest.values()];
  const result = (c) => c.conclusion ?? c.state;
  const pending = ci.filter((c) => (c.status && c.status !== "COMPLETED") || c.state === "PENDING" || c.state === "EXPECTED" || result(c) == null);
  const red = ci.filter((c) => !pending.includes(c) && !GREEN.has(result(c)));
  const list = (cs) => cs.map((c) => (c.workflowName ? `${c.workflowName} / ${c.name}` : checkName(c))).join(", ");
  if (red.length && dependabot)
    return `PR #${pr.number} cannot merge: CI failed on ${sha} (${list(red)}). It is a Dependabot PR, which merges without an agent review only while Dependabot alone commits to it: a commit pushed to its branch takes the exemption away. Read gh pr checks ${pr.number}; for a flaky or outdated run, comment "@dependabot rebase" or "@dependabot recreate"; for a real break, close it and make the bump in a PR of your own.`;
  if (red.length) return `PR #${pr.number} cannot merge: CI failed on ${sha} (${list(red)}). Read gh pr checks ${pr.number}, fix it on the branch, and run the PR tester again on the new head.`;
  if (pending.length) return `PR #${pr.number} cannot merge yet: CI is still running on ${sha} (${list(pending)}). Wait for gh pr checks ${pr.number} --watch, in the background, and merge when it is green.`;
  // A required check is a check run: anyone with write access can post a commit status of the same name.
  const missing = REQUIRED_CHECKS.find((name) => !ci.some((c) => c.context == null && c.name === name));
  if (missing) return `PR #${pr.number} cannot merge: there is no ${missing} check on ${sha}. Wait for CI (gh pr checks ${pr.number}) before merging.`;
  return null;
}

/** The line naming the orphaned check attempts the CI rule ignored on the PR's head, or null. */
export function orphanNote(pr) {
  return orphanLine(orphanedChecks(pr.statusCheckRollup ?? []), pr.headRefOid);
}

/** gh as a promise of { code, stdout, stderr }, every call stopped when `signal` aborts. */
function ghAsync(cwd, signal) {
  return (args) =>
    new Promise((resolve) =>
      execFile("gh", args, { cwd, encoding: "utf8", signal }, (error, stdout, stderr) =>
        resolve(error ? { code: typeof error.code === "number" ? error.code : 1, stdout: String(stdout ?? ""), stderr: String(stderr || error.message) } : { code: 0, stdout, stderr: "" }),
      ),
    );
}

/**
 * The PR as gh reads it; for one Dependabot opened, with its committers too.
 * A committer read that fails throws like the PR read, so the merge is refused
 * with a retry rather than sent to a PR tester it may not need.
 */
export async function readPr(target, gh, { cloud = process.env.CLAUDE_CODE_REMOTE === "true" } = {}) {
  const raw = process.env.SPECKIT_PR_STATE;
  if (raw) return JSON.parse(raw);
  // GraphQL is a budget every session shares: a numbered PR is read over REST everywhere.
  if (cloud || PR_NUMBER.test(String(target ?? ""))) return readPrRest(target, gh);
  const out = await gh(["pr", "view", ...(target ? [target] : []), "--json", "author,commits,number,state,headRefOid,statusCheckRollup"]);
  if (out.code !== 0) throw new Error(String(out.stderr).trim());
  const pr = JSON.parse(out.stdout);
  if (!openedByDependabot(pr)) return pr;
  const read = await gh(committerArgs(pr.number));
  if (read.code !== 0) throw new Error(`its commits' committers: ${String(read.stderr).trim()}`);
  return withCommitters(pr, () => read.stdout);
}

/** `gh api` output: JSON, or with --jq one JSON value per line; a failed call throws its stderr. */
async function api(gh, args) {
  const out = await gh(["api", ...args]);
  if (out.code !== 0) throw new Error(String(out.stderr).trim());
  if (!args.includes("--jq")) return JSON.parse(out.stdout);
  return String(out.stdout)
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

const upper = (v) => (v == null ? null : String(v).toUpperCase());

const PR_NUMBER = /^(?:https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/)?(\d+)$/;

/** The PR over REST, shaped as `gh pr view --json author,commits,number,state,headRefOid,statusCheckRollup`. */
async function readPrRest(target, gh) {
  const number = PR_NUMBER.exec(String(target ?? ""))?.[1];
  if (!number) throw new Error(`a cloud session reads the PR over REST and needs its PR number in the command, got ${target ? `"${target}"` : "none"}`);
  const p = await api(gh, [`repos/{owner}/{repo}/pulls/${number}`]);
  const sha = p.head.sha;
  const [commits, status, checkRuns, runs, workflows] = await Promise.all([
    api(gh, ["--paginate", `repos/{owner}/{repo}/pulls/${number}/commits?per_page=100`, "--jq", ".[] | {sha, author: .author.login, login: .committer.login, verified: .commit.verification.verified}"]),
    api(gh, [`repos/{owner}/{repo}/commits/${sha}/status?per_page=100`]),
    api(gh, ["--paginate", `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100&filter=all`, "--jq", ".check_runs[] | {id, name, status, conclusion, started_at, suite: .check_suite.id, url: .details_url}"]),
    api(gh, ["--paginate", `repos/{owner}/{repo}/actions/runs?head_sha=${sha}&per_page=100`, "--jq", ".workflow_runs[] | {id, suite: .check_suite_id, workflow: .workflow_id, status}"]),
    api(gh, ["--paginate", "repos/{owner}/{repo}/actions/workflows?per_page=100", "--jq", ".workflows[] | {id, name}"]),
  ]);
  // A run's REST `name` is its run-name (pr-qa.yml names each lap), so the workflow's name comes from the
  // workflow; an earlier attempt of a re-run keeps its own suite, which the listing no longer names, so a
  // check run finds its workflow run by the run id in its details URL first.
  const nameOf = new Map(workflows.map((w) => [w.id, w.name]));
  const byRun = new Map(runs.map((r) => [String(r.id), r.workflow]));
  const bySuite = new Map(runs.map((r) => [r.suite, r.workflow]));
  const workflowOf = (c) => nameOf.get(byRun.get(runIdOf(c.url)) ?? bySuite.get(c.suite)) ?? "";
  // The run's status is its latest attempt's: what tells an orphaned earlier attempt (orphanedChecks).
  const runStatus = new Map(runs.map((r) => [String(r.id), r.status]));
  const attempt = (c) => {
    const runId = runIdOf(c.url);
    return { ...(c.id != null ? { checkRunId: c.id } : {}), ...(runId ? { runId, runStatus: upper(runStatus.get(runId)) } : {}) };
  };
  return {
    id: p.node_id,
    repo: p.base?.repo?.full_name ?? null,
    number: p.number,
    state: upper(p.state),
    headRefOid: sha,
    author: { login: p.user?.login ?? "" },
    commits: commits.map((c) => ({ oid: c.sha, authors: c.author ? [{ login: c.author }] : [], committer: { login: c.login }, verified: c.verified === true })),
    statusCheckRollup: [
      ...(status.statuses ?? []).map((s) => ({ __typename: "StatusContext", context: s.context, state: upper(s.state), description: s.description ?? null })),
      ...checkRuns.map((c) => ({ __typename: "CheckRun", name: c.name, workflowName: workflowOf(c), status: upper(c.status), conclusion: upper(c.conclusion), startedAt: c.started_at, ...attempt(c) })),
    ],
  };
}

/** gh with each distinct call made once, so the carry and the provenance share head's statuses. */
function memoized(gh) {
  const calls = new Map();
  return (args) => {
    const key = args.join("\u0000");
    if (!calls.has(key)) calls.set(key, gh(args));
    return calls.get(key);
  };
}

/** The carry reads over an async gh, each distinct call made once (head's statuses serve both the description and the state). */
export function ghReader(gh) {
  const once = memoized(gh);
  return {
    async description(head) {
      const out = await once(statusesArgs(head));
      if (out.code !== 0) throw new Error(String(out.stderr).trim());
      return latestReview(JSON.parse(out.stdout))?.description ?? null;
    },
    state: (from, head) => fetchCarryState({ from, head, gh: once }),
  };
}

function carryReader(gh) {
  if (!process.env.SPECKIT_PR_STATE) return ghReader(gh);
  const raw = process.env.SPECKIT_CARRY_STATE;
  const delay = Number(process.env.SPECKIT_CARRY_DELAY_MS) || 0;
  return {
    description: async () => null,
    state: async () => {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      if (!raw) throw new Error("SPECKIT_CARRY_STATE is not set");
      return JSON.parse(raw);
    },
  };
}

/**
 * Reads, ahead of decideMerge, what it will ask `reader` for, and returns a
 * synchronous carry over the answers: a failed read throws again where
 * decideMerge asks for it, so it refuses as it always has. Null when the PR
 * has no agent-review success, which needs no carry read.
 */
export async function prefetchCarry(pr, reader) {
  const checks = pr.statusCheckRollup ?? [];
  if ((pr.state && pr.state !== "OPEN") || !hasAgentReview(checks)) return null;
  const settle = (read) => Promise.resolve().then(read).then((value) => ({ value }), (error) => ({ error }));
  const replay = (answer) => () => {
    if (answer.error) throw answer.error;
    return answer.value;
  };
  const review = checks.find((c) => checkName(c) === "agent-review");
  const description = review?.description != null ? { value: review.description } : await settle(() => reader.description(pr.headRefOid));
  const from = description.error ? null : carriedFrom(description.value);
  const state = from ? await settle(() => reader.state(from, pr.headRefOid)) : { error: new Error("not read: no carried verdict") };
  return { description: replay(description), state: replay(state) };
}

/**
 * Reads, ahead of decideMerge, who wrote the success on head and on the
 * commit `from` a carry names, and returns a synchronous judge over the
 * answer: the first refusal, or null; a failed read throws again there.
 * Null when the PR has no agent-review success. `reader.read(shas)` returns
 * readProvenance's shape.
 */
export async function prefetchProvenance(pr, reader, from) {
  if ((pr.state && pr.state !== "OPEN") || !hasAgentReview(pr.statusCheckRollup ?? [])) return null;
  const shas = [pr.headRefOid, ...(from ? [from] : [])];
  let state;
  let error;
  try {
    state = await reader.read(shas);
  } catch (e) {
    error = e;
  }
  return {
    judge() {
      if (error) throw error;
      for (const sha of shas) {
        const why = judgeProvenance({ sha, pr: pr.number, qaWorkflowChanged: state.qaWorkflowChanged, defaultBranch: state.defaultBranch, ...state.bySha[sha] });
        if (why) return why;
      }
      return null;
    },
  };
}

function provenanceReader(gh, pr) {
  if (!process.env.SPECKIT_PR_STATE) return { read: (shas) => readProvenance({ pr: pr.number, shas, gh }) };
  const raw = process.env.SPECKIT_PROVENANCE_STATE;
  return {
    read: async (shas) => {
      if (!raw) throw new Error("SPECKIT_PROVENANCE_STATE is not set");
      const { qaWorkflowChanged = false, defaultBranch = "main", ...one } = JSON.parse(raw);
      return { qaWorkflowChanged, defaultBranch, bySha: Object.fromEntries(shas.map((sha) => [sha, one])) };
    },
  };
}

if (isEntryPoint(import.meta.url)) {
  const refuse = (why) => {
    console.error(`Merge gate (Constitution VII): ${why}`);
    process.exit(2);
  };
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  // Every way out of this handler is an exit: 0 approves, 2 refuses. A throw
  // here would exit 1, which Claude Code reads as a non-blocking error, so it
  // refuses too.
  process.stdin.on("end", async () => {
    try {
      const payload = JSON.parse(raw || "{}");
      const target = mergeTarget(String(payload.tool_input?.command ?? ""));
      if (!target) process.exit(0);
      const byNumber = "Merge with gh pr merge <n>, one PR per command, which the gate can judge.";
      if (target.unresolved) refuse(`cannot tell which PR this command merges, since ${target.unresolved}, so the merge is not approved. ${byNumber}`);
      const which = target.pr ? `PR ${target.pr}` : target.nodeId ? `the PR ${target.nodeId}` : "this branch's PR";
      const limit = deadlineMs();
      const stop = new AbortController();
      // run-hook.mjs's backstop: take the gh calls down with the gate.
      process.once("SIGTERM", () => {
        stop.abort();
        process.exit(2);
      });
      setTimeout(() => {
        stop.abort();
        refuse(`could not finish checking ${which} on GitHub within ${limit / 1000} s, so the merge is not approved. Try the merge again; if GitHub stays this slow, wait and retry rather than merging unchecked.`);
      }, limit);
      const gh = memoized(ghAsync(ghCwd(payload.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), target), stop.signal));
      let pr;
      try {
        pr = await readPr(target.nodeId ? await prOfNode(target.nodeId, gh) : target.pr, gh);
      } catch (e) {
        refuse(`could not read ${which} from GitHub (${e.message}), so the merge is not approved. ${target.nodeId ? byNumber : "Check gh auth status and the PR, then try again."}`);
      }
      // The number alone would judge this repository's PR of that number in place of another repository's node.
      if (target.nodeId && pr.id !== target.nodeId)
        refuse(`${target.nodeId} is not this repository's PR #${pr.number} (its node id is ${pr.id ?? "unknown"}), so the merge is not approved. ${byNumber}`);
      // Likewise a repository the command names (-R, GH_REPO, a URL, a REST path): the read is always this one's.
      if (target.repo != null && String(pr.repo ?? "").toLowerCase() !== target.repo.toLowerCase())
        refuse(`${target.repo || "an empty repository"} is not this repository (${pr.repo ?? "unknown"}), whose PR #${pr.number} the gate read, so the merge is not approved. ${byNumber}`);
      const carry = await prefetchCarry(pr, carryReader(gh));
      let from = null;
      try {
        from = carry ? carriedFrom(carry.description()) : null;
      } catch {
        // decideMerge refuses the unread description itself.
      }
      const why = decideMerge(pr, carry, await prefetchProvenance(pr, provenanceReader(gh, pr), from));
      const note = orphanNote(pr);
      if (!why) {
        // A pipe on macOS is written asynchronously: exit once the line is out.
        if (note) process.stdout.write(`Merge gate (Constitution VII): ${note}.\n`, () => process.exit(0));
        else process.exit(0);
        return;
      }
      refuse(note ? `${why} (Also ${note}.)` : why);
    } catch (e) {
      refuse(`the gate failed (${e.message}), so the merge is not approved. Try again; report it if it repeats.`);
    }
  });
}
