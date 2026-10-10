// Keeps retired names out of the repository. scripts/banned-words.json lists
// the words and, per file, how many mentions it may still hold and why: a
// history record, or a path kept until a named follow-up deletes it.
//
// Every file git tracks is counted, its path and its text, case-insensitive;
// the list itself is not. The check fails on
//
//   1. a file with mentions that the list does not name;
//   2. a listed file holding more mentions than its count;
//   3. a listed file holding fewer, or gone (stale: lower or drop the entry);
//   4. an entry with no reason;
//   5. with --base <ref>, a word the ref's list banned and this one drops, an
//      entry the ref's list lacks, or a count above the ref's.
//
// So the list only shrinks: a pull request can remove a mention, never add one.
//
//   node scripts/banned-words.ts [--base <ref>]

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

export type Entry = { count: number; reason: string };
export type BannedList = { words: string[]; allow: Record<string, Entry> };
export type Base = { ref: string; list: BannedList | null };

const LIST = 'scripts/banned-words.json';

// A git hook exports GIT_DIR and GIT_INDEX_FILE; git here must find the
// repository from its working directory instead.
const gitEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  );

const escapeRegExp = (word: string) =>
  word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function countMentions(
  path: string,
  text: string,
  words: string[],
): number {
  let total = 0;
  for (const word of words) {
    const pattern = new RegExp(escapeRegExp(word), 'gi');
    total +=
      (path.match(pattern)?.length ?? 0) + (text.match(pattern)?.length ?? 0);
  }
  return total;
}

const byPath = <T>(entries: Iterable<[string, T]>) =>
  [...entries].sort(([a], [b]) => a.localeCompare(b));

// A file holding more mentions than the list allows it.
function overErrors(files: Map<string, number>, list: BannedList): string[] {
  const errors: string[] = [];
  for (const [path, count] of byPath(files)) {
    const allowed = list.allow[path]?.count ?? 0;
    if (count <= allowed) continue;
    errors.push(
      allowed
        ? `${path}: ${count} banned-word mention(s), ${allowed} allowed by ${LIST}; remove the new ones`
        : `${path}: ${count} banned-word mention(s) (${list.words.join(', ')}); remove them — ${LIST} lists only history`,
    );
  }
  return errors;
}

// An entry above what its file holds, or without a reason.
function entryErrors(files: Map<string, number>, list: BannedList): string[] {
  const errors: string[] = [];
  for (const [path, entry] of byPath(Object.entries(list.allow))) {
    const count = files.get(path) ?? 0;
    if (count < entry.count)
      errors.push(
        `stale: ${path} holds ${count} banned-word mention(s), ${LIST} allows ${entry.count}; lower or drop the entry`,
      );
    if (typeof entry.reason !== 'string' || !entry.reason.trim())
      errors.push(`${path}: its ${LIST} entry has no reason`);
  }
  return errors;
}

// The list may only shrink against the base's: no word dropped, no entry
// added, no count raised.
function growthErrors(list: BannedList, base: Base): string[] {
  const was = base.list;
  if (!was) return [];
  const words = new Set(list.words.map((w) => w.toLowerCase()));
  const errors = was.words
    .filter((word) => !words.has(word.toLowerCase()))
    .map((word) => `${LIST} drops the word "${word}" that ${base.ref} bans`);
  for (const [path, entry] of byPath(Object.entries(list.allow))) {
    const before = was.allow[path];
    if (!before)
      errors.push(
        `${path}: ${LIST} lists it and ${base.ref}'s list does not; the list only shrinks`,
      );
    else if (entry.count > before.count)
      errors.push(
        `${path}: ${LIST} allows ${entry.count}, ${base.ref}'s list ${before.count}; the list only shrinks`,
      );
  }
  return errors;
}

export function listErrors(
  files: Map<string, number>,
  list: BannedList,
  base?: Base,
): string[] {
  return [
    ...overErrors(files, list),
    ...entryErrors(files, list),
    ...(base ? growthErrors(list, base) : []),
  ];
}

function parseList(text: string, source: string): BannedList {
  let parsed: Partial<BannedList> | null;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${source} is not valid JSON`);
  }
  const words = parsed?.words;
  const allow = parsed?.allow;
  if (
    !Array.isArray(words) ||
    !words.length ||
    !words.every((w) => typeof w === 'string' && w.trim()) ||
    !allow ||
    typeof allow !== 'object' ||
    Array.isArray(allow) ||
    !Object.values(allow).every(
      (e) => e && Number.isInteger(e.count) && e.count > 0,
    )
  )
    throw new Error(
      `${source} must hold "words" (non-empty strings) and "allow" ({ path: { count > 0, reason } })`,
    );
  return parsed as BannedList;
}

export function scanRepo(root: string): {
  files: Map<string, number>;
  list: BannedList;
} {
  const listPath = join(root, LIST);
  if (!existsSync(listPath))
    throw new Error(
      `${LIST} is missing; it lists the words and what may hold them`,
    );
  const list = parseList(readFileSync(listPath, 'utf8'), LIST);
  const tracked = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    env: gitEnv(),
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
  const files = new Map<string, number>();
  for (const path of tracked) {
    if (path === LIST) continue;
    const full = join(root, path);
    let text = '';
    // A deleted-but-staged file or a symlink has no text of its own; its path
    // still counts.
    if (existsSync(full) && lstatSync(full).isFile()) {
      const read = readFileSync(full, 'utf8');
      if (!read.includes('\0')) text = read;
    }
    files.set(path, countMentions(path, text, list.words));
  }
  return { files, list };
}

function baseList(ref: string): BannedList | null {
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      encoding: 'utf8',
      env: gitEnv(),
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  try {
    git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
  } catch {
    throw new Error(`--base ${ref} is not a commit; fetch it, or fix the ref`);
  }
  let text: string;
  try {
    text = git('show', `${ref}:${LIST}`);
  } catch {
    return null;
  }
  return parseList(text, `${ref}:${LIST}`);
}

function main() {
  let errors: string[];
  let summary = '';
  try {
    const { values } = parseArgs({ options: { base: { type: 'string' } } });
    const { files, list } = scanRepo('.');
    const base = values.base
      ? { list: baseList(values.base), ref: values.base }
      : undefined;
    errors = listErrors(files, list, base);
    const allowed = Object.keys(list.allow).length;
    summary = `banned words: ${files.size} files checked, ${allowed} allowed by ${LIST}, ok`;
  } catch (error) {
    errors = [(error as Error).message];
  }
  if (errors.length) {
    for (const line of errors) console.error(line);
    process.exit(1);
  }
  console.log(summary);
}

if (process.argv[1]?.endsWith('banned-words.ts')) main();
