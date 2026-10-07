// How a TypeScript file resolves its relative imports, read from the tsconfig
// that governs it rather than guessed from its path: the nearest tsconfig.json
// in its directory or an ancestor up to the repo root, with `compilerOptions`
// merged along its relative `extends` chain (the child's value wins).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const NODE = /^node(next|16)$/i;

/** tsconfig is JSONC: drop comments outside strings, then trailing commas. */
function parseJsonc(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/** `compilerOptions` of one tsconfig, its relative `extends` merged beneath it. */
function compilerOptions(file, seen = new Set()) {
  if (seen.has(file) || !existsSync(file)) return {};
  seen.add(file);
  let config;
  try {
    config = parseJsonc(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
  // A package `extends` (e.g. @tsconfig/node20) is not followed: none here.
  const bases = [config.extends ?? []].flat().filter((e) => typeof e === "string" && e.startsWith("."));
  const inherited = bases.map((e) => {
    const target = resolve(dirname(file), e);
    return compilerOptions(existsSync(target) || target.endsWith(".json") ? target : `${target}.json`, seen);
  });
  return Object.assign({}, ...inherited, config.compilerOptions ?? {});
}

/** The nearest tsconfig.json to a repo-relative file, or null at the repo root without one. */
function nearestTsconfig(repo, file) {
  const root = resolve(repo);
  for (let dir = dirname(resolve(root, file)); ; dir = dirname(dir)) {
    const candidate = join(dir, "tsconfig.json");
    if (existsSync(candidate)) return candidate;
    if (dir === root || dir === dirname(dir)) return null;
  }
}

/**
 * "nodenext" when relative imports need the literal `.js`, "bundler" when they
 * must not have it, null when the governing tsconfig says neither (or none).
 */
export function importStyle(repo, file) {
  const tsconfig = nearestTsconfig(repo, file);
  if (!tsconfig) return null;
  const { module, moduleResolution } = compilerOptions(tsconfig);
  if (typeof moduleResolution === "string") {
    if (NODE.test(moduleResolution)) return "nodenext";
    return /^bundler$/i.test(moduleResolution) ? "bundler" : null;
  }
  return typeof module === "string" && NODE.test(module) ? "nodenext" : null;
}
