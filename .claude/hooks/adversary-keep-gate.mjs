// Claude Code PreToolUse hook (matcher: Edit|Write|MultiEdit) — an adversary
// spec only grows (1363-FR-007).
//
// A test the test-adversary wrote is evidence against the code; an agent that
// rewrites the file can drop the test that failed instead of fixing the code.
// So a Write, Edit or MultiEdit to an existing `*.adversary.spec.{ts,mts,js,mjs}`
// whose result lacks a `describe(`/`it(`/`test(` title the file has today
// (counted, so one of two equal titles counts) is refused with exit 2, naming
// the file and the dropped titles. Whoever the author: the file is held, not
// the agent. A new file, any other file, and an Edit whose old_string is not in
// the file (the tool refuses that itself) go through. Registered fail_closed: a
// crash refuses the edit.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isEntryPoint } from "../scripts/lib/entry.mjs";

const ADVERSARY = /\.adversary\.spec\.[cm]?[jt]s$/;
const TITLE = /\b(?:describe|it|test)(?:\.\w+)*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

const titles = (text) => [...String(text).matchAll(TITLE)].map((m) => m[2]);

/** The titles of `before` that `after` holds fewer times than `before` does. */
export function droppedTests(before, after) {
  const left = new Map();
  for (const t of titles(after)) left.set(t, (left.get(t) ?? 0) + 1);
  const dropped = [];
  for (const t of titles(before)) {
    const n = left.get(t) ?? 0;
    if (n > 0) left.set(t, n - 1);
    else dropped.push(t);
  }
  return dropped;
}

const replace = (text, { old_string: from, new_string: to = "", replace_all: all }) =>
  typeof from === "string" && from !== "" && text.includes(from) ? (all ? text.split(from).join(to) : text.replace(from, () => to)) : text;

/** The file's content once the tool has run, or null when the tool is not one that writes it. */
export function afterTool(tool, input, before) {
  if (tool === "Write") return String(input.content ?? "");
  if (tool === "Edit") return replace(before, input);
  if (tool === "MultiEdit") return (input.edits ?? []).reduce(replace, before);
  return null;
}

/** null to let the tool through, or the refusal to print. */
export function judge({ tool, input, cwd = process.cwd() }) {
  const path = input?.file_path;
  if (typeof path !== "string" || !ADVERSARY.test(path)) return null;
  const file = resolve(cwd, path);
  if (!existsSync(file)) return null;
  const before = readFileSync(file, "utf8");
  const after = afterTool(tool, input, before);
  if (after === null) return null;
  const dropped = droppedTests(before, after);
  if (!dropped.length) return null;
  return `adversary-keep-gate: ${path} would lose ${dropped.map((t) => `"${t}"`).join(", ")}. An adversary spec only grows: append or add a file, never remove a test (1363-FR-007). A test that fails is fixed in the code.`;
}

if (isEntryPoint(import.meta.url)) {
  const payload = JSON.parse(readFileSync(0, "utf8") || "{}");
  const refusal = judge({ tool: payload.tool_name, input: payload.tool_input ?? {} });
  if (refusal) {
    console.error(refusal);
    process.exitCode = 2;
  }
}
