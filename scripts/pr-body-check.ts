// Checks a pull request's title and body against .github/pull_request_template.md.
// The template is the only list of what a PR must contain: each `## ` heading
// is a required section, and each `- Label:` line and `- [ ]` box in it is
// required (a box by the words before its colon). Code fences are not read.
//
// A draft only needs every heading (its PR opens at the first commit, before
// anything is tested). A ready PR must also have no "_(fill in: …)_" placeholder,
// no empty section, no bare N/A, every labelled line, every box ticked, a
// story link (its issue in george-hutanu/motor-fix-specs, or N/A and the
// reason) and a Conventional title with a scope. HTML comments are hints
// GitHub does not render, so they are removed before judging.
//
//   node scripts/pr-body-check.ts                 # PR_BODY, PR_TITLE, PR_DRAFT
//   node scripts/pr-body-check.ts --body-file <path> --title "<title>" [--draft]
//
// Run from the repository root.

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

type PrInput = {
  body: string | null;
  title: string;
  draft: boolean;
  template: string;
};

type Wanted = { labels: string[]; boxes: string[] };

const TEMPLATE_PATH = '.github/pull_request_template.md';
const TITLE = /^[a-z]+\([^()\s][^()]*\)!?: \S/;
// The link must start a word, so one buried in another URL does not count.
const STORY_LINK =
  /(?:^|[\s(<[])https?:\/\/github\.com\/george-hutanu\/motor-fix-specs\/issues\/\d+(?!\w)/m;
const BARE_NA = /^N\/?A[\s.:;,—–-]*$/i;
const HEADING = /^ {0,3}## (.+?)(?:\s+#+)?\s*$/;
const FENCE = /^\s*(```|~~~)/;
const LABEL = /^\s*[-*]\s+([A-Za-z][\w -]*):(.*)$/;
const BOX = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/;

function sections(markdown: string): Map<string, string> {
  const found = new Map<string, string>();
  let heading: string | null = null;
  let lines: string[] = [];
  let fenced = false;
  const close = () => {
    if (heading !== null && !found.has(heading.toLowerCase()))
      found.set(heading.toLowerCase(), lines.join('\n'));
  };
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) fenced = !fenced;
    const match = fenced ? null : HEADING.exec(line);
    if (match) {
      close();
      heading = match[1].trim();
      lines = [];
    } else {
      lines.push(line);
    }
  }
  close();
  return found;
}

/** The lines outside code fences, where a template answer can be. */
function prose(text: string): string[] {
  let fenced = false;
  return text.split('\n').filter((line) => {
    if (FENCE.test(line)) {
      fenced = !fenced;
      return false;
    }
    return !fenced;
  });
}

function clean(markdown: string | null): string {
  return (markdown ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '');
}

function headings(markdown: string): string[] {
  let fenced = false;
  return markdown.split('\n').flatMap((line) => {
    if (FENCE.test(line)) fenced = !fenced;
    return (fenced ? null : HEADING.exec(line)?.[1].trim()) ?? [];
  });
}

function wanted(text: string): Wanted {
  const lines = text.split('\n');
  return {
    boxes: lines.flatMap((line) => BOX.exec(line)?.[2].trim() ?? []),
    labels: lines.flatMap((line) => LABEL.exec(line)?.[1] ?? []),
  };
}

/** The one reason a section has no real answer at all, if it has none. */
function unanswered(name: string, content: string, lines: string[]) {
  const text = lines.join('\n');
  const placeholder = /_(\(fill in:[^\n]*?\))_/.exec(text)?.[1];
  if (placeholder)
    return `${name} still has template placeholder text: "${placeholder}".`;
  if (!content) return `${name} is empty.`;
  if (BARE_NA.test(content)) return `${name} says N/A without a reason.`;
  return null;
}

function labelProblems(name: string, lines: string[], labels: string[]) {
  return labels.flatMap((label) => {
    const line = lines
      .map((l) => LABEL.exec(l))
      .find((m) => m?.[1].toLowerCase() === label.toLowerCase());
    const value = line?.[2].trim();
    if (!line) return [`${name} is missing its "${label}:" line.`];
    if (!value) return [`${name} leaves "${label}:" empty.`];
    if (BARE_NA.test(value))
      return [`${name} answers "${label}:" N/A without a reason.`];
    return [];
  });
}

function boxProblems(name: string, lines: string[], boxes: string[]) {
  const given = lines.flatMap((line) => {
    const match = BOX.exec(line);
    return match ? [{ item: match[2].trim(), ticked: match[1] !== ' ' }] : [];
  });
  const unticked = given
    .filter((box) => !box.ticked)
    .map((box) => `${name} has an unticked box: "${box.item}".`);
  // A box is known by the words before its colon, so an author may append
  // to an item without it counting as removed.
  const lead = (item: string) => item.split(':')[0].trim().toLowerCase();
  const known = new Set(given.map((box) => lead(box.item)));
  const missing = boxes
    .filter((box) => !known.has(lead(box)))
    .map((box) => `${name} is missing its box: "${box}".`);
  return [...unticked, ...missing];
}

function sectionProblems(heading: string, text: string, want: Wanted) {
  const name = `"## ${heading}"`;
  const content = text.trim();
  const lines = prose(content);
  const reason = unanswered(name, content, lines);
  if (reason) return [reason];

  const problems = [
    ...labelProblems(name, lines, want.labels),
    ...boxProblems(name, lines, want.boxes),
  ];
  const isStory = heading.toLowerCase() === 'story';
  if (isStory && !STORY_LINK.test(content) && !/^N\/?A\b/i.test(content))
    problems.push(
      `${name} has no link to the story (its issue in george-hutanu/motor-fix-specs), or N/A and the reason.`,
    );
  return problems;
}

/** Every way the PR falls short of the template; empty when it passes. */
export function checkPrBody({
  body,
  title,
  draft,
  template,
}: PrInput): string[] {
  const required = sections(clean(template));
  const given = sections(clean(body));
  const names = headings(clean(template));
  const problems: string[] = [];
  for (const heading of names)
    if (!given.has(heading.toLowerCase()))
      problems.push(`Missing section: "## ${heading}".`);
  if (draft) return problems;

  for (const heading of names) {
    const key = heading.toLowerCase();
    const answer = given.get(key);
    if (answer !== undefined)
      problems.push(
        ...sectionProblems(heading, answer, wanted(required.get(key) ?? '')),
      );
  }
  if (!TITLE.test(title))
    problems.push(
      `Title "${title}" is not a Conventional Commit with a scope, e.g. "feat(api): ST-1 subject".`,
    );
  return problems;
}

function main() {
  const { values } = parseArgs({
    options: {
      'body-file': { type: 'string' },
      draft: { type: 'boolean' },
      title: { type: 'string' },
    },
  });
  const fromFile = values['body-file'];
  const problems = checkPrBody({
    body: fromFile
      ? readFileSync(fromFile, 'utf8')
      : (process.env['PR_BODY'] ?? ''),
    draft: values.draft ?? process.env['PR_DRAFT'] === 'true',
    template: readFileSync(TEMPLATE_PATH, 'utf8'),
    title: values.title ?? process.env['PR_TITLE'] ?? '',
  });
  if (problems.length === 0) {
    console.log('The PR follows the template.');
    return;
  }
  for (const problem of problems) console.error(problem);
  console.error(
    `\nFill in every section of ${TEMPLATE_PATH}; write N/A and the reason where one does not apply.`,
  );
  process.exitCode = 1;
}

if (process.argv[1]?.endsWith('pr-body-check.ts')) main();
