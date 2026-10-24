#!/usr/bin/env node
// Branch protection on main: GitHub itself refuses a merge without
// `agent-review` success and `CI OK` (AGENTS.md step 7), for the
// owner too (enforce_admins), so the rule no longer rests on the merge gate
// running in the right session.
//
//   node .claude/scripts/branch-protection.mjs apply   # PUT the protection, then check it
//   node .claude/scripts/branch-protection.mjs check   # exit 1 naming what main lacks
//
// A workflow's token cannot administer a branch, so both run on the laptop
// with george-hutanu's token (GH_TOKEN, else `gh auth token -u george-hutanu`),
// never in a cloud session, whose proxy token cannot either. Not strict: a PR
// behind main is not made to merge it (AGENTS.md step 5). Exit 0 ok, 1 refused
// or GitHub said no, 64 usage.
import { isEntryPoint } from "./lib/entry.mjs";
import { spawnRun } from "./lib/gh-rest.mjs";

const REPO = "george-hutanu/motor-fix";
const PATH = `repos/${REPO}/branches/main/protection`;
export const REQUIRED = Object.freeze(["CI OK", "agent-review"]);
export const BODY = {
  required_status_checks: { strict: false, contexts: [...REQUIRED] },
  enforce_admins: true,
  required_pull_request_reviews: null,
  restrictions: null,
  allow_force_pushes: false,
  allow_deletions: false,
};

/** What main's protection lacks, from a GET of it: one entry per missing rule. */
export function missing(protection) {
  const listed = protection?.required_status_checks?.contexts;
  const contexts = Array.isArray(listed) ? listed : [];
  const lacks = REQUIRED.filter((c) => !contexts.includes(c)).map((c) => `required check ${c}`);
  if (protection?.enforce_admins?.enabled !== true) lacks.push("enforce_admins (administrators are exempt)");
  return lacks;
}

/** Run for `argv` ([apply|check]); returns the exit code. `run(file, args, { env, input })` is spawnRun's. */
export function main(argv, { run = (file, args, opts) => spawnRun({ env: opts.env })(file, args, opts), env = process.env, log = console.log } = {}) {
  const verb = argv[0];
  if (verb !== "apply" && verb !== "check") {
    log("usage: branch-protection.mjs apply|check");
    return 64;
  }
  if (env.CLAUDE_CODE_REMOTE === "true") {
    log("branch-protection: a cloud session's token cannot administer the branch; run it on the laptop.");
    return 1;
  }
  let token = env.GH_TOKEN?.trim();
  if (!token) {
    const { GH_TOKEN, GITHUB_TOKEN, ...rest } = env;
    const r = run("gh", ["auth", "token", "-u", "george-hutanu"], { env: rest });
    token = r.code === 0 ? r.stdout.trim() : "";
  }
  if (!token) {
    log("branch-protection: no GH_TOKEN and no gh login for george-hutanu; run `gh auth login` for george-hutanu.");
    return 1;
  }
  const ghEnv = { ...env, GH_TOKEN: token };
  if (verb === "apply") {
    const put = run("gh", ["api", "-X", "PUT", PATH, "--input", "-"], { env: ghEnv, input: JSON.stringify(BODY) });
    if (put.code !== 0) {
      log(`branch-protection: GitHub refused the protection: ${put.stderr.trim()}`);
      return 1;
    }
  }
  const got = run("gh", ["api", PATH], { env: ghEnv });
  if (got.code !== 0) {
    log(`branch-protection: main is not protected as required (${got.stderr.trim() || "no answer"}): run apply.`);
    return 1;
  }
  let protection;
  try {
    protection = JSON.parse(got.stdout);
  } catch {
    log(`branch-protection: main is not protected as required (GitHub's answer was not JSON): run apply.`);
    return 1;
  }
  const lacks = missing(protection);
  if (lacks.length) {
    log(`branch-protection: main lacks ${lacks.join(", ")}${verb === "check" ? ": run apply." : "."}`);
    return 1;
  }
  log(`branch-protection: main requires ${REQUIRED.join(" and ")}, administrators included.`);
  return 0;
}

if (isEntryPoint(import.meta.url)) process.exitCode = main(process.argv.slice(2));
