import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Staging's Postgres has no public address, so the reset cannot run on a
// GitHub runner: the workflow runs scripts/reset-staging.sh in a sandbox on
// staging's private network, in the staging api's own image. Read as text,
// like release-workflow.spec.ts.
const root = join(__dirname, '..');
const workflow = readFileSync(
  join(root, '.github', 'workflows', 'reset-staging.yml'),
  'utf8',
);
const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
const script = join(__dirname, 'reset-staging.sh');

const setting = (key: string) =>
  workflow.match(new RegExp(`^ +${key}: *(.+)$`, 'm'))?.[1]?.trim();

// A GitHub expression, as the workflow writes it.
const gh = (ref: string) => `\${{ ${ref} }}`;

describe('reset-staging workflow', () => {
  // The sandbox gets the api's address as a Railway reference; the runner
  // only names it to docker, inside the sandbox, and never holds it.
  it('needs no DATABASE_URL: the runner cannot reach staging Postgres', () => {
    expect(workflow.replaceAll('-e DATABASE_URL ', '')).not.toContain(
      'DATABASE_URL',
    );
    expect(workflow).not.toMatch(/prisma|npm ci|nx run/);
  });

  it('is started by hand, against the staging environment only', () => {
    expect(workflow).toMatch(/^on: workflow_dispatch$/m);
    expect(setting('environment')).toBe('staging');
    expect(workflow).not.toMatch(/inputs:/);
  });

  it('runs one at a time, without ever displacing a waiting staging release', () => {
    expect(setting('group')).toBe('reset-staging');
    expect(setting('cancel-in-progress')).toBe('false');
  });

  // @traces 421-FR-031 1371-FR-006
  it("runs the reset script in a staging sandbox, in the api's current image", () => {
    expect(setting('RAILWAY_API_TOKEN')).toBe(gh('secrets.RAILWAY_API_TOKEN'));
    expect(setting('RAILWAY_ENVIRONMENT_ID')).toBe(
      gh('vars.RAILWAY_ENVIRONMENT_ID'),
    );
    expect(setting('RAILWAY_SERVICE_API')).toBe(gh('vars.RAILWAY_SERVICE_API'));
    expect(workflow).toContain(
      'node scripts/railway-sandbox.ts open staging api',
    );
    expect(workflow).toContain(
      'node scripts/railway-sandbox.ts image "$RAILWAY_SERVICE_API"',
    );
    expect(workflow).toContain('cat scripts/reset-staging.sh');
    expect(workflow).toMatch(
      /docker run --rm -i --network host --entrypoint sh -e DATABASE_URL -e APP_ENV -e RAILWAY_ENVIRONMENT_NAME -e SEED_PASSWORD [^\n]*-s/,
    );
    expect(workflow).toMatch(/railway-sandbox\.ts exec "\$SANDBOX_ID"/);
  });

  it('pins the Railway CLI', () => {
    expect(workflow).toMatch(
      /npm install --global @railway\/cli@\d+\.\d+\.\d+/,
    );
  });

  // @traces 1371-FR-001
  it('closes its sandbox even when the reset fails', () => {
    const at = workflow.indexOf('node scripts/railway-sandbox.ts close');
    expect(at).toBeGreaterThan(0);
    expect(workflow.slice(workflow.lastIndexOf('- name:', at), at)).toMatch(
      /if: always\(\) && steps\.sandbox\.outputs\.id != ''/,
    );
    expect(workflow).not.toMatch(/ssh/);
  });

  it('hands SEED_PASSWORD over stdin, masked, and never echoes it', () => {
    expect(setting('SEED_PASSWORD')).toBe(gh('secrets.SEED_PASSWORD'));
    expect(workflow).toContain(
      'node scripts/railway-sandbox.ts mask SEED_PASSWORD',
    );
    expect(workflow).toContain(
      'node scripts/railway-sandbox.ts prelude SEED_PASSWORD',
    );
    expect(workflow).not.toMatch(/echo[^\n]*\$\{?SEED_PASSWORD/);
    expect(workflow).not.toMatch(/set -x|--debug/);
    expect(workflow).not.toMatch(/-- [^\n]*SEED_PASSWORD/);
  });
});

describe('api image', () => {
  it('carries the seed next to the migrations, and only in the api', () => {
    expect(dockerfile).toMatch(
      /if \[ "\$\{APP\}" = api \]; then[\s\S]*libs\/domain\/src\/seed\.ts dist\/apps\/api\/src\//,
    );
  });

  // The staging pre-deploy step runs it from the image's scripts folder.
  // @traces 1370-FR-001
  // @traces 1373-FR-001
  it('carries the pre-deploy, monitor password and reset scripts, only in the api', () => {
    expect(dockerfile).toMatch(
      /if \[ "\$\{APP\}" = api \]; then[\s\S]*cp scripts\/api-pre-deploy\.sh scripts\/monitor-password\.ts scripts\/reset-staging\.sh dist\/apps\/api\/scripts\//,
    );
  });
});

describe('reset-staging.sh', () => {
  // A fake npx records what would have run, so nothing touches a database.
  function run(env: Record<string, string>, exit = 0) {
    const dir = mkdtempSync(join(tmpdir(), 'reset-staging-'));
    const log = join(dir, 'npx.log');
    const npx = join(dir, 'npx');
    writeFileSync(
      npx,
      `#!/bin/sh\necho "$(pwd) $* SEED_PASSWORD=\${SEED_PASSWORD:+set}" >> "${log}"\nexit ${exit}\n`,
    );
    chmodSync(npx, 0o755);
    const result = spawnSync('sh', ['-s'], {
      encoding: 'utf8',
      env: { APP_DIR: dir, PATH: `${dir}:/usr/bin:/bin`, ...env },
      input: readFileSync(script, 'utf8'),
    });
    let calls: string[] = [];
    try {
      calls = readFileSync(log, 'utf8').trim().split('\n');
    } catch {}
    return { calls, dir, result };
  }

  const staging = {
    APP_ENV: 'staging',
    RAILWAY_ENVIRONMENT_NAME: 'staging',
    SEED_PASSWORD: 'not-a-real-password',
  };

  it('empties and migrates, then seeds, in the app directory', () => {
    const { calls, dir, result } = run(staging);

    expect(result.status).toBe(0);
    expect(calls).toEqual([
      `${dir} prisma migrate reset --force SEED_PASSWORD=set`,
      `${dir} prisma db seed SEED_PASSWORD=set`,
    ]);
    expect(result.stdout + result.stderr).not.toContain('not-a-real-password');
  });

  it.each([
    ['APP_ENV is production', { APP_ENV: 'production' }],
    ['APP_ENV is unset', { APP_ENV: '' }],
    ['Railway says production', { RAILWAY_ENVIRONMENT_NAME: 'production' }],
    ['Railway names no environment', { RAILWAY_ENVIRONMENT_NAME: '' }],
    ['SEED_PASSWORD is empty', { SEED_PASSWORD: '' }],
  ])('refuses, running nothing, when %s', (_, change) => {
    const { calls, result } = run({ ...staging, ...change });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('reset refused');
    expect(calls).toEqual([]);
  });

  // The release seeds staging after each deploy, so a seed account added
  // since the last reset exists before the end-to-end run signs in as it.
  it('with SEED_ONLY=1, only seeds: nothing is emptied', () => {
    const { calls, dir, result } = run({ ...staging, SEED_ONLY: '1' });

    expect(result.status).toBe(0);
    expect(calls).toEqual([`${dir} prisma db seed SEED_PASSWORD=set`]);
  });

  it('with SEED_ONLY=1, still refuses outside staging', () => {
    const { calls, result } = run({
      ...staging,
      APP_ENV: 'production',
      SEED_ONLY: '1',
    });

    expect(result.status).not.toBe(0);
    expect(calls).toEqual([]);
  });

  // In the staging pre-deploy step a failed seed fails the api deployment;
  // its log names the step.
  // @traces 1370-FR-004
  it('with SEED_ONLY=1, names the seed and exits non-zero when the seed fails', () => {
    const { calls, result } = run({ ...staging, SEED_ONLY: '1' }, 3);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('staging seed failed: npx prisma db seed');
    expect(calls).toHaveLength(1);
    expect(result.stdout + result.stderr).not.toContain('not-a-real-password');
  });

  it('stops before seeding when the reset fails', () => {
    const { calls, result } = run(staging, 3);

    expect(result.status).toBe(3);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('migrate reset');
  });

  it('is valid POSIX sh', () => {
    expect(() => execFileSync('sh', ['-n', script])).not.toThrow();
  });
});
