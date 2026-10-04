import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const seed = (APP_ENV: string) =>
  spawnSync(process.execPath, [join(__dirname, 'seed.ts')], {
    encoding: 'utf8',
    env: { ...process.env, APP_ENV },
  });

describe('seed', () => {
  it('refuses to run in production', () => {
    const run = seed('production');

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('seed refused: APP_ENV=production');
  });

  it('can run twice', () => {
    expect(seed('test').status).toBe(0);
    expect(seed('test').status).toBe(0);
  });
});
