#!/usr/bin/env node
// How long each spec took in Jest, so the post-edit hook (post-edit-check.sh)
// runs only the fast ones (ST-1355). A spec runs when it has no record, its
// record is under 5 s, or the record is older than 7 days; a slow one is left
// to the Stop gate's jest --onlyChanged. The time is Jest's own, never the wait
// for a heavy slot.
//
//   node .claude/scripts/lib/spec-durations.mjs should <spec>     exit 0 run, 1 skip
//   node .claude/scripts/lib/spec-durations.mjs record <spec> <ms>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { isEntryPoint } from "./entry.mjs";

export const STORE = ".specify/.cache/spec-durations.json";
const SLOW_MS = 5000;
const FRESH_MS = 7 * 24 * 60 * 60 * 1000;

const load = (file) => {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  } catch {
    return {};
  }
};

export function shouldRunSpec(spec, store, now = Date.now()) {
  const r = store[spec];
  return !r || !(r.ms >= SLOW_MS) || now - Date.parse(r.at) > FRESH_MS;
}

export function recordDuration(file, spec, ms, now = new Date()) {
  const store = load(file);
  store[spec] = { ms, at: now.toISOString() };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`);
}

if (isEntryPoint(import.meta.url)) {
  const [cmd, spec, ms] = process.argv.slice(2);
  if (cmd === "should" && spec) process.exit(shouldRunSpec(spec, load(STORE)) ? 0 : 1);
  else if (cmd === "record" && spec && Number.isFinite(Number(ms)) && ms !== "") recordDuration(STORE, spec, Number(ms));
  else {
    console.error("usage: spec-durations.mjs should <spec> | record <spec> <ms>");
    process.exit(2);
  }
}
