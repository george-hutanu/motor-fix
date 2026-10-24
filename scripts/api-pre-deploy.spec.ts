import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apiPreDeploy } from './railway-deploy.ts';

// Railway runs a pre-deploy command split into words, with no shell: in
// 2026-10 the old `migrate && monitor && seed` string reached prisma as extra
// arguments, prisma ignored them, and no staging deploy ever seeded.
// So each command here is run exactly that way, against stand-in steps in an
// app directory laid out like the api image's /app.
const apps: string[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) {
    rmSync(app, { force: true, recursive: true });
  }
});

function deployIn(environment: string, failing?: 'npx' | 'node' | 'reset') {
  const app = mkdtempSync(join(tmpdir(), 'api-pre-deploy-'));
  apps.push(app);
  const bin = join(app, 'bin');
  const log = join(app, 'steps.log');
  mkdirSync(bin);
  mkdirSync(join(app, 'scripts'));
  copyFileSync(
    join(__dirname, 'api-pre-deploy.sh'),
    join(app, 'scripts', 'api-pre-deploy.sh'),
  );
  const step = (name: string, exit: number) =>
    `#!/bin/sh\necho "${name} $* SEED_ONLY=\${SEED_ONLY:-unset}" >> "${log}"\nexit ${exit}\n`;
  for (const name of ['npx', 'node'] as const) {
    writeFileSync(join(bin, name), step(name, failing === name ? 7 : 0));
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(
    join(app, 'scripts', 'reset-staging.sh'),
    step('reset', failing === 'reset' ? 9 : 0),
  );
  const [command, ...args] = (apiPreDeploy(environment)[0] ?? '').split(/ +/);
  const result = spawnSync(command ?? '', args, {
    cwd: app,
    encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin` },
  });
  let steps: string[] = [];
  try {
    steps = readFileSync(log, 'utf8').trim().split('\n');
  } catch {}
  return { result, steps };
}

// @traces 1373-FR-001
describe('the api pre-deploy command, run as Railway runs it', () => {
  it.each(['staging', 'production'])(
    'holds no shell syntax for %s, only plain words',
    (environment) => {
      const commands = apiPreDeploy(environment);

      expect(commands).toEqual([`sh scripts/api-pre-deploy.sh ${environment}`]);
      expect(commands.join(' ')).not.toMatch(/[&|;<>"'`$=]/);
    },
  );

  it('migrates, sets the monitor password, then seeds staging only, in that order', () => {
    const { result, steps } = deployIn('staging');

    expect(result.status).toBe(0);
    expect(steps).toEqual([
      'npx prisma migrate deploy SEED_ONLY=unset',
      'node scripts/monitor-password.ts SEED_ONLY=unset',
      'reset  SEED_ONLY=1',
    ]);
  });

  it('migrates and sets the monitor password in production, and never seeds', () => {
    const { result, steps } = deployIn('production');

    expect(result.status).toBe(0);
    expect(steps).toEqual([
      'npx prisma migrate deploy SEED_ONLY=unset',
      'node scripts/monitor-password.ts SEED_ONLY=unset',
    ]);
  });

  it.each([
    ['npx', 7, 1],
    ['node', 7, 2],
    ['reset', 9, 3],
  ] as const)(
    'stops at a failing %s step with its exit code, running nothing after it',
    (failing, code, ran) => {
      const { result, steps } = deployIn('staging', failing);

      expect(result.status).toBe(code);
      expect(steps).toHaveLength(ran);
    },
  );

  it.each(['', 'Staging', 'prod', 'development', 'staging production'])(
    'refuses the environment %p before any step',
    (environment) => {
      const result = spawnSync(
        'sh',
        [join(__dirname, 'api-pre-deploy.sh'), ...environment.split(' ')],
        { cwd: __dirname, encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } },
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('usage: api-pre-deploy.sh');
    },
  );
});
