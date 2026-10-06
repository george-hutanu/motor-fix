import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The workflows read as indented text: the repository has no YAML parser as a
// direct dependency, and these few keys are enough.
const workflows = join(__dirname, '..', '.github', 'workflows');
const read = (name: string) => readFileSync(join(workflows, name), 'utf8');

/** The lines nested under the first `key:` line at `indent` spaces. */
function block(text: string, key: string, indent: number): string {
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

/** The title check's own shell script, as the runner sees it. */
function script(): string {
  const lines = read('pr-title.yml').split('\n');
  const start = lines.findIndex((l) => /^ +run: \|$/.test(l));
  if (start < 0) throw new Error('pr-title.yml has no run: | step');
  const indent = (lines[start + 1] ?? '').search(/\S/);
  const body: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (l.trim() && l.search(/\S/) < indent) break;
    body.push(l.slice(indent));
  }
  return body.join('\n');
}

function check(title: string) {
  const run = spawnSync('bash', ['-c', script()], {
    encoding: 'utf8',
    env: { PATH: process.env['PATH'], TITLE: title },
  });
  return { code: run.status, out: `${run.stdout}${run.stderr}` };
}

describe('PR title workflow', () => {
  const workflow = read('pr-title.yml');

  it('runs when a PR is opened, reopened, pushed to or edited', () => {
    const types = block(workflow, 'pull_request', 2)
      .match(/types: \[(.*)\]/)?.[1]
      ?.split(',')
      .map((t) => t.trim());
    expect(types?.sort()).toEqual([
      'edited',
      'opened',
      'reopened',
      'synchronize',
    ]);
  });

  it('cancels an older run of the same PR', () => {
    const concurrency = block(workflow, 'concurrency', 0);
    expect(concurrency).toMatch(/group: .*github\.event\.pull_request\.number/);
    expect(concurrency).toMatch(/cancel-in-progress: true/);
  });

  it('names its job "PR title"', () => {
    expect(workflow).toMatch(/^ {4}name: PR title$/m);
  });

  it.each([
    'feat(api): add the health check',
    'fix: ST-1 subject',
    'ci(ci)!: a breaking subject',
    'build(deps): bump @biomejs/biome from 2.5.14 to 2.5.15',
  ])('accepts %s', (title) => {
    expect(check(title).code).toBe(0);
  });

  it.each([
    'Add the health check',
    'feat add the health check',
    'feat(api):  two spaces',
    'wip(api): subject',
    'feat(API): upper-case scope',
  ])('refuses %s and asks for a corrected title, not a push', (title) => {
    const { code, out } = check(title);
    expect(code).toBe(1);
    expect(out).toContain('PR title is not a Conventional Commit');
    expect(out).toMatch(/edit the title/i);
    expect(out).not.toMatch(/push/i);
  });
});

describe('CI workflow', () => {
  const ci = read('ci.yml');

  it('keeps the default pull_request types, so an edit starts no build or test run', () => {
    expect(block(ci, 'pull_request', 2)).toBe('  pull_request:');
  });

  it('holds no title job, and CI OK does not wait for one', () => {
    expect(ci).not.toMatch(/^ {2}pr-title:$/m);
    expect(block(ci, 'ci-ok', 2)).not.toMatch(/pr-title/);
  });
});
