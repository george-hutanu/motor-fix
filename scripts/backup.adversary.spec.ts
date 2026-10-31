import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { backupKey, compare, pruneKeys, report, settings } from './backup.ts';

const ALL = {
  BACKUP_GPG_PASSPHRASE: 'p',
  BACKUP_S3_ACCESS_KEY_ID: 'k',
  BACKUP_S3_BUCKET: 'b',
  BACKUP_S3_ENDPOINT: 'https://s3.example.test',
  BACKUP_S3_REGION: 'auto',
  BACKUP_S3_SECRET_ACCESS_KEY: 's',
  RAILWAY_API_TOKEN: 't',
  RAILWAY_ENVIRONMENT_ID: 'e',
  RAILWAY_SERVICE_POSTGRES: 'svc',
};

const run = (args: string[], env: Record<string, string> = {}, input = '') =>
  spawnSync(process.execPath, [join(__dirname, 'backup.ts'), ...args], {
    encoding: 'utf8',
    env: { PATH: process.env['PATH'] ?? '', ...env },
    input,
  });

const pair = (environment: string, stamp: string) => [
  `${environment}/${stamp}.dump.gpg`,
  `${environment}/${stamp}.manifest.json`,
];

const now = new Date('2026-11-15T03:00:00Z');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'backup-adv-'));
});
afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

// @traces 251-FR-012
describe('the backup settings check under hostile input', () => {
  it('skips when the service id is only whitespace', () => {
    expect(settings({ ...ALL, RAILWAY_SERVICE_POSTGRES: '\t \n' })).toEqual({
      skip: true,
    });
  });

  it('skips before it complains about other missing settings', () => {
    expect(settings({ RAILWAY_SERVICE_POSTGRES: '' })).toEqual({ skip: true });
  });

  it('names exactly one missing setting when several are missing', () => {
    const res = settings({
      ...ALL,
      BACKUP_GPG_PASSPHRASE: '',
      BACKUP_S3_BUCKET: '',
    });
    expect(Object.keys(res)).toEqual(['missing']);
  });

  it('treats a setting set to undefined as missing', () => {
    expect(
      settings({ ...ALL, BACKUP_S3_ENDPOINT: undefined } as never),
    ).toEqual({ missing: 'BACKUP_S3_ENDPOINT' });
  });

  it('never prints a secret value, even when the missing one sits beside it', () => {
    const res = run(['settings'], {
      ...ALL,
      BACKUP_GPG_PASSPHRASE: '',
      BACKUP_S3_SECRET_ACCESS_KEY: 'hunter2-secret',
    });
    expect(res.status).toBe(1);
    expect(`${res.stdout}${res.stderr}`).not.toContain('hunter2-secret');
  });
});

// @traces 251-FR-013
describe('the backup key under hostile input', () => {
  it('uses UTC whatever the process time zone', () => {
    expect(backupKey('staging', new Date('2026-10-11T00:30:00+05:00'))).toBe(
      'staging/20261010T193000Z',
    );
  });

  it('pads single-digit fields', () => {
    expect(backupKey('staging', new Date('2026-01-02T03:04:05Z'))).toBe(
      'staging/20260102T030405Z',
    );
  });

  it('refuses an invalid date', () => {
    expect(() => backupKey('staging', new Date('nope'))).toThrow();
  });

  it.each(['../etc', 'staging/../production', '', 'dev'])(
    'refuses the environment %j, which is neither staging nor production',
    (environment) => {
      expect(() => backupKey(environment, now)).toThrow();
    },
  );

  it('fails from the command line without an environment', () => {
    const res = run(['key']);
    expect(res.status).not.toBe(0);
    expect(res.stdout).toBe('');
  });

  it('fails from the command line on an unparseable time', () => {
    const res = run(['key', 'staging', 'yesterday-ish']);
    expect(res.status).not.toBe(0);
    expect(res.stdout).not.toContain('NaN');
  });

  it('fails on an unknown subcommand', () => {
    expect(run(['frobnicate']).status).not.toBe(0);
  });
});

