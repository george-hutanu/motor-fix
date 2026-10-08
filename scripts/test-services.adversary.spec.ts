import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  composeProject,
  parseStacks,
  parseWorktrees,
  sweepPlan,
} from './test-services.ts';

const stackOf = (dir: string, exists = true) => ({
  dir,
  exists,
  name: composeProject(dir),
});

describe('parseStacks, hostile input', () => {
  it('reads a listing of one stack with a single compose file', () => {
    const json = JSON.stringify([
      { ConfigFiles: '/w/a/compose.yml', Name: 'mf-test-a-111111' },
    ]);
    expect(parseStacks(json)).toEqual([
      { dir: '/w/a', name: 'mf-test-a-111111' },
    ]);
  });

  it('reads whitespace-only output as no stacks', () => {
    expect(parseStacks('  \n ')).toEqual([]);
  });

  it('keeps a folder with a space in its name whole', () => {
    const json = JSON.stringify([
      { ConfigFiles: '/w/My Tree/docker-compose.yml', Name: 'mf-test-x-1' },
    ]);
    expect(parseStacks(json)).toEqual([
      { dir: '/w/My Tree', name: 'mf-test-x-1' },
    ]);
  });

  it('reads ten thousand stacks', () => {
    const json = JSON.stringify(
      Array.from({ length: 10000 }, (_, i) => ({
        ConfigFiles: `/w/${i}/docker-compose.yml`,
        Name: `mf-test-${i}-aaaaaa`,
      })),
    );
    expect(parseStacks(json)).toHaveLength(10000);
  });
});

describe('parseWorktrees, hostile input', () => {
  it('reads empty output as no worktrees', () => {
    expect(parseWorktrees('')).toEqual([]);
  });

  it('keeps a branch name with slashes whole', () => {
    expect(
      parseWorktrees('worktree /r/a\nHEAD 1\nbranch refs/heads/feat/x-1\n'),
    ).toEqual([{ branch: 'feat/x-1', path: '/r/a' }]);
  });

  it('keeps a path with spaces whole and reads the last block without a trailing blank line', () => {
    expect(
      parseWorktrees(
        'worktree /r\nbranch refs/heads/main\n\nworktree /r/My Tree\nbranch refs/heads/b',
      ),
    ).toEqual([
      { branch: 'main', path: '/r' },
      { branch: 'b', path: '/r/My Tree' },
    ]);
  });

  it('reads a locked or prunable worktree as a worktree', () => {
    expect(
      parseWorktrees(
        'worktree /r/a\nHEAD 1\nbranch refs/heads/a\nlocked reason\nprunable gitdir file points to non-existent location\n',
      ),
    ).toEqual([{ branch: 'a', path: '/r/a' }]);
  });

  it('reads a bare repository as a worktree with no branch', () => {
    expect(parseWorktrees('worktree /r.git\nbare\n')).toEqual([
      { branch: undefined, path: '/r.git' },
    ]);
  });
});

