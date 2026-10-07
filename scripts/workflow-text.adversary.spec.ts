import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { block, read, script } from './workflow-text.ts';

describe('workflow text helpers under hostile input', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'workflow-text-adv-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  it('throws on an empty workflow file when a script is requested', () => {
    writeFileSync(join(dir, 'empty.yml'), '');
    expect(() => script(read('empty.yml', dir))).toThrow(/no run: \| step/);
  });

  it('throws when the directory itself does not exist', () => {
    expect(() => read('pr-title.yml', join(dir, 'nope'))).toThrow(
      /pr-title\.yml/,
    );
  });

  it('does not match a key that only appears at a deeper indent', () => {
    expect(() => block('jobs:\n  on:\n    x: 1\n', 'on', 0)).toThrow(
      'no on: at indent 0',
    );
  });

  it('does not match a key that merely starts with the requested name', () => {
    expect(() => block('onward:\n  x: 1\n', 'on', 0)).toThrow(
      'no on: at indent 0',
    );
  });

  it('treats regex metacharacters in the key literally', () => {
    expect(() => block('abc:\n  x: 1\n', 'a.c', 0)).toThrow(
      'no a.c: at indent 0',
    );
  });

  it('throws when the only run line is an inline command, not a block', () => {
    expect(() =>
      script('jobs:\n  t:\n    steps:\n      - run: echo hi\n'),
    ).toThrow(/no run: \| step/);
  });
});
