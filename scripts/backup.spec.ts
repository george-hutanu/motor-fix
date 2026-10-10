import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  backupKey,
  compare,
  pruneKeys,
  RETENTION_DAYS,
  report,
  settings,
} from './backup.ts';

const ALL = {
  BACKUP_GPG_PASSPHRASE: 'p',
  BACKUP_S3_ACCESS_KEY_ID: 'k',
  BACKUP_S3_BUCKET: 'b',
  BACKUP_S3_ENDPOINT: 'https://s3.example.test',
  BACKUP_S3_REGION: 'auto',
  BACKUP_S3_SECRET_ACCESS_KEY: 's',
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

// @traces 251-FR-012 251-FR-017
describe('the backup settings check', () => {
  it('passes when every setting is there', () => {
    expect(settings(ALL)).toEqual({ skip: false });
  });

  it('skips an environment that has no PostgreSQL service named', () => {
    expect(settings({ ...ALL, RAILWAY_SERVICE_POSTGRES: '' })).toEqual({
      skip: true,
    });
    expect(settings({})).toEqual({ skip: true });
  });

  it.each(Object.keys(ALL).filter((k) => k !== 'RAILWAY_SERVICE_POSTGRES'))(
    'names %s when it is missing',
    (name) => {
      expect(settings({ ...ALL, [name]: ' ' })).toEqual({ missing: name });
    },
  );

  it('prints the answer for the workflow and never a value', () => {
    const ok = run(['settings'], ALL);
    expect(ok.status).toBe(0);
    expect(ok.stdout.trim()).toBe('skip=false');

    const skipped = run(['settings'], {});
    expect(skipped.status).toBe(0);
    expect(skipped.stdout.trim()).toBe('skip=true');

    const missing = run(['settings'], { ...ALL, BACKUP_GPG_PASSPHRASE: '' });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('missing BACKUP_GPG_PASSPHRASE');
    for (const value of Object.values(ALL)) {
      expect(`${ok.stdout}${missing.stdout}${missing.stderr}`).not.toContain(
        `=${value}`,
      );
    }
  });
});

// @traces 251-FR-013
describe('the backup key', () => {
  it('names the environment and the UTC time to the second', () => {
    expect(backupKey('staging', new Date('2026-10-11T03:00:12.345Z'))).toBe(
      'staging/20261011T030012Z',
    );
  });

  it('prints it from the command line', () => {
    const res = run(['key', 'production', '2026-01-02T23:59:59Z']);
    expect(res.stdout.trim()).toBe('production/20260102T235959Z');
  });
});

// @traces 251-FR-014
describe('the retention', () => {
  const now = new Date('2026-11-15T03:00:00Z');

  it('keeps 30 days', () => {
    expect(RETENTION_DAYS).toBe(30);
  });

  it('deletes the pairs older than 30 days and keeps the rest', () => {
    const keys = [
      ...pair('staging', '20261001T030000Z'),
      ...pair('staging', '20261016T025959Z'),
      ...pair('staging', '20261016T030000Z'),
      ...pair('staging', '20261115T030000Z'),
    ];
    expect(pruneKeys(keys, 'staging', now)).toEqual([
      ...pair('staging', '20261001T030000Z'),
      ...pair('staging', '20261016T025959Z'),
    ]);
  });

  it('never deletes the newest pair, however old', () => {
    const keys = [
      ...pair('staging', '20250101T030000Z'),
      ...pair('staging', '20250201T030000Z'),
    ];
    expect(pruneKeys(keys, 'staging', now)).toEqual(
      pair('staging', '20250101T030000Z'),
    );
  });

  it("leaves another environment's copies and keys it does not recognise", () => {
    const keys = [
      ...pair('production', '20250101T030000Z'),
      'staging/notes.txt',
      ...pair('staging', '20261115T030000Z'),
    ];
    expect(pruneKeys(keys, 'staging', now)).toEqual([]);
  });

  it('reads the bucket listing on stdin and prints one key per line', () => {
    const listing = {
      Contents: [
        ...pair('staging', '20261001T030000Z'),
        ...pair('staging', '20261115T030000Z'),
      ].map((Key) => ({ Key })),
    };
    const res = run(
      ['prune', 'staging', now.toISOString()],
      {},
      JSON.stringify(listing),
    );
    expect(res.status).toBe(0);
    expect(res.stdout.trim().split('\n')).toEqual(
      pair('staging', '20261001T030000Z'),
    );
  });

  it('prints nothing for an empty bucket', () => {
    const res = run(['prune', 'staging', now.toISOString()], {}, '');
    expect(res.status).toBe(0);
    expect(res.stdout).toBe('');
  });
});

// @traces 251-FR-015
describe('the restore comparison', () => {
  const tables = { account: 42, garage: 17, notification: 0 };

  it('finds nothing when every table holds its rows', () => {
    expect(compare(tables, { ...tables })).toEqual([]);
  });

  it('names a table whose count differs, and one missing on either side', () => {
    expect(compare(tables, { account: 41, garage: 17, review: 3 })).toEqual([
      'table account: manifest 42, restored 41',
      'table notification: missing in restore',
      'table review: missing in manifest',
    ]);
  });

  it('fails from the command line and names the table', () => {
    const dir = mkdtempSync(join(tmpdir(), 'backup-'));
    try {
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ tables }));
      writeFileSync(join(dir, 'same.json'), JSON.stringify(tables));
      writeFileSync(
        join(dir, 'less.json'),
        JSON.stringify({ ...tables, garage: 16 }),
      );
      expect(
        run(['compare', join(dir, 'manifest.json'), join(dir, 'same.json')])
          .status,
      ).toBe(0);
      const res = run([
        'compare',
        join(dir, 'manifest.json'),
        join(dir, 'less.json'),
      ]);
      expect(res.status).toBe(1);
      expect(res.stdout).toContain('table garage: manifest 17, restored 16');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

// @traces 251-FR-015
describe('the drill report', () => {
  it('lists every step with its seconds and the total', () => {
    const text = report('download 12\ndecrypt 3\nrestore 40\n');
    expect(text.split('\n')).toEqual([
      'download   12 s',
      'decrypt     3 s',
      'restore    40 s',
      'total      55 s',
    ]);
  });
});