describe('sweepPlan, hostile input', () => {
  const wt = '/r/.claude/worktrees/a';
  const worktrees = [{ branch: 'a', path: wt }];

  it('plans nothing for no stacks', () => {
    expect(sweepPlan([], worktrees, [])).toEqual([]);
    expect(sweepPlan([], [], null)).toEqual([]);
  });

  it('judges the newest PR by number whatever the order of the list', () => {
    const prs = [
      { headRefName: 'a', number: 12, state: 'OPEN' },
      { headRefName: 'a', number: 5, state: 'MERGED' },
    ];
    expect(sweepPlan([stackOf(wt)], worktrees, prs)).toEqual([]);
    expect(sweepPlan([stackOf(wt)], worktrees, [...prs].reverse())).toEqual([]);
  });

  it('stops a stack whose newest PR merged after an older one closed, in any order', () => {
    const prs = [
      { headRefName: 'a', number: 9, state: 'MERGED' },
      { headRefName: 'a', number: 3, state: 'OPEN' },
    ];
    const expected = [
      { project: composeProject(wt), reason: 'PR #9 merged', volumes: false },
    ];
    expect(sweepPlan([stackOf(wt)], worktrees, prs)).toEqual(expected);
    expect(sweepPlan([stackOf(wt)], worktrees, [...prs].reverse())).toEqual(
      expected,
    );
  });

  it('does not take a PR of a branch with a similar name for the worktree branch', () => {
    const prs = [{ headRefName: 'a-2', number: 4, state: 'MERGED' }];
    expect(sweepPlan([stackOf(wt)], worktrees, prs)).toEqual([]);
  });

  it('treats a gone worktree as gone even when its branch has a merged PR, with volumes', () => {
    const prs = [{ headRefName: 'a', number: 4, state: 'MERGED' }];
    expect(sweepPlan([stackOf(wt, false)], worktrees, prs)).toEqual([
      { project: composeProject(wt), reason: 'worktree gone', volumes: true },
    ]);
  });

  it('stops a gone worktree stack even when no worktree list could be read', () => {
    expect(sweepPlan([stackOf(wt, false)], [], null)).toEqual([
      { project: composeProject(wt), reason: 'worktree gone', volumes: true },
    ]);
  });

  it('leaves a stack alone whose folder exists and no worktree matches', () => {
    expect(sweepPlan([stackOf(wt)], [], [])).toEqual([]);
  });

  it('does not match a stack whose folder differs by a trailing slash', () => {
    const slashed = { dir: `${wt}/`, exists: true, name: composeProject(wt) };
    const prs = [{ headRefName: 'a', number: 4, state: 'MERGED' }];
    expect(sweepPlan([slashed], worktrees, prs)).toEqual([]);
  });

  it('never stops a stack named like a test stack that composeProject did not give', () => {
    const forged = { dir: wt, exists: false, name: 'mf-test-a-000000' };
    expect(sweepPlan([forged], worktrees, [])).toEqual([]);
  });
});

