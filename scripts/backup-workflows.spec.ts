import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Read as text, like reset-staging.spec.ts: the workflows only run on GitHub.
const root = join(__dirname, '..');
const read = (...path: string[]) => readFileSync(join(root, ...path), 'utf8');
const backup = read('.github', 'workflows', 'backup.yml');
const drill = read('.github', 'workflows', 'restore-drill.yml');
const dump = join(__dirname, 'backup', 'dump.sh');
const scripts = ['dump.sh', 'backup.sh', 'restore-drill.sh'].map((name) =>
  read('scripts', 'backup', name),
);

// A GitHub expression, as the workflow writes it.
const gh = (ref: string) => `\${{ ${ref} }}`;

const setting = (text: string, key: string) =>
  text.match(new RegExp(`^ +${key}: *(.+)$`, 'm'))?.[1]?.trim();

// Every step from the first one after `from` to the end of the job.
const stepsAfter = (text: string, from: string) =>
  text
    .slice(text.indexOf('- name:', text.indexOf(from) + from.length))
    .split(/\n(?= +- name:)/);

// @traces 251-FR-012
describe('the nightly backup workflow', () => {
  it('runs every day at 03:00 UTC and by hand', () => {
    expect(backup).toMatch(/cron: '0 3 \* \* \*'/);
    expect(backup).toMatch(/^ {2}workflow_dispatch:/m);
  });

  it('backs up staging and production on their own, one failing never stopping the other', () => {
    expect(backup).toMatch(/environment: \[staging, production\]/);
    expect(setting(backup, 'fail-fast')).toBe('false');
    expect(setting(backup, 'environment')).toBe(gh('matrix.environment'));
  });

  it('checks its settings first and skips every later step when the environment has none', () => {
    expect(backup).toContain('node scripts/backup.ts settings');
    const later = stepsAfter(backup, 'node scripts/backup.ts settings');
    expect(later.length).toBeGreaterThan(2);
    const work = later.filter((step) => !step.includes('::notice'));
    expect(work.length).toBe(later.length - 1);
    for (const step of work) {
      expect(step).toMatch(/if: .*steps\.settings\.outputs\.skip != 'true'/);
    }
  });

  it('leaves a notice naming the environment when it skips it', () => {
    const [notice] = stepsAfter(backup, 'node scripts/backup.ts settings');
    expect(notice).toMatch(/if: steps\.settings\.outputs\.skip == 'true'/);
    expect(notice).toMatch(/::notice[^\n]*\$ENVIRONMENT/);
  });

  it('pins the Railway CLI and removes its one-off SSH key even on failure', () => {
    expect(backup).toMatch(/npm install --global @railway\/cli@\d+\.\d+\.\d+/);
    const at = backup.indexOf('railway ssh keys remove "$KEY_NAME"');
    expect(at).toBeGreaterThan(0);
    expect(backup.slice(backup.lastIndexOf('- name:', at), at)).toMatch(
      /if: always\(\) && steps\.settings\.outputs\.skip != 'true'/,
    );
    expect(backup).not.toMatch(/StrictHostKeyChecking[ =]no/);
  });

  it('takes the copy with the backup script', () => {
    expect(backup).toContain('bash scripts/backup/backup.sh');
  });
});

