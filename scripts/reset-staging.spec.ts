import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Staging's Postgres has no public address, so the reset cannot run on a
// GitHub runner: the workflow runs scripts/reset-staging.sh inside the staging
// api service over `railway ssh`. Read as text, like release-workflow.spec.ts.
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
  it('needs no DATABASE_URL: the runner cannot reach staging Postgres', () => {
    expect(workflow).not.toContain('DATABASE_URL');
    expect(workflow).not.toMatch(/prisma|npm ci|nx run/);
  });

  it('is started by hand, against the staging environment only', () => {
    expect(workflow).toMatch(/^on: workflow_dispatch$/m);
    expect(setting('environment')).toBe('staging');
    expect(workflow).not.toMatch(/inputs:/);
  });

  it('waits for a staging release instead of racing its api deploy', () => {
    expect(setting('group')).toBe('release-staging');
    expect(setting('cancel-in-progress')).toBe('false');
  });

  it('runs the reset script inside the staging api service', () => {
    expect(setting('RAILWAY_API_TOKEN')).toBe(gh('secrets.RAILWAY_API_TOKEN'));
    expect(setting('RAILWAY_ENVIRONMENT_ID')).toBe(
      gh('vars.RAILWAY_ENVIRONMENT_ID'),
    );
    expect(setting('RAILWAY_SERVICE_API')).toBe(gh('vars.RAILWAY_SERVICE_API'));
    expect(workflow).toContain('cat scripts/reset-staging.sh');
    expect(workflow).toMatch(
      /railway ssh --project "\$RAILWAY_PROJECT_ID" --environment "\$RAILWAY_ENVIRONMENT_ID" --service "\$RAILWAY_SERVICE_API" -- sh -s/,
    );
  });

  it('pins the Railway CLI', () => {
    expect(workflow).toMatch(
      /npm install --global @railway\/cli@\d+\.\d+\.\d+/,
    );
  });

  it('removes its one-off SSH key even when the reset fails', () => {
    expect(workflow).toContain(
      'railway ssh keys add --key ~/.ssh/id_ed25519.pub --name "$KEY_NAME"',
    );
    expect(workflow).toContain('railway ssh keys remove "$KEY_NAME"');
    const at = workflow.indexOf('railway ssh keys remove');
    const step = workflow.slice(workflow.lastIndexOf('- name:', at), at);

    expect(at).toBeGreaterThan(0);
    expect(step).toMatch(/^ +if: always\(\)$/m);
  });

  it('hands SEED_PASSWORD over stdin, masked, and never echoes it', () => {
    expect(setting('SEED_PASSWORD')).toBe(gh('secrets.SEED_PASSWORD'));
    expect(workflow).toContain('::add-mask::');
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
