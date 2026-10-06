#!/usr/bin/env node
// One gh command, through REST in a Claude Code cloud session, where GitHub
// answers gh's GraphQL with 403 (lib/gh-rest.mjs): pr list|view|create|edit|
// ready|comment|checks (with --watch) and label create. Anything else, and
// everything outside the cloud, is plain gh. Exit code, stdout and stderr are gh's.
//
//   node .claude/scripts/gh.mjs pr checks 160 --json name,bucket --jq '.[] | select(.bucket != "pass")'

import { isEntryPoint } from "./lib/entry.mjs";
import { ghRun } from "./lib/gh-rest.mjs";

export function main(argv, { stdout = (s) => process.stdout.write(s), stderr = (s) => process.stderr.write(s), ...io } = {}) {
  const r = ghRun(argv, io);
  if (r.stdout) stdout(r.stdout);
  if (r.stderr) stderr(r.stderr);
  return r.code;
}

if (isEntryPoint(import.meta.url)) process.exitCode = main(process.argv.slice(2));
