// Every hook in settings.json runs through here: `node run-hook.mjs <id>`.
// The wrapper is what makes the registry real — it resolves the id, decides
// whether the gate is armed for the current profile, then execs the script
// with the harness payload piped straight through. Adapted from ECC's
// scripts/hooks/run-with-flags.js.
//
// Failure policy, in two halves. A broken *wrapper* must never break a session:
// unknown id, missing script, malformed registry — all exit 0 with a note on
// stderr. But an unreadable *request* is the opposite case. A gate that cannot
// see the command it is meant to judge has not approved it, and the four gates
// that can refuse all used to read a parse failure as consent:
//
//     } catch { process.exit(0); }          // bash-guard.mjs, and three more
//
// so a payload too large to arrive intact passed every one of them silently.
// ECC hit the same thing and added ECC_HOOK_INPUT_MAX_BYTES plus an explicit
// `truncated -> exit 2` ("blocking because safety checks require the complete
// request"). Same rule here, in one place rather than four: this wrapper owns
// stdin, so it caps the read and refuses on behalf of any entry marked
// `fail_closed` in the registry. Advisory hooks are passed the bytes unchanged
// — refusing a stop because the telemetry payload was long helps nobody.
//
// Empty stdin is deliberately not a refusal: it is a different condition from
// "arrived corrupted", the hooks already handle it, and treating it as one
// would mean a gate refused every time it was invoked by hand.
//
//   SPECKIT_HOOK_PROFILE=off|standard|strict   pick the armed set
//   SPECKIT_DISABLED_HOOKS=id,id               silence individual gates
//   SPECKIT_HOOKS_DRY_RUN=1                    report blocks instead of blocking
//   SPECKIT_HOOK_INPUT_MAX_BYTES=N             cap the payload a gate will read
//   SPECKIT_HOOK_TIMEOUT_MS=N                  shorten an entry's timeout_ms
//
// A gate that runs too long is the same case again. Claude Code does not
// block on a hook it stopped for its timeout, so an entry with `timeout_ms`
// is stopped here first, inside the hook timeout settings.json gives it, and a
// fail-closed gate stopped that way (or by any signal) is refused, not passed.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { hookById, isDryRun, isEnabled, scriptPath } from "../scripts/lib/hooks.mjs";

const repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const id = process.argv[2];
const note = (msg) => process.stderr.write(`[run-hook] ${msg}\n`);

const entry = hookById(repo, id);
if (!entry) {
  note(`no registry entry for "${id}" — not running anything (see .claude/hooks/registry.json)`);
  process.exit(0);
}

const { enabled, reason } = isEnabled(entry);
if (!enabled) {
  if (process.env.SPECKIT_HOOKS_VERBOSE) note(`${entry.id} skipped: ${reason}`);
  process.exit(0);
}

const script = scriptPath(repo, entry);
if (!existsSync(script)) {
  note(`${entry.id}: ${entry.script} is missing — gate not enforced`);
  process.exit(0);
}

// 1 MiB. Large enough for any tool_input this repo produces (the biggest is a
// Write of a whole file), small enough that a runaway payload is caught rather
// than buffered. Overridable so a gate can be widened without editing it.
const maxInput = Number(process.env.SPECKIT_HOOK_INPUT_MAX_BYTES) || 1024 * 1024;

let raw = "";
let overflowed = false;
process.stdin.on("data", (d) => {
  if (overflowed) return;
  raw += d;
  if (raw.length > maxInput) {
    overflowed = true;
    raw = raw.slice(0, maxInput);
  }
});
process.stdin.on("end", () => {
  // Why this gate could not read the request, or null when it could. Only
  // asked for fail-closed entries: an advisory hook gets whatever arrived.
  const unreadable = () => {
    if (overflowed) return `payload exceeded ${maxInput} bytes (SPECKIT_HOOK_INPUT_MAX_BYTES)`;
    if (raw.trim() === "") return null;
    try {
      JSON.parse(raw);
      return null;
    } catch (err) {
      return `payload is not valid JSON (${err.message})`;
    }
  };

  const why = entry.fail_closed ? unreadable() : null;
  if (why) {
    const refusal = `${entry.id} refused: ${why}. A gate that cannot read the request has not approved it — retry with a smaller payload, or disable this gate by id if you mean to proceed unchecked.`;
    if (isDryRun()) {
      note(`DRY RUN — ${refusal}`);
      process.exit(0);
    }
    process.stderr.write(`[run-hook] ${refusal}\n`);
    process.exit(2);
  }

  const interpreter = entry.script.endsWith(".sh") ? "bash" : process.execPath;
  const own = Number(entry.timeout_ms) > 0 ? Number(entry.timeout_ms) : undefined;
  const asked = Number(process.env.SPECKIT_HOOK_TIMEOUT_MS);
  const timeout = own && asked > 0 && asked < own ? asked : own;
  const run = spawnSync(interpreter, [script], {
    cwd: repo,
    input: raw,
    encoding: "utf8",
    env: { ...process.env, SPECKIT_HOOK_ID: entry.id },
    timeout,
  });

  const timedOut = run.error?.code === "ETIMEDOUT";
  if (entry.fail_closed && (timedOut || run.signal)) {
    const how = timedOut ? `did not finish within ${timeout / 1000} s` : `was stopped by ${run.signal}`;
    const refusal = `${entry.id} refused: the gate ${how}, so it has not approved the request. Try again; if it keeps running long, find out why before disabling it by id.`;
    process.stderr.write(run.stderr ?? "");
    if (isDryRun()) {
      note(`DRY RUN — ${refusal}`);
      process.exit(0);
    }
    process.stderr.write(`[run-hook] ${refusal}\n`);
    process.exit(2);
  }

  if (run.error) {
    note(`${entry.id}: could not run ${entry.script} (${run.error.message}) — gate not enforced`);
    process.exit(0);
  }

  const code = run.status ?? 0;
  if (isDryRun() && code !== 0) {
    process.stdout.write(run.stdout ?? "");
    note(`DRY RUN — ${entry.id} would have blocked (exit ${code}):`);
    process.stderr.write(run.stderr ?? "");
    process.exit(0);
  }

  process.stdout.write(run.stdout ?? "");
  process.stderr.write(run.stderr ?? "");
  process.exit(code);
});
