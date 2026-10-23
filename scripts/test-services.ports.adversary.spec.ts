import {
  type ChildProcess,
  execFileSync,
  spawn,
  spawnSync,
} from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = join(__dirname, 'test-services.ts');
const vars = [
  'API_PORT',
  'WORKER_PORT',
  'WEB_PORT',
  'PORT',
  'API_INTERNAL_URL',
  'PUBLIC_WEB_URL',
];

// @traces 1363-FR-005
describe('the port set and restart against stale and hostile state', () => {
  let dir: string;
  let bin: string;
  let main: string;
  let sibling: string;
  const children: ChildProcess[] = [];

  const env = () => {
    const out: NodeJS.ProcessEnv = { PATH: `${bin}:${process.env.PATH}` };
    for (const [key, value] of Object.entries(process.env))
      if (!key.startsWith('GIT_') && !vars.includes(key) && key !== 'PATH')
        out[key] = value;
    return out;
  };
  const cli = (cwd: string, ...args: string[]) =>
    spawnSync('node', [script, ...args], { cwd, encoding: 'utf8', env: env() });
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@example.test',
        ...args,
      ],
      { cwd, encoding: 'utf8', env: env() },
    );
  const cache = (root: string, file: string) =>
    join(root, '.specify', '.cache', file);
  const alive = (n: number) => {
    try {
      process.kill(n, 0);
      return true;
    } catch {
      return false;
    }
  };
  const until = async (done: () => boolean) => {
    for (let i = 0; i < 100 && !done(); i++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    return done();
  };

  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'port-adv-')));
    bin = join(dir, 'bin');
    main = join(dir, 'wt');
    sibling = join(dir, 'wt-2');
    mkdirSync(bin);
    mkdirSync(main);
    writeFileSync(
      join(bin, 'npx'),
      '#!/bin/sh\necho "$PORT" > "$PWD/.specify/.cache/$3.started"\nexec sleep 300\n',
    );
    chmodSync(join(bin, 'npx'), 0o755);
    git(main, 'init', '-q');
    git(main, 'commit', '-q', '--allow-empty', '-m', 'first');
    git(main, 'worktree', 'add', '-q', sibling);
  });

  const stop = (root: string, app: string) => {
    try {
      process.kill(
        Number(readFileSync(cache(root, `${app}.pid`), 'utf8')),
        'SIGKILL',
      );
    } catch {}
  };

  afterAll(() => {
    for (const root of [main, sibling])
      for (const app of ['api', 'worker', 'web']) stop(root, app);
    for (const child of children) child.kill('SIGKILL');
    rmSync(dir, { force: true, recursive: true });
  });

  it('a pid file naming an unrelated live process is replaced, and that process is left running', async () => {
    const stranger = spawn('sleep', ['300'], {
      cwd: tmpdir(),
      detached: true,
      stdio: 'ignore',
    });
    children.push(stranger);
    cli(main, 'ports');
    writeFileSync(cache(main, 'api.pid'), `${stranger.pid}\n`);
    const result = cli(main, 'restart', 'api');
    expect(result.status).toBe(0);
    expect(alive(stranger.pid as number)).toBe(true);
    expect(
      await until(() =>
        alive(Number(readFileSync(cache(main, 'api.pid'), 'utf8'))),
      ),
    ).toBe(true);
  }, 30000);

  it('a restart in one worktree leaves the dev server of a sibling folder sharing its name prefix running', async () => {
    expect(cli(sibling, 'restart', 'api').status).toBe(0);
    const theirs = Number(readFileSync(cache(sibling, 'api.pid'), 'utf8'));
    expect(await until(() => alive(theirs))).toBe(true);
    expect(cli(main, 'restart', 'api').status).toBe(0);
    expect(cli(main, 'restart', 'api').status).toBe(0);
    expect(alive(theirs)).toBe(true);
  }, 30000);

  it('a pid file that is empty, holds text, or holds a pid that does not exist does not stop a restart', () => {
    cli(main, 'ports');
    for (const junk of ['', 'not a pid\n', '99999999\n', '-1\n', '0\n']) {
      writeFileSync(cache(main, 'worker.pid'), junk);
      const result = cli(main, 'restart', 'worker');
      expect([junk, result.status]).toEqual([junk, 0]);
      expect(result.stderr).not.toMatch(/Error|at .*\.ts:\d+/);
    }
  }, 30000);

  it('a ports file that is damaged is replaced by a fresh set of three distinct ports', () => {
    for (const junk of [
      '',
      '{not json',
      '{"api":1}',
      '{"api":"x","web":2,"worker":3}',
      'null',
    ]) {
      writeFileSync(cache(main, 'ports.json'), junk);
      const result = cli(main, 'ports');
      expect([junk, result.status]).toEqual([junk, 0]);
      const set = JSON.parse(readFileSync(cache(main, 'ports.json'), 'utf8'));
      const ports = [set.api, set.worker, set.web];
      expect(new Set(ports).size).toBe(3);
      for (const port of ports) {
        expect(Number.isInteger(port) && port > 1023 && port < 65536).toBe(
          true,
        );
      }
    }
  });

  it('ports run from a subfolder of the worktree gives the worktree its set, not the subfolder one', () => {
    mkdirSync(join(main, 'apps', 'api'), { recursive: true });
    const top = cli(main, 'ports');
    const nested = cli(join(main, 'apps', 'api'), 'ports');
    expect([nested.status, nested.stderr]).toEqual([0, '']);
    expect(nested.stdout).toBe(top.stdout);
  });

  it('a worktree path with a space and a quote prints exports a shell reads back', () => {
    const odd = join(dir, "o'dd wt");
    git(main, 'worktree', 'add', '-q', '-b', 'odd-wt', odd);
    const result = cli(odd, 'ports');
    expect(result.status).toBe(0);
    const shell = spawnSync(
      'sh',
      ['-c', `${result.stdout}\nprintf '%s' "$API_PORT"`],
      { encoding: 'utf8' },
    );
    expect(shell.stdout).toMatch(/^\d+$/);
  });
});
