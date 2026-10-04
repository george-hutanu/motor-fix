// Decides whether a pull request changes documentation only, so ci.yml can
// skip the jobs such a change cannot affect.
//
//   node scripts/docs-only.ts <base-ref>
//
// Compares HEAD with its merge base on <base-ref> and writes
// `docs-only=true|false` to $GITHUB_OUTPUT. Renames are listed as both paths,
// so moving code into a Markdown file still counts as a code change. Markdown
// under .claude/, .specify/ and .github/ is read by the harness tests and the
// PR template check, so it is not documentation here.

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const NOT_DOCUMENTATION = ['.claude/', '.specify/', '.github/'];

export function isDocumentation(path: string): boolean {
  if (path.startsWith('docs/')) return true;
  return (
    path.toLowerCase().endsWith('.md') &&
    !NOT_DOCUMENTATION.some((prefix) => path.startsWith(prefix))
  );
}

export function isDocsOnly(paths: string[]): boolean {
  const changed = paths.map((path) => path.trim()).filter(Boolean);
  return changed.length > 0 && changed.every(isDocumentation);
}

function main() {
  const base = process.argv[2];
  if (!base) throw new Error('Usage: node scripts/docs-only.ts <base-ref>');
  const changed = execFileSync(
    'git',
    [
      '-c',
      'core.quotePath=off',
      'diff',
      '--name-only',
      '--no-renames',
      `${base}...HEAD`,
    ],
    { encoding: 'utf8' },
  ).split('\n');
  const docsOnly = isDocsOnly(changed);
  console.log(changed.filter(Boolean).join('\n'));
  console.log(`docs-only=${docsOnly}`);
  if (process.env['GITHUB_OUTPUT']) {
    appendFileSync(process.env['GITHUB_OUTPUT'], `docs-only=${docsOnly}\n`);
  }
}

if (process.argv[1]?.endsWith('docs-only.ts')) main();
