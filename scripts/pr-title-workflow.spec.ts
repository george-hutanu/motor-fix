import { block, check, read } from './workflow-text.ts';

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
