// Checks a pull request's title and body against .github/pull_request_template.md.
// The template is the only list of what a PR must contain: each `## ` heading
// is a required section, and each `- Label:` line in it a required line.
//
// A draft only needs every heading (its PR opens at the first commit, before
// anything is tested). A ready PR must also have no "(fill in:" placeholder,
// no empty section, no bare N/A, every labelled line, every box ticked, a
// Notion link and a Conventional title with a scope. HTML comments are hints
// GitHub does not render, so they are removed before judging.
//
//   node scripts/pr-body-check.ts                 # PR_BODY, PR_TITLE, PR_DRAFT
//   node scripts/pr-body-check.ts --body-file <path> --title "<title>" [--draft]
//
// Run from the repository root.

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

export interface PrInput {
  body: string | null;
  title: string;
  draft: boolean;
  template: string;
}

const TEMPLATE_PATH = '.github/pull_request_template.md';
const TITLE = /^[a-z]+\([^()\s][^()]*\)!?: \S/;
const NOTION_LINK = /https?:\/\/(?:[\w-]+\.)*notion\.(?:so|site|com)\//;
const BARE_NA = /^N\/?A[\s.:;,—–-]*$/i;
const LABEL = /^\s*[-*]\s+([A-Za-z][\w -]*):(.*)$/;
const UNTICKED = /^\s*[-*]\s+\[ \]\s+(.+)$/;

function sections(markdown: string): Map<string, string> {
  const found = new Map<string, string>();
  let heading: string | null = null;
  let lines: string[] = [];
  const close = () => {
    if (heading !== null && !found.has(heading))
      found.set(heading, lines.join('\n'));
  };
  for (const line of markdown.split('\n')) {
    const match = /^## (.+)$/.exec(line);
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

function clean(markdown: string | null): string {
  return (markdown ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '');
}

function byKey(map: Map<string, string>): Map<string, string> {
  return new Map(
    [...map].map(([heading, text]) => [heading.toLowerCase(), text]),
  );
}

function labels(text: string): string[] {
  return text.split('\n').flatMap((line) => LABEL.exec(line)?.[1] ?? []);
}

/** The one reason a section has no real answer at all, if it has none. */
function unanswered(name: string, content: string): string | null {
  if (content.includes('(fill in:')) {
    const placeholder =
      /\(fill in:[^\n]*?\)(?=_|\s*$)/m.exec(content)?.[0] ?? '(fill in: …';
    return `${name} still has template placeholder text: "${placeholder}".`;
  }
  if (!content) return `${name} is empty.`;
  if (BARE_NA.test(content)) return `${name} says N/A without a reason.`;
  return null;
}

function labelProblems(name: string, lines: string[], wanted: string[]) {
  return wanted.flatMap((label) => {
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

function sectionProblems(heading: string, text: string, wanted: string[]) {
  const name = `"## ${heading}"`;
  const content = text.trim();
  const reason = unanswered(name, content);
  if (reason) return [reason];

  const lines = content.split('\n');
  const problems = labelProblems(name, lines, wanted);
  for (const line of lines) {
    const item = UNTICKED.exec(line)?.[1].trim();
    if (item && !/\bN\/A\b\W*\w/.test(item))
      problems.push(`${name} has an unticked box: "${item}".`);
  }
  const isNotion = heading.toLowerCase() === 'notion story';
  if (isNotion && !NOTION_LINK.test(content) && !/^N\/?A\b/i.test(content))
    problems.push(`${name} has no Notion link (or N/A and the reason).`);
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
  const given = byKey(sections(clean(body)));
  const problems: string[] = [];
  for (const heading of required.keys())
    if (!given.has(heading.toLowerCase()))
      problems.push(`Missing section: "## ${heading}".`);
  if (draft) return problems;

  for (const [heading, text] of required) {
    const answer = given.get(heading.toLowerCase());
    if (answer !== undefined)
      problems.push(...sectionProblems(heading, answer, labels(text)));
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
