import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { block, check, read, script } from './workflow-text.ts';

describe('workflow text helpers', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'workflow-text-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it('reads a workflow from the given directory', () => {
    writeFileSync(join(dir, 'a.yml'), 'name: A\n');
    expect(read('a.yml', dir)).toBe('name: A\n');
  });

  it('reads the repository workflows by default', () => {
    expect(read('pr-title.yml')).toMatch(/^name: /m);
  });

  it('throws on a missing workflow file instead of answering empty', () => {
    expect(() => read('gone.yml', dir)).toThrow(/gone\.yml/);
  });

  it('returns the lines nested under a key', () => {
    const text = 'on:\n  push:\n    branches: [main]\njobs:\n  x: 1\n';
    expect(block(text, 'on', 0)).toBe('on:\n  push:\n    branches: [main]');
    expect(block(text, 'push', 2)).toBe('  push:\n    branches: [main]');
  });

  it('throws on a key missing at that indent, naming the key and indent', () => {
    expect(() => block('jobs:\n  x: 1\n', 'on', 0)).toThrow(
      'no on: at indent 0',
    );
    expect(() => block('jobs:\n  x: 1\n', 'x', 0)).toThrow('no x: at indent 0');
  });

  it('extracts the run step as the runner sees it', () => {
    const text =
      'jobs:\n  t:\n    steps:\n      - name: t\n        run: |\n          echo a\n          echo b\n      - name: next\n';
    expect(script(text)).toBe('echo a\necho b');
  });

  it('throws on a workflow with no run step instead of a fallback script', () => {
    expect(() => script('jobs:\n  t:\n    steps: []\n')).toThrow(
      /no run: \| step/,
    );
  });

  it('runs the title check, in the given working directory', () => {
    expect(check('feat(api): subject').code).toBe(0);
    expect(check('not a title', dir).code).toBe(1);
  });
});