describe('down and sweep, adversarial runs against fake binaries', () => {
  const cwd = join(__dirname, '..');
  let bin: string;
  let log: string;

  const fake = (name: string, body: string) => {
    writeFileSync(
      join(bin, name),
      `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`,
    );
    chmodSync(join(bin, name), 0o755);
  };
  const run = (...args: string[]) =>
    spawnSync('node', ['scripts/test-services.ts', ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
  const calls = () => readFileSync(log, 'utf8').split('\n').filter(Boolean);

  beforeEach(() => {
    bin = mkdtempSync(join(tmpdir(), 'test-stacks-adv-'));
    log = join(bin, 'calls.log');
    writeFileSync(log, '');
  });
  afterEach(() => rmSync(bin, { force: true, recursive: true }));

  it('down keeps the volumes even for a worktree folder that is gone', () => {
    fake('docker', 'exit 0');
    run('down', '/does/not/exist/anywhere');
    const downs = calls().filter((c) => c.includes(' down'));
    expect(downs).toEqual([
      `docker compose -p ${composeProject('/does/not/exist/anywhere')} down`,
    ]);
  });

  it('down gives a path with spaces and unicode the project composeProject gives', () => {
    fake('docker', 'exit 0');
    const path = '/r/.claude/worktrees/Atelier Mécanique ünï';
    const result = run('down', path);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      project: composeProject(path),
      stopped: true,
    });
  });

  it('down prints a single line of JSON', () => {
    fake('docker', 'exit 0');
    expect(run('down', '/r/x').stdout.trim().split('\n')).toHaveLength(1);
  });

  it('down twice gives the same result both times', () => {
    fake('docker', 'exit 0');
    const first = run('down', '/r/x');
    const second = run('down', '/r/x');
    expect(second.stdout).toBe(first.stdout);
    expect(second.status).toBe(0);
  });

  it('down keeps its output to one line when Docker prints a long multi-line error', () => {
    fake(
      'docker',
      'case "$1" in info) exit 0;; esac\nprintf "a\\nb\\nc\\n" >&2\nexit 1',
    );
    const result = run('down', '/r/x');
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(result.stdout).stopped).toBe(false);
  });

  describe('sweep', () => {
    let root: string;

    const docker = (ls: string, down = 'exit 0') =>
      fake(
        'docker',
        [
          'case "$1 $2" in',
          '  "info "*) exit 0;;',
          `  "compose ls") ${ls};;`,
          'esac',
          down,
        ].join('\n'),
      );
    const listing = (dirs: string[]) =>
      JSON.stringify(
        dirs.map((dir) => ({
          ConfigFiles: `${dir}/docker-compose.yml`,
          Name: composeProject(dir),
        })),
      );
    const emit = (json: string) => {
      writeFileSync(join(bin, 'ls.json'), json);
      return `cat "${join(bin, 'ls.json')}"; exit 0`;
    };

    beforeEach(() => {
      root = join(bin, 'repo');
      mkdirSync(root, { recursive: true });
      fake('git', 'exit 0');
      fake('gh', 'echo "[]"');
    });

    it('stops nothing and exits 0 when the compose listing is not JSON', () => {
      docker(emit('this is not json'));
      const result = run('sweep');
      expect(result.status).toBe(0);
      expect(calls().some((c) => c.includes(' down'))).toBe(false);
    });

    it('stops nothing and exits 0 when the compose listing fails', () => {
      docker('echo broken >&2; exit 1');
      const result = run('sweep');
      expect(result.status).toBe(0);
      expect(calls().some((c) => c.includes(' down'))).toBe(false);
    });

    it('stops the gone stacks and exits 0 when gh prints something that is not JSON', () => {
      const gone = join(root, 'gone');
      docker(emit(listing([gone])));
      fake('gh', 'echo "<html>rate limited</html>"');
      const result = run('sweep');
      expect(result.status).toBe(0);
      expect(calls()).toContain(
        `docker compose -p ${composeProject(gone)} down -v`,
      );
    });

    it('stops the gone stacks and exits 0 when git cannot list the worktrees', () => {
      const gone = join(root, 'gone');
      docker(emit(listing([gone])));
      fake('git', 'echo fatal >&2; exit 128');
      const result = run('sweep');
      expect(result.status).toBe(0);
      expect(calls()).toContain(
        `docker compose -p ${composeProject(gone)} down -v`,
      );
    });

    it('never touches a compose project that is not a test stack, gone or not', () => {
      const dir = join(root, 'gone');
      docker(
        emit(
          JSON.stringify([
            { ConfigFiles: `${dir}/docker-compose.yml`, Name: 'motor-fix' },
            { ConfigFiles: `${dir}/docker-compose.yml`, Name: 'mf-tester' },
            { ConfigFiles: `${dir}/docker-compose.yml`, Name: 'xmf-test-a-1' },
          ]),
        ),
      );
      const result = run('sweep');
      expect(result.status).toBe(0);
      expect(calls().some((c) => c.includes(' down'))).toBe(false);
      expect(result.stdout.trim()).toBe('test-services: nothing to stop');
    });

    it('does not claim a stack stopped when every down fails', () => {
      const gone = join(root, 'gone');
      docker(emit(listing([gone])), 'echo boom >&2; exit 1');
      const result = run('sweep');
      expect(result.status).toBe(0);
      expect(result.stdout).not.toMatch(/: stopped /);
      expect(result.stdout.trim()).toBe(
        `test-services: not stopped ${composeProject(gone)} (boom)`,
      );
    });

    it('prints a single line however many stacks it stops', () => {
      const dirs = Array.from({ length: 25 }, (_, i) => join(root, `g${i}`));
      docker(emit(listing(dirs)));
      const result = run('sweep');
      expect(result.stdout.trim().split('\n')).toHaveLength(1);
      expect(calls().filter((c) => c.endsWith(' down -v'))).toHaveLength(25);
    });

    it('stops a merged stack whose worktree is on a branch with slashes', () => {
      const wt = join(root, 'wt');
      mkdirSync(wt);
      docker(emit(listing([wt])));
      fake('git', `printf 'worktree ${wt}\\nbranch refs/heads/feat/x\\n\\n'`);
      fake(
        'gh',
        `echo '[{"headRefName":"feat/x","number":3,"state":"MERGED"}]'`,
      );
      run('sweep');
      expect(calls()).toContain(`docker compose -p ${composeProject(wt)} down`);
    });

    it('prints the same line on a second sweep when the listing is unchanged', () => {
      const gone = join(root, 'gone');
      docker(emit(listing([gone])));
      expect(run('sweep').stdout).toBe(run('sweep').stdout);
    });
  });
});
