import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { isRecord } from './is-record';

const root = join(__dirname, '../../..');

// @traces 1246-FR-016
describe('isRecord', () => {
  it('takes a plain object, empty or not', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it.each([null, undefined, [], [1], 'x', 1, true])('refuses %p', (value) => {
    expect(isRecord(value)).toBe(false);
  });

  it('is defined once in the apps and libraries', () => {
    const found = execFileSync(
      'git',
      [
        'grep',
        '--untracked',
        '-lE',
        '(const isRecord =|function isRecord\\()',
        '--',
        'apps/*.ts',
        'libs/*.ts',
        ':!*.spec.ts',
      ],
      { cwd: root, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean);
    expect(found).toEqual(['libs/contracts/src/is-record.ts']);
  });
});
