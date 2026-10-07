import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Test helpers for the GitHub workflows, read as indented text: the repository
// has no YAML parser as a direct dependency, and these few keys are enough.
// Each one throws on what it cannot find, so a moved or renamed workflow fails
// the tests instead of passing them vacuously.
const workflows = join(__dirname, '..', '.github', 'workflows');

export const read = (name: string, dir = workflows) =>
  readFileSync(join(dir, name), 'utf8');

/** The lines nested under the first `key:` line at `indent` spaces. */
export function block(text: string, key: string, indent: number): string {
  const lines = text.split('\n');
  const pad = ' '.repeat(indent);
  const start = lines.findIndex(
    (l) => l === `${pad}${key}:` || l.startsWith(`${pad}${key}: `),
  );
  if (start < 0) throw new Error(`no ${key}: at indent ${indent}`);
  const end = lines.findIndex(
    (l, i) => i > start && l.trim() !== '' && !l.startsWith(`${pad} `),
  );
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

/** The first `run: |` step's shell script, as the runner sees it. */
export function script(text = read('pr-title.yml')): string {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^ +run: \|$/.test(l));
  if (start < 0) throw new Error('the workflow has no run: | step');
  const indent = (lines[start + 1] ?? '').search(/\S/);
  const body: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (l.trim() && l.search(/\S/) < indent) break;
    body.push(l.slice(indent));
  }
  return body.join('\n');
}

/** Runs the PR title check against `title`, as the workflow would. */
export function check(title: string, cwd?: string) {
  const run = spawnSync('bash', ['-c', script()], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env['PATH'], TITLE: title },
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: run.status, out: `${run.stdout}${run.stderr}` };
}
