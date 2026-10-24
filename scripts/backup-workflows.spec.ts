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

  // @traces 1348-FR-003
  it('backs up staging, and production only while it is on, one failing never stopping the other', () => {
    const matrix = backup.match(/^ {8}environment: (.+)$/m)?.[1] ?? '';
    const [on, off] = [...matrix.matchAll(/'(\[[^']*\])'/g)].map(([, list]) =>
      JSON.parse(list ?? ''),
    );

    expect(matrix).toMatch(/^\$\{\{ fromJSON\(.+\) \}\}$/);
    expect(matrix).toContain("vars.PRODUCTION_ENABLED == 'true' &&");
    expect(on).toEqual(['staging', 'production']);
    expect(off).toEqual(['staging']);
    expect(setting(backup, 'fail-fast')).toBe('false');
    expect(setting(backup, 'environment')).toBe(gh('matrix.environment'));
    expect(setting(backup, 'group')).toBe(`backup-${gh('matrix.environment')}`);
  });

  // @traces 1348-FR-003
  it('notes on the staging leg that production is off, before the settings check', () => {
    const at = backup.indexOf('- name: Note that production is off');
    const note = backup.slice(at, backup.indexOf('- name:', at + 1));

    expect(at).toBeGreaterThan(backup.indexOf('uses: actions/setup-node'));
    expect(at).toBeLessThan(backup.indexOf('node scripts/backup.ts settings'));
    expect(setting(note, 'if')).toBe(
      "matrix.environment == 'staging' && vars.PRODUCTION_ENABLED != 'true'",
    );
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

  // @traces 1371-workflows-no-ssh-FR-001
  it('pins the Railway CLI and closes its sandbox even on failure', () => {
    expect(backup).toMatch(/npm install --global @railway\/cli@\d+\.\d+\.\d+/);
    const at = backup.indexOf('node scripts/railway-sandbox.ts close');
    expect(at).toBeGreaterThan(0);
    expect(backup.slice(backup.lastIndexOf('- name:', at), at)).toMatch(
      /if: always\(\) && steps\.settings\.outputs\.skip != 'true' && steps\.sandbox\.outputs\.id != ''/,
    );
  });

  it('takes the copy with the backup script', () => {
    expect(backup).toContain('bash scripts/backup/backup.sh');
  });
});

// @traces 251-FR-013 1371-workflows-no-ssh-FR-005
describe('the dump', () => {
  const runner = read('scripts', 'backup', 'backup.sh');
  const inside = read('scripts', 'backup', 'sandbox-backup.sh');

  it("runs dump.sh in a sandbox on the private network, in the PostgreSQL service's own image", () => {
    expect(runner).toContain(
      'node scripts/railway-sandbox.ts image "$RAILWAY_SERVICE_POSTGRES"',
    );
    expect(runner).toMatch(/railway-sandbox\.ts exec "\$SANDBOX_ID"/);
    expect(runner).toContain('scripts/backup/dump.sh');
    expect(inside).toMatch(
      /docker run --rm -i --network host --entrypoint sh [^\n]*-e EXPECTED_ENV [^\n]*"\$IMAGE" -s/,
    );
  });

  it('hands the passphrase and bucket keys over stdin only, never as an argument', () => {
    expect(runner).toMatch(
      /railway-sandbox\.ts prelude [^\n]*BACKUP_GPG_PASSPHRASE[^\n]*BACKUP_S3_ACCESS_KEY_ID[^\n]*BACKUP_S3_SECRET_ACCESS_KEY/,
    );
    expect(runner).not.toMatch(/exec "\$SANDBOX_ID"[^\n]*\$BACKUP_/);
    expect(inside).toContain('--passphrase-file');
    expect(inside).not.toMatch(/--passphrase[ =]"?\$/);
  });

  it('encrypts inside the sandbox before anything reaches a disk, and uploads from there', () => {
    expect(inside).toMatch(/gpg [^\n]*--symmetric[^\n]*--cipher-algo AES256/);
    expect(inside).toMatch(
      /amazon\/aws-cli:\d+\.\d+\.\d+ s3 cp [^\n]*dump\.gpg/,
    );
    expect(inside).not.toMatch(/>[^\n]*\.dump\b(?!\.gpg)/);
  });

  it('sends back only the manifest head and the size, never dump bytes', () => {
    expect(inside).toMatch(/^printf 'BACKUP_HEAD %s\\n'/m);
    expect(inside).toMatch(/^printf 'BACKUP_SIZE %s\\n'/m);
    expect(inside).not.toMatch(/cat "\$work\/dump/);
  });

  it('checks the uploaded size against the size the sandbox wrote, then uploads the manifest', () => {
    const check = runner.indexOf('s3api head-object');
    expect(check).toBeGreaterThan(runner.indexOf('railway-sandbox.ts exec'));
    expect(runner.indexOf('.manifest.json')).toBeGreaterThan(check);
    expect(runner).toMatch(/aws s3 cp [^\n]*\.manifest\.json/);
  });

  it('prunes only after both uploads', () => {
    const text = read('scripts', 'backup', 'backup.sh');
    const prune = text.indexOf('backup.ts prune');
    expect(prune).toBeGreaterThan(text.lastIndexOf('aws s3 cp'));
    expect(prune).toBeGreaterThan(text.indexOf('s3api head-object'));
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
    expect(text).toContain('docker rm -f "$DB" "$REDIS" "$STORE"');
  });

  // @traces 1176-FR-004
  it("boots the compose file's object store with an empty drill bucket, waiting a bounded time", () => {
    const text = read('scripts', 'backup', 'restore-drill.sh');
    const image = /^ {4}image: (\S+)$/m.exec(
      read('docker-compose.yml').split(/^ {2}storage:$/m)[1] ?? '',
    )?.[1];

    expect(text).toContain('STORE=mf-restore-drill-storage');
    expect(image).toBeDefined();
    expect(text).toContain(`${image} mini -bucket=drill`);
    expect(text).toMatch(
      /for _ in \$\(seq 60\); do docker exec "\$STORE" [^\n]*\/buckets\/drill\/ && break; sleep 1; done/,
    );
    expect(text).not.toMatch(/\bmc\b/);
  });

  // @traces 1175-FR-001 1175-FR-004
  it('starts its throw-away store from the Valkey image, refusing writes rather than evicting', () => {
    const text = read('scripts', 'backup', 'restore-drill.sh');
    expect(text).toMatch(
      /docker run [^\n]*"\$REDIS"[^\n]* valkey\/valkey:9 valkey-server --maxmemory-policy noeviction/,
    );
    expect(text).not.toMatch(/redis:\d|redis-server|redis-cli/);
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
