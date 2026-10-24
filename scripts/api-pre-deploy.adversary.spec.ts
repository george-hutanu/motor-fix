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

const apps: string[] = [];
afterEach(() => {
  for (const dir of apps.splice(0))
    rmSync(dir, { force: true, recursive: true });
});

function layout(exits: { npx?: number; node?: number; reset?: number } = {}) {
  const app = mkdtempSync(join(tmpdir(), 'api-pre-deploy-adv-'));
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
    `#!/bin/sh\necho "${name} $*" | sed "s/ *$//" >> "${log}"\nexit ${exit}\n`;
  writeFileSync(join(bin, 'npx'), step('npx', exits.npx ?? 0));
  writeFileSync(join(bin, 'node'), step('node', exits.node ?? 0));
  writeFileSync(
    join(app, 'scripts', 'reset-staging.sh'),
    step('reset', exits.reset ?? 0),
  );
  chmodSync(join(bin, 'npx'), 0o755);
  chmodSync(join(bin, 'node'), 0o755);
  const steps = () => {
    try {
      return readFileSync(log, 'utf8').trim().split('\n');
    } catch {
      return [];
    }
  };
  return { app, bin, steps };
}

const runWords = (app: string, bin: string, words: string[], env = {}) =>
  spawnSync('sh', ['scripts/api-pre-deploy.sh', ...words], {
    cwd: app,
    encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin`, ...env },
  });

describe('the api pre-deploy script and command, attacked', () => {
  // @traces 1373-FR-001
  it.each([
    '',
    'Production',
    'staging ',
    ' staging',
    'staging\n',
    'stag*',
    'dev',
  ])('throws for the environment %p', (environment) => {
    expect(() => apiPreDeploy(environment)).toThrow();
  });

  // @traces 1373-FR-001
  it('gives production exactly the one plain-word string', () => {
    expect(apiPreDeploy('production')).toEqual([
      'sh scripts/api-pre-deploy.sh production',
    ]);
  });

  // @traces 1373-FR-001
  it('refuses a missing environment argument before any step', () => {
    const { app, bin, steps } = layout();

    const result = runWords(app, bin, []);

    expect(result.status).not.toBe(0);
    expect(steps()).toEqual([]);
  });

  // @traces 1373-FR-001
  it.each([
    ['staging extra', ['staging', 'extra']],
    ['production --force', ['production', '--force']],
    ['a staging-looking injection', ['staging; touch pwned']],
    ['an upper-case name', ['STAGING']],
    ['a path-like name', ['../staging']],
    ['a glob', ['*']],
  ])('refuses %s before any step', (_, words) => {
    const { app, bin, steps } = layout();

    const result = runWords(app, bin, words);

    expect(result.status).not.toBe(0);
    expect(steps()).toEqual([]);
  });

  // @traces 1373-FR-001
  it.each([1, 2, 42, 126, 255])(
    'stops at a failing monitor password step with exit code %i, never seeding',
    (code) => {
      const { app, bin, steps } = layout({ node: code });

      const result = runWords(app, bin, ['staging']);

      expect(result.status).toBe(code);
      expect(steps()).toHaveLength(2);
    },
  );

  // @traces 1373-FR-001
  it('stops production at a failing migration with its exit code', () => {
    const { app, bin, steps } = layout({ npx: 5 });

    const result = runWords(app, bin, ['production']);

    expect(result.status).toBe(5);
    expect(steps()).toEqual(['npx prisma migrate deploy']);
  });

  // @traces 1373-FR-001
  it('never runs the seed in production even when a seed variable is already set', () => {
    const { app, bin, steps } = layout();

    const result = runWords(app, bin, ['production'], { SEED_ONLY: '1' });

    expect(result.status).toBe(0);
    expect(steps()).toEqual([
      'npx prisma migrate deploy',
      'node scripts/monitor-password.ts',
    ]);
  });

  // @traces 1373-FR-001
  it('runs the reset last on staging with no arguments', () => {
    const { app, bin, steps } = layout();

    const result = runWords(app, bin, ['staging']);

    expect(result.status).toBe(0);
    expect(steps().at(-1)).toBe('reset');
  });

  // @traces 1373-FR-001
  it('runs each step once, so a second call repeats the same three steps', () => {
    const { app, bin, steps } = layout();

    runWords(app, bin, ['staging']);
    runWords(app, bin, ['staging']);

    expect(steps()).toEqual([
      'npx prisma migrate deploy',
      'node scripts/monitor-password.ts',
      'reset',
      'npx prisma migrate deploy',
      'node scripts/monitor-password.ts',
      'reset',
    ]);
  });

  // @traces 1373-FR-001
  it('fails the deploy when the reset script is missing on staging', () => {
    const { app, bin, steps } = layout();
    rmSync(join(app, 'scripts', 'reset-staging.sh'));

    const result = runWords(app, bin, ['staging']);

    expect(result.status).not.toBe(0);
    expect(steps()).toHaveLength(2);
  });

  // @traces 1373-FR-001
  it('fails the deploy when npx is not on the path, running nothing', () => {
    const { app, steps } = layout();

    const result = spawnSync('sh', ['scripts/api-pre-deploy.sh', 'staging'], {
      cwd: app,
      encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin' },
    });

    expect(result.status).not.toBe(0);
    expect(steps().filter((line) => line === 'reset')).toEqual([]);
  });
});
