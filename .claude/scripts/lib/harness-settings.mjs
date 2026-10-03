// The persisted layer of the harness settings, read by the gates.
//
// Three settings lived only in environment variables (`scripts/lib/hooks.mjs`)
// and two more only in `.claude/hooks/session-context.mjs`. That is fine for a
// one-off `SPECKIT_DISABLED_HOOKS=<id> npm test`, but it means a setting
// changed anywhere else has nowhere to live. This file is that place.
//
// Precedence is environment > this file > the default coded in the gate. The
// file never outranks the environment, so every existing debugging workflow
// keeps working unchanged.
//
// Deliberately tiny and total: it parses, or it returns {}. A corrupt settings
// file must not stop a gate from running.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const settingsPath = (repo) => join(repo, ".specify", "harness-settings.json");

/** The persisted settings object, or {} when absent or unreadable (never throws). */
export function readHarnessSettings(repo) {
  const file = settingsPath(repo);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** The repo a gate should read settings from when its caller did not say. */
export const defaultRepo = () => process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