// @traces 251-FR-013
describe('the dump', () => {
  it("runs inside the environment's PostgreSQL service", () => {
    expect(read('scripts', 'backup', 'backup.sh')).toMatch(
      /railway ssh --project "\$RAILWAY_PROJECT_ID" --environment "\$RAILWAY_ENVIRONMENT_ID" --service "\$RAILWAY_SERVICE_POSTGRES" -- sh -s/,
    );
  });

  it('encrypts before anything reaches the disk, then uploads the copy and its manifest', () => {
    const text = read('scripts', 'backup', 'backup.sh');
    expect(text).toMatch(/gpg [^\n]*--symmetric[^\n]*--cipher-algo AES256/);
    expect(text).toContain('--passphrase-fd');
    expect(text).toMatch(/aws s3 cp [^\n]*\.dump\.gpg/);
    expect(text).toMatch(/aws s3 cp [^\n]*\.manifest\.json/);
  });

  it('prunes only after both uploads', () => {
    const text = read('scripts', 'backup', 'backup.sh');
    const prune = text.indexOf('backup.ts prune');
    expect(prune).toBeGreaterThan(text.lastIndexOf('aws s3 cp'));
    expect(text).toMatch(/^set -eu/m);
  });

  function runDump(env: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), 'dump-'));
    const log = join(dir, 'psql.log');
    writeFileSync(join(dir, 'psql'), `#!/bin/sh\necho called >> "${log}"\n`);
    chmodSync(join(dir, 'psql'), 0o755);
    const result = spawnSync('sh', ['-s'], {
      encoding: 'utf8',
      env: { PATH: `${dir}:/usr/bin:/bin`, ...env },
      input: readFileSync(dump, 'utf8'),
    });
    let called = false;
    try {
      called = readFileSync(log, 'utf8').length > 0;
    } catch {}
    rmSync(dir, { force: true, recursive: true });
    return { called, result };
  }

  it.each([
    [
      'the container is another environment',
      { RAILWAY_ENVIRONMENT_NAME: 'production' },
    ],
    ['the container names no environment', { RAILWAY_ENVIRONMENT_NAME: '' }],
    ['no environment is expected', { EXPECTED_ENV: '' }],
  ])('refuses to dump when %s', (_label, change) => {
    const { called, result } = runDump({
      EXPECTED_ENV: 'staging',
      RAILWAY_ENVIRONMENT_NAME: 'staging',
      ...change,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('dump refused');
    expect(called).toBe(false);
  });

  it('is valid POSIX sh', () => {
    expect(() => execFileSync('sh', ['-n', dump])).not.toThrow();
  });
});

// @traces 251-FR-015
describe('the restore drill workflow', () => {
  it('runs by hand and on the first day of every quarter, on staging', () => {
    expect(drill).toMatch(/^ {2}workflow_dispatch:/m);
    expect(drill).toMatch(/cron: '0 4 1 1,4,7,10 \*'/);
    expect(setting(drill, 'environment')).toBe('staging');
    expect(drill).toContain('bash scripts/backup/restore-drill.sh');
  });

  it('tears its database down whatever happens', () => {
    const text = read('scripts', 'backup', 'restore-drill.sh');
    expect(text).toMatch(/trap [^\n]*EXIT/);
    expect(text).toContain('DB=mf-restore-drill');
    expect(text).toContain('docker rm -f "$DB" "$REDIS" "$MINIO"');
  });
});

// @traces 251-FR-013 251-FR-017
describe('secrets in the backup jobs', () => {
  it.each([
    ['backup.yml', backup],
    ['restore-drill.yml', drill],
  ])('%s never echoes a secret', (_name, text) => {
    expect(text).not.toMatch(/echo[^\n]*secrets\./);
    expect(text).not.toMatch(/set -x|--debug/);
  });

  it('no script traces its commands, and the backup never reads a database address', () => {
    for (const text of scripts) {
      expect(text).not.toMatch(/set -[a-z]*x/);
    }
    // The drill hands the API its throwaway database's address; the backup
    // reaches the real one only from inside its service.
    for (const text of scripts.slice(0, 2)) {
      expect(text).not.toContain('DATABASE_URL');
    }
  });

  it('keeps the retention in one place', () => {
    const all = [backup, drill, ...scripts, read('scripts', 'backup.ts')].join(
      '\n',
    );
    expect(all.match(/RETENTION_DAYS = /g)).toHaveLength(1);
  });
});

// @traces 251-FR-016
describe('the drill timings', () => {
  it('times every step in order and ends with the total', () => {
    const [, , script = ''] = scripts;
    const steps = [...script.matchAll(/^step (\w+)$/gm)].map((m) => m[1]);

    expect(steps).toEqual([
      'download',
      'decrypt',
      'restore',
      'compare',
      'build',
      'boot',
    ]);
    expect(script.trimEnd()).toMatch(
      /node scripts\/backup\.ts report <"\$work\/steps"$/,
    );
  });
});
