// Claude Code PreToolUse hook (matcher: Edit|Write|MultiEdit) — an adversary
// spec only grows.
//
// A test the test-adversary wrote is evidence against the code; an agent that
// rewrites the file can drop the test that failed instead of fixing the code.
// So a Write, Edit or MultiEdit to an existing `*.adversary.spec.{ts,mts,js,mjs}`
// whose result lacks a `describe(`/`it(`/`test(` title the file has today
// (counted, so one of two equal titles counts; a title inside a comment is no
// test) is refused with exit 2, naming the file and the dropped titles.
// Whoever the author: the file is held, not the agent. The one way out is in
// the file, for the reviewers to see: a test whose rule the spec retired is
// dropped with a `// retired test: "<title>" <why>` line in its place. A new
// file, any other file, and an Edit whose old_string is not in the file (the
// tool refuses that itself) go through. Registered fail_closed: a
// crash refuses the edit.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isEntryPoint } from "../scripts/lib/entry.mjs";

const ADVERSARY = /\.adversary\.spec\.[cm]?[jt]s$/;
const TITLE = /\b(?:describe|it|test)(?:\.\w+)*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

const RETIRED = /^[ \t]*\/\/ retired test: "((?:\\.|[^"\\])*)"/gm;

/** `text` with its line and block comments blanked, strings and regex literals left as they are. */
export function uncommented(text) {
  let out = "";
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (!quote && c === "/" && text[i + 1] !== "/" && text[i + 1] !== "*" && /(?:^|[(,=:[!&|?{};])\s*$/.test(out.slice(-80))) {
      // A regex literal: copied through its closing slash, a class's brackets and escapes included.
      let inClass = false;
      out += c;
      while (++i < text.length && text[i] !== "\n") {
        out += text[i];
        if (text[i] === "\\") out += text[++i] ?? "";
        else if (text[i] === "[") inClass = true;
        else if (text[i] === "]") inClass = false;
        else if (text[i] === "/" && !inClass) break;
      }
      if (text[i] === "\n") out += "\n";
      continue;
    }
    if (quote) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === quote) quote = null;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
      out += " ";
    } else {
      if (c === "'" || c === '"' || c === "`") quote = c;
      out += c;
    }
  }
  return out;
}

const titles = (text) => [...uncommented(String(text)).matchAll(TITLE)].map((m) => m[2]);

/** The titles of `before` that `after` holds fewer times than `before` does, a retired-test line counting as the title it names. */
export function droppedTests(before, after) {
  const left = new Map();
  const retired = [...String(after).matchAll(RETIRED)].map((m) => m[1].replace(/\\(.)/g, "$1"));
  for (const t of [...titles(after), ...retired]) left.set(t, (left.get(t) ?? 0) + 1);
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
  return `adversary-keep-gate: ${path} would lose ${dropped.map((t) => `"${t}"`).join(", ")}. An adversary spec only grows: append or add a file, never remove a test. A test that fails is fixed in the code; one whose rule the spec retired leaves \`// retired test: "<title>" <why>\` in its place.`;
}

if (isEntryPoint(import.meta.url)) {
  const payload = JSON.parse(readFileSync(0, "utf8") || "{}");
  const refusal = judge({ tool: payload.tool_name, input: payload.tool_input ?? {} });
  if (refusal) {
    console.error(refusal);
    process.exitCode = 2;
  }
}
