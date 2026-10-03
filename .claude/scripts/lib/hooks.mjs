// The hook registry — one file that knows every gate's id, event, script,
// description, strictness profile and content fingerprint. Borrowed from ECC
// (hooks/hooks.metadata.json + scripts/hooks/run-with-flags.js): hooks wired
// inline in settings.json are anonymous, undocumented and all-or-nothing, so
// the only way to debug a misfiring gate is to comment JSON out and forget to
// put it back.
//
// Three things the registry buys:
//   - ids + descriptions: `node scripts/doctor.mjs` can list what is armed
//   - profiles: SPECKIT_HOOK_PROFILE=off|standard|strict picks a set, and
//     SPECKIT_DISABLED_HOOKS=id,id turns one off without editing settings
//   - fingerprints: doctor notices when a gate's script was edited, which is
//     the one change a weakened gate always needs
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultRepo, readHarnessSettings } from "./harness-settings.mjs";

export const PROFILES = ["off", "standard", "strict"];

export const registryPath = (repo) => join(repo, ".claude", "hooks", "registry.json");

/** Parsed registry, or null when it is missing/malformed (never throws). */
export function loadRegistry(repo) {
  const file = registryPath(repo);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed?.hooks) ? parsed : null;
  } catch {
    return null;
  }
}

export function hookById(repo, id) {
  return loadRegistry(repo)?.hooks.find((h) => h.id === id) ?? null;
}

/** Absolute path of a registry entry's script. */
export const scriptPath = (repo, entry) => join(repo, ".claude", "hooks", entry.script);

/** First 12 hex of the file's sha256 — short enough to read in a diff. */
export function fingerprint(file) {
  if (!existsSync(file)) return null;
  return createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 12);
}

// Each of the three below reads, in order: the environment variable, then the
// persisted settings file, then the built-in default. The file is the layer the
// dashboard writes; it never outranks the environment, so
// `SPECKIT_DISABLED_HOOKS=<id> npm test` keeps behaving exactly as it always has.
//
// An empty value counts as unset. `SPECKIT_HOOK_PROFILE= npm test` leaves the
// variable defined but blank, and reading that as "set" would mean the gates
// silently take a default while the dashboard reports the file's value as
// effective — two answers to the same question.
const fromEnv = (env, key) => {
  const raw = env[key];
  return raw === undefined || raw === "" ? undefined : raw;
};

export function profileOf(env = process.env, repo = defaultRepo()) {
  const raw = fromEnv(env, "SPECKIT_HOOK_PROFILE") ?? readHarnessSettings(repo).hookProfile ?? "standard";
  const p = String(raw).trim().toLowerCase();
  return PROFILES.includes(p) ? p : "standard";
}

export function disabledIds(env = process.env, repo = defaultRepo()) {
  const raw = fromEnv(env, "SPECKIT_DISABLED_HOOKS");
  if (raw === undefined) {
    const persisted = readHarnessSettings(repo).disabledHooks;
    return new Set(Array.isArray(persisted) ? persisted.map(String).filter(Boolean) : []);
  }
  return new Set(
    raw.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export const isDryRun = (env = process.env, repo = defaultRepo()) => {
  const raw = fromEnv(env, "SPECKIT_HOOKS_DRY_RUN");
  if (raw === undefined) return readHarnessSettings(repo).hooksDryRun === true;
  return /^(1|true|yes|on)$/i.test(raw);
};

/**
 * Should this hook run? Returns { enabled, reason } — reason is for humans
 * reading a dry-run or doctor report, never for the model.
 */
export function isEnabled(entry, env = process.env, repo = defaultRepo()) {
  if (!entry) return { enabled: false, reason: "not in the registry" };
  const profile = profileOf(env, repo);
  // Name the source that actually won, not the environment variable: these
  // reasons are read by humans in a dry-run or doctor report, and since the
  // dashboard can persist the same settings to .specify/harness-settings.json,
  // blaming an unset variable would send them looking in the wrong place.
  const via = (key) => (fromEnv(env, key) === undefined ? ".specify/harness-settings.json" : key);
  if (profile === "off") return { enabled: false, reason: `profile off (${via("SPECKIT_HOOK_PROFILE")})` };
  if (disabledIds(env, repo).has(entry.id))
    return { enabled: false, reason: `disabled by id (${via("SPECKIT_DISABLED_HOOKS")})` };
  const profiles = entry.profiles ?? ["standard", "strict"];
  if (!profiles.includes(profile))
    return { enabled: false, reason: `not in profile "${profile}" (runs in: ${profiles.join(", ")})` };
  return { enabled: true, reason: `profile ${profile}` };
}