// @traces 251-FR-014
describe('the retention at its edges', () => {
  it('keeps a pair exactly 30 days old and deletes one second older', () => {
    const keys = [
      ...pair('staging', '20261016T030000Z'),
      ...pair('staging', '20261016T025959Z'),
      ...pair('staging', '20261115T030000Z'),
    ];
    expect(pruneKeys(keys, 'staging', now)).toEqual(
      pair('staging', '20261016T025959Z'),
    );
  });

  it('returns nothing for an empty listing', () => {
    expect(pruneKeys([], 'staging', now)).toEqual([]);
  });

  it('never deletes the only pair', () => {
    expect(
      pruneKeys(pair('staging', '20200101T000000Z'), 'staging', now),
    ).toEqual([]);
  });

  it('finds the newest pair by timestamp, not by list order', () => {
    const keys = [
      ...pair('staging', '20250301T030000Z'),
      ...pair('staging', '20250101T030000Z'),
      ...pair('staging', '20250201T030000Z'),
    ];
    expect(pruneKeys(keys, 'staging', now).sort()).toEqual(
      [
        ...pair('staging', '20250101T030000Z'),
        ...pair('staging', '20250201T030000Z'),
      ].sort(),
    );
  });

  it('keeps a pair stamped in the future', () => {
    const keys = [
      ...pair('staging', '20301231T030000Z'),
      ...pair('staging', '20261115T030000Z'),
    ];
    expect(pruneKeys(keys, 'staging', now)).toEqual([]);
  });

  it('does not mistake a longer environment name for the one pruned', () => {
    const keys = [
      ...pair('staging-old', '20200101T000000Z'),
      ...pair('staging', '20261115T030000Z'),
    ];
    expect(pruneKeys(keys, 'staging', now)).toEqual([]);
  });

  it('leaves keys with an impossible timestamp alone', () => {
    const keys = [
      'staging/20261340T030000Z.dump.gpg',
      'staging/20261340T030000Z.manifest.json',
      ...pair('staging', '20261115T030000Z'),
    ];
    expect(pruneKeys(keys, 'staging', now)).toEqual([]);
  });

  it('leaves unrelated objects under the environment alone', () => {
    const keys = [
      'staging/20200101T000000Z.dump.gpg.tmp',
      'staging/README',
      'staging/',
      ...pair('staging', '20261115T030000Z'),
    ];
    expect(pruneKeys(keys, 'staging', now)).toEqual([]);
  });

  it('deletes an old orphan dump that has no manifest, keeping the newest pair', () => {
    const keys = [
      'staging/20200101T000000Z.dump.gpg',
      ...pair('staging', '20261115T030000Z'),
    ];
    expect(pruneKeys(keys, 'staging', now)).toEqual([
      'staging/20200101T000000Z.dump.gpg',
    ]);
  });

  it('handles ten thousand keys', () => {
    const keys: string[] = [];
    for (let i = 0; i < 5000; i += 1) {
      const day = new Date(Date.UTC(2000, 0, 1) + i * 86_400_000);
      const stamp = `${day.toISOString().slice(0, 10).replaceAll('-', '')}T030000Z`;
      keys.push(...pair('staging', stamp));
    }
    const out = pruneKeys(keys, 'staging', now);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(keys.length);
  });

  it('prints nothing when the listing has no Contents, as for an empty bucket', () => {
    const res = run(['prune', 'staging', now.toISOString()], {}, '{}');
    expect(res.status).toBe(0);
    expect(res.stdout).toBe('');
  });

  it('prints nothing when Contents is null', () => {
    const res = run(
      ['prune', 'staging', now.toISOString()],
      {},
      '{"Contents":null}',
    );
    expect(res.status).toBe(0);
    expect(res.stdout).toBe('');
  });

  it('fails without printing a key when stdin is not JSON', () => {
    const res = run(['prune', 'staging', now.toISOString()], {}, '<html>');
    expect(res.status).not.toBe(0);
    expect(res.stdout).toBe('');
  });

  it('prints keys with unicode intact', () => {
    const res = run(
      ['prune', 'staging', now.toISOString()],
      {},
      JSON.stringify({
        Contents: [
          { Key: 'staging/20200101T000000Z.dump.gpg' },
          ...pair('staging', '20261115T030000Z').map((Key) => ({ Key })),
        ],
      }),
    );
    expect(res.stdout.trim()).toBe('staging/20200101T000000Z.dump.gpg');
  });
});

// @traces 251-FR-015
describe('the restore comparison under hostile input', () => {
  it('finds nothing for two empty databases', () => {
    expect(compare({}, {})).toEqual([]);
  });

  it('treats zero as a count, not as missing', () => {
    expect(compare({ t: 0 }, { t: 0 })).toEqual([]);
    expect(compare({ t: 0 }, {})).toEqual(['table t: missing in restore']);
    expect(compare({}, { t: 0 })).toEqual(['table t: missing in manifest']);
  });

  it('does not equate a string count with a number', () => {
    expect(compare({ t: 1 }, { t: '1' } as never)).toHaveLength(1);
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'does not see a table named %s on the other side by inheritance',
    (name) => {
      const manifest = JSON.parse(`{"${name}": 3}`);
      expect(compare(manifest, {})).toEqual([
        `table ${name}: missing in restore`,
      ]);
      expect(compare({}, manifest)).toEqual([
        `table ${name}: missing in manifest`,
      ]);
    },
  );

  it('names every differing table, not only the first', () => {
    expect(compare({ a: 1, b: 2, c: 3 }, { a: 9, b: 2, c: 9 })).toEqual([
      'table a: manifest 1, restored 9',
      'table c: manifest 3, restored 9',
    ]);
  });

  it('exits 1 from the command line when the manifest has no tables', () => {
    writeFileSync(join(dir, 'm.json'), '{}');
    writeFileSync(join(dir, 'c.json'), '{"account":1}');
    const res = run(['compare', join(dir, 'm.json'), join(dir, 'c.json')]);
    expect(res.status).toBe(1);
    expect(res.stdout).toContain('table account: missing in manifest');
  });

  it('fails when the counts file is missing, without reporting equality', () => {
    writeFileSync(join(dir, 'm.json'), JSON.stringify({ tables: { a: 1 } }));
    const res = run(['compare', join(dir, 'm.json'), join(dir, 'gone.json')]);
    expect(res.status).not.toBe(0);
  });

  it('fails when the counts file is not JSON', () => {
    writeFileSync(join(dir, 'm.json'), JSON.stringify({ tables: { a: 1 } }));
    writeFileSync(join(dir, 'c.json'), 'not json');
    const res = run(['compare', join(dir, 'm.json'), join(dir, 'c.json')]);
    expect(res.status).not.toBe(0);
  });

  it('fails when the counts file is empty', () => {
    writeFileSync(join(dir, 'm.json'), JSON.stringify({ tables: { a: 1 } }));
    writeFileSync(join(dir, 'c.json'), '');
    expect(
      run(['compare', join(dir, 'm.json'), join(dir, 'c.json')]).status,
    ).not.toBe(0);
  });

  it('fails with no arguments', () => {
    expect(run(['compare']).status).not.toBe(0);
  });

  it('ignores a UTF-8 byte order mark on the manifest', () => {
    writeFileSync(
      join(dir, 'm.json'),
      `﻿${JSON.stringify({ tables: { a: 1 } })}`,
    );
    writeFileSync(join(dir, 'c.json'), '{"a":1}');
    expect(
      run(['compare', join(dir, 'm.json'), join(dir, 'c.json')]).status,
    ).toBe(0);
  });

  it('refuses a manifest saved as UTF-16 rather than calling it equal', () => {
    writeFileSync(
      join(dir, 'm.json'),
      Buffer.from(`﻿${JSON.stringify({ tables: { a: 1 } })}`, 'utf16le'),
    );
    writeFileSync(join(dir, 'c.json'), '{"a":1}');
    expect(
      run(['compare', join(dir, 'm.json'), join(dir, 'c.json')]).status,
    ).not.toBe(0);
  });

  it('reads a Latin-1 table name byte for byte without crashing', () => {
    writeFileSync(
      join(dir, 'm.json'),
      Buffer.from('{"tables":{"caf\xe9":1}}', 'latin1'),
    );
    writeFileSync(join(dir, 'c.json'), '{"a":1}');
    const res = run(['compare', join(dir, 'm.json'), join(dir, 'c.json')]);
    expect(res.status).toBe(1);
  });

  it('finds the one differing table in a manifest bigger than 20 MB', () => {
    const tables: Record<string, number> = {};
    for (let i = 0; i < 400_000; i += 1)
      tables[`table_${i}_${'x'.repeat(40)}`] = i;
    writeFileSync(join(dir, 'm.json'), JSON.stringify({ tables }));
    const first = Object.keys(tables)[0] as string;
    writeFileSync(
      join(dir, 'c.json'),
      JSON.stringify({ ...tables, [first]: 99 }),
    );
    expect(readFileSync(join(dir, 'm.json')).length).toBeGreaterThan(
      20_000_000,
    );
    const res = run(['compare', join(dir, 'm.json'), join(dir, 'c.json')]);
    expect(res.status).toBe(1);
    expect(res.stdout).toContain(`table ${first}: manifest 0, restored 99`);
  });
});

// @traces 251-FR-016
describe('the drill report under hostile input', () => {
  it('prints a zero total for no steps', () => {
    expect(report('').trim()).toMatch(/^total\s+0 s$/);
  });

  it('sums the steps into the total', () => {
    const lines = report('download 1\ndecrypt 2\nrestore 3').split('\n');
    expect(lines.at(-1)).toMatch(/^total\s+6 s$/);
  });

  it('accepts Windows line endings', () => {
    const lines = report('download 1\r\ndecrypt 2\r\n').split('\n');
    expect(lines.at(-1)).toMatch(/^total\s+3 s$/);
    expect(lines.join('')).not.toContain('\r');
  });

  it('skips blank lines', () => {
    expect(report('\n\ndownload 5\n\n').split('\n')).toHaveLength(2);
  });

  it('never prints NaN for a line without seconds', () => {
    expect(report('download').trim()).toMatch(/^total\s+0 s$/);
  });

  it('never prints NaN for non-numeric seconds', () => {
    expect(report('download soon').trim()).toMatch(/^total\s+0 s$/);
  });

  it('keeps fractional seconds in the total', () => {
    const lines = report('download 1.5\ndecrypt 1.5').split('\n');
    expect(lines.at(-1)).toMatch(/^total\s+3(\.0)? s$/);
  });

  it('keeps every step name whole when one is long', () => {
    const out = report(`${'x'.repeat(60)} 1\ndecrypt 2`);
    expect(out).toContain('x'.repeat(60));
  });
});
