import { execFileSync, spawnSync } from 'node:child_process';
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
  needsServices,
  noDockerMessage,
  parsePort,
  parseStacks,
  parseWorktrees,
  projectName,
  schemaDrift,
  serviceEnv,
  shellExports,
  sweepPlan,
} from './test-services.ts';

describe('composeProject', () => {
  it('names the project after the worktree, in characters compose accepts', () => {
    const name = composeProject(
      '/Users/me/motor-fix/.claude/worktrees/Hopeful Hopper_2',
    );
    expect(name).toMatch(/^mf-test-hopeful-hopper_2-[0-9a-f]{6}$/);
  });

  it('gives two worktrees with the same folder name different projects', () => {
    expect(composeProject('/a/.worktrees/x')).not.toBe(
      composeProject('/a/.claude/worktrees/x'),
    );
  });

  it('gives the same worktree the same project every time', () => {
    expect(composeProject('/a/b')).toBe(composeProject('/a/b'));
  });
});

describe('needsServices', () => {
  const projects = [
    { name: 'api', root: 'apps/api' },
    { name: 'domain', root: 'libs/domain' },
    { name: 'web', root: 'apps/web' },
    { name: 'api-docs', root: 'apps/api-docs' },
  ];
  const specs = [
    'apps/api/src/bootstrap.integration.spec.ts',
    'libs/domain/src/audit/audit.service.integration.spec.ts',
  ];

  it('is true when an affected project holds an integration spec', () => {
    expect(needsServices(['web', 'domain'], specs, projects)).toBe(true);
  });

  it('is false when no affected project holds one', () => {
    expect(needsServices(['web', 'scripts'], specs, projects)).toBe(false);
    expect(needsServices([], specs, projects)).toBe(false);
  });

  it('does not take a sibling folder with a longer name for the project', () => {
    expect(
      needsServices(
        ['api-docs'],
        ['apps/api/src/bootstrap.integration.spec.ts'],
        projects,
      ),
    ).toBe(false);
  });
});

describe('parsePort', () => {
  it('reads the host port docker compose port prints', () => {
    expect(parsePort('0.0.0.0:55001\n')).toBe(55001);
    expect(parsePort('[::]:55002\n0.0.0.0:55002\n')).toBe(55002);
  });

  it('refuses output with no port', () => {
    expect(() => parsePort('')).toThrow(/no published port/);
  });
});

describe('serviceEnv', () => {
  it('points the tests at the private services on their ports', () => {
    expect(serviceEnv({ postgres: 55001, redis: 55002 })).toEqual({
      DATABASE_URL: 'postgresql://motorfix:motorfix@127.0.0.1:55001/motorfix',
      REDIS_URL: 'redis://127.0.0.1:55002',
    });
  });
});

describe('shellExports', () => {
  it('prints exports a POSIX shell evaluates back to the same values', () => {
    const env = { A: "it's", B: 'x y $HOME `id`' };
    const out = execFileSync(
      'sh',
      ['-c', `${shellExports(env)}\nprintf '%s|%s' "$A" "$B"`],
      { encoding: 'utf8' },
    );
    expect(out).toBe("it's|x y $HOME `id`");
  });
});

describe('noDockerMessage', () => {
  it('names the commands that bring the services up by hand', () => {
    const message = noDockerMessage('mf-test-x-abc123');
    expect(message).toContain(
      'POSTGRES_PORT=0 REDIS_PORT=0 docker compose -p mf-test-x-abc123 up -d --wait postgres redis',
    );
    expect(message).toContain('npx prisma migrate deploy');
    expect(message).toMatch(/JEST_SUITE/);
  });
});

describe('projectName', () => {
  it('reads the name from project.json', () => {
    expect(projectName('libs/domain/project.json', { name: 'domain' })).toBe(
      'domain',
    );
  });

  it('refuses a project.json without a name rather than skip its specs', () => {
    expect(() => projectName('libs/x/project.json', {})).toThrow(
      /libs\/x\/project\.json has no name/,
    );
  });
});

describe('schemaDrift', () => {
  const a = { checksum: 'aaa', name: '20261004_a' };
  const b = { checksum: 'bbb', name: '20261005_b' };

  it('is false when the database holds only the branch migrations, some still to apply', () => {
    expect(schemaDrift([], [a, b])).toBe(false);
    expect(schemaDrift([a], [a, b])).toBe(false);
    expect(schemaDrift([a, b], [a, b])).toBe(false);
  });

  it('is true when the database holds a migration the branch does not have', () => {
    expect(schemaDrift([a, b], [a])).toBe(true);
  });

  it('is true when a migration of the same name was applied with other SQL', () => {
    expect(schemaDrift([{ ...b, checksum: 'other' }], [a, b])).toBe(true);
  });
});

describe('the script, without Docker', () => {
  it('stops with the commands to run and prints no exports', () => {
    const bin = mkdtempSync(join(tmpdir(), 'no-docker-'));
    try {
      writeFileSync(join(bin, 'docker'), '#!/bin/sh\nexit 1\n');
      chmodSync(join(bin, 'docker'), 0o755);
      // From the first commit every project is affected, domain included.
      const root = execFileSync(
        'git',
        ['rev-list', '--max-parents=0', 'HEAD'],
        {
          encoding: 'utf8',
        },
      ).split('\n')[0];
      // Nx runs this project's tests from scripts/; the hook runs the script
      // from the repository root. Stryker runs them from a copy in an ignored
      // folder, where git lists no files unless it is told the copy is the
      // work tree.
      const cwd = join(__dirname, '..');
      const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
        cwd,
        encoding: 'utf8',
      }).trim();
      const run = spawnSync('node', ['scripts/test-services.ts', root], {
        cwd,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_DIR: gitDir,
          GIT_WORK_TREE: cwd,
          NX_DAEMON: 'false',
          PATH: `${bin}:${process.env.PATH}`,
        },
      });
      expect(run.status).toBe(1);
      expect(run.stdout).toBe('');
      expect(run.stderr).toMatch(/docker compose -p mf-test-.* up -d --wait/);
    } finally {
      rmSync(bin, { force: true, recursive: true });
    }
  }, 120000);
});

describe('parseStacks', () => {
  it('reads each compose project and the folder its compose file sits in', () => {
    const json = JSON.stringify([
      {
        ConfigFiles: '/w/a/docker-compose.yml',
        Name: 'mf-test-a-111111',
        Status: 'running(2)',
      },
      {
        ConfigFiles: '/w/b/docker-compose.yml,/w/b/override.yml',
        Name: 'mf-test-b-222222',
        Status: 'exited(2)',
      },
    ]);
    expect(parseStacks(json)).toEqual([
      { dir: '/w/a', name: 'mf-test-a-111111' },
      { dir: '/w/b', name: 'mf-test-b-222222' },
    ]);
  });

  it('reads an empty listing as no stacks', () => {
    expect(parseStacks('[]')).toEqual([]);
    expect(parseStacks('')).toEqual([]);
  });
});

describe('parseWorktrees', () => {
  it('reads each worktree path and its branch, none for a detached HEAD', () => {
    const porcelain = [
      'worktree /r',
      'HEAD 1111',
      'branch refs/heads/main',
      '',
      'worktree /r/.claude/worktrees/974-x',
      'HEAD 2222',
      'branch refs/heads/974-x',
      '',
      'worktree /r/.claude/worktrees/loose',
      'HEAD 3333',
      'detached',
      '',
    ].join('\n');
    expect(parseWorktrees(porcelain)).toEqual([
      { branch: 'main', path: '/r' },
      { branch: '974-x', path: '/r/.claude/worktrees/974-x' },
      { branch: undefined, path: '/r/.claude/worktrees/loose' },
    ]);
  });
});

describe('sweepPlan', () => {
  const merged = '/r/.claude/worktrees/merged';
  const closed = '/r/.claude/worktrees/closed';
  const open = '/r/.claude/worktrees/open';
  const fresh = '/r/.claude/worktrees/fresh';
  const loose = '/r/.claude/worktrees/loose';
  const worktrees = [
    { branch: 'main', path: '/r' },
    { branch: 'merged', path: merged },
    { branch: 'closed', path: closed },
    { branch: 'open', path: open },
    { branch: 'fresh', path: fresh },
    { branch: undefined, path: loose },
  ];
  const prs = [
    { headRefName: 'merged', number: 10, state: 'MERGED' },
    { headRefName: 'closed', number: 11, state: 'CLOSED' },
    // An older closed PR of a branch whose newest PR is open.
    { headRefName: 'open', number: 5, state: 'CLOSED' },
    { headRefName: 'open', number: 12, state: 'OPEN' },
    { headRefName: 'main', number: 1, state: 'MERGED' },
  ];
  const stack = (path: string, exists = true) => ({
    dir: path,
    exists,
    name: composeProject(path),
  });

  it('stops the stack of a worktree whose newest PR merged or closed, keeping its volumes', () => {
    expect(sweepPlan([stack(merged), stack(closed)], worktrees, prs)).toEqual([
      {
        project: composeProject(merged),
        reason: 'PR #10 merged',
        volumes: false,
      },
      {
        project: composeProject(closed),
        reason: 'PR #11 closed',
        volumes: false,
      },
    ]);
  });

  it('stops the stack of a worktree that is gone, with its volumes', () => {
    const gone = '/r/.claude/worktrees/gone';
    expect(sweepPlan([stack(gone, false)], worktrees, prs)).toEqual([
      { project: composeProject(gone), reason: 'worktree gone', volumes: true },
    ]);
  });

  it('leaves an open PR, no PR, a detached HEAD and the main checkout running', () => {
    expect(
      sweepPlan(
        [stack(open), stack(fresh), stack(loose), stack('/r')],
        worktrees,
        prs,
      ),
    ).toEqual([]);
  });

  it('never touches a project that is not a test stack, or a stack of another clone', () => {
    expect(
      sweepPlan(
        [
          { dir: merged, exists: true, name: 'motor-fix' },
          { dir: '/gone', exists: false, name: 'motor-fix' },
          stack('/elsewhere/motor-fix'),
        ],
        worktrees,
        prs,
      ),
    ).toEqual([]);
  });

  it('matches a stack to its worktree by the full name, not the folder name', () => {
    const twin = '/other/.claude/worktrees/merged';
    expect(sweepPlan([stack(twin)], worktrees, prs)).toEqual([]);
  });

  it('judges no PR when the PR list could not be read, so only gone worktrees go', () => {
    const gone = '/r/.claude/worktrees/gone';
    expect(
      sweepPlan([stack(merged), stack(gone, false)], worktrees, null),
    ).toEqual([
      { project: composeProject(gone), reason: 'worktree gone', volumes: true },
    ]);
  });
});

describe('down and sweep, against fake docker, git and gh', () => {
  const cwd = join(__dirname, '..');
  let bin: string;
  let log: string;

  // A fake binary: appends its arguments to the log, then runs the body.
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
    bin = mkdtempSync(join(tmpdir(), 'test-stacks-'));
    log = join(bin, 'calls.log');
    writeFileSync(log, '');
  });
  afterEach(() => rmSync(bin, { force: true, recursive: true }));

  it('down stops the named worktree stack, keeping its volumes', () => {
    fake('docker', 'exit 0');
    const result = run('down', '/r/.claude/worktrees/x');
    const project = composeProject('/r/.claude/worktrees/x');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ project, stopped: true });
    expect(calls()).toContain(`docker compose -p ${project} down`);
  });

  it('down names the stack of a relative worktree by its absolute path', () => {
    fake('docker', 'exit 0');
    const result = run('down', '.');
    expect(JSON.parse(result.stdout).project).toBe(composeProject(cwd));
  });

  it('down still stops the stack when the timeout setting is not a number', () => {
    fake('docker', 'exit 0');
    const result = spawnSync(
      'node',
      ['scripts/test-services.ts', 'down', '/r/x'],
      {
        cwd,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          TEST_SERVICES_DOCKER_TIMEOUT_MS: 'soon',
        },
      },
    );
    expect(JSON.parse(result.stdout)).toEqual({
      project: composeProject('/r/x'),
      stopped: true,
    });
  });

  it('down with no worktree stops the current checkout stack', () => {
    fake('docker', 'exit 0');
    fake('git', 'echo /r/here');
    const result = run('down');
    expect(JSON.parse(result.stdout)).toEqual({
      project: composeProject('/r/here'),
      stopped: true,
    });
  });

  it('down without Docker says so in one line and exits 0', () => {
    fake('docker', 'exit 1');
    const result = run('down', '/r/x');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      project: composeProject('/r/x'),
      reason: 'docker unavailable',
      stopped: false,
    });
    expect(result.stderr.trim().split('\n')).toHaveLength(1);
    expect(calls().some((c) => c.includes(' down'))).toBe(false);
  });

  it('down that Docker refuses reports the failure and still exits 0', () => {
    fake(
      'docker',
      'case "$1" in info) exit 0;; esac\necho "no pools left" >&2\nexit 1',
    );
    const result = run('down', '/r/x');
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout);
    expect(out.stopped).toBe(false);
    expect(out.reason).toMatch(/no pools left/);
  });

  it('refuses an unknown subcommand or an extra argument with the usage', () => {
    fake('docker', 'exit 0');
    expect(run('down', '/a', '/b').status).toBe(2);
    expect(run('sweep', 'now').status).toBe(2);
  });

  describe('sweep', () => {
    let root: string;
    let merged: string;
    let open: string;
    let gone: string;

    beforeEach(() => {
      root = join(bin, 'repo');
      merged = join(root, 'merged');
      open = join(root, 'open');
      gone = join(root, 'gone');
      mkdirSync(merged, { recursive: true });
      mkdirSync(open, { recursive: true });
      const ls = JSON.stringify(
        [merged, open, gone].map((dir) => ({
          ConfigFiles: `${dir}/docker-compose.yml`,
          Name: composeProject(dir),
          Status: 'running(2)',
        })),
      );
      writeFileSync(join(bin, 'ls.json'), ls);
      fake(
        'git',
        `printf 'worktree ${merged}\\nbranch refs/heads/merged\\n\\nworktree ${open}\\nbranch refs/heads/open\\n'`,
      );
      fake(
        'gh',
        `echo '[{"headRefName":"merged","number":7,"state":"MERGED"},{"headRefName":"open","number":8,"state":"OPEN"}]'`,
      );
    });

    const docker = (down = 'exit 0') =>
      fake(
        'docker',
        [
          'case "$1 $2" in',
          '  "info "*) exit 0;;',
          `  "compose ls") cat "${join(bin, 'ls.json')}"; exit 0;;`,
          'esac',
          down,
        ].join('\n'),
      );

    it('stops the merged and the gone worktree stacks and leaves the open one', () => {
      docker();
      const result = run('sweep');
      expect(result.status).toBe(0);
      expect(calls()).toContain(
        `docker compose -p ${composeProject(merged)} down`,
      );
      expect(calls()).toContain(
        `docker compose -p ${composeProject(gone)} down -v`,
      );
      expect(calls().join('\n')).not.toContain(composeProject(open));
      expect(result.stdout.trim()).toBe(
        `test-services: stopped ${composeProject(merged)} (PR #7 merged), ${composeProject(gone)} (worktree gone)`,
      );
    });

    it('goes on to the next stack when one down fails', () => {
      docker(
        `case "$*" in *${composeProject(merged)}*) echo boom >&2; exit 1;; esac\nexit 0`,
      );
      const result = run('sweep');
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe(
        `test-services: stopped ${composeProject(gone)} (worktree gone); not stopped ${composeProject(merged)} (boom)`,
      );
      expect(result.stderr).toMatch(/boom/);
    });

    it('still stops the gone worktree stacks when gh fails', () => {
      docker();
      fake('gh', 'exit 1');
      const result = run('sweep');
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe(
        `test-services: stopped ${composeProject(gone)} (worktree gone)`,
      );
    });

    it('says so when gh prints JSON that is not a PR list', () => {
      docker();
      fake('gh', `echo '{"message":"Bad credentials"}'`);
      const result = run('sweep');
      expect(result.status).toBe(0);
      expect(result.stderr).toMatch(/no PR list/);
      expect(result.stdout.trim()).toBe(
        `test-services: stopped ${composeProject(gone)} (worktree gone)`,
      );
    });

    it('says there is nothing to stop when no stack qualifies', () => {
      docker();
      writeFileSync(join(bin, 'ls.json'), '[]');
      expect(run('sweep').stdout.trim()).toBe('test-services: nothing to stop');
    });

    it('without Docker stops nothing, says so and exits 0', () => {
      fake('docker', 'exit 1');
      const result = run('sweep');
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe(
        'test-services: docker unavailable, nothing swept',
      );
      expect(result.stderr).toMatch(/docker/i);
      expect(calls().some((c) => c.includes(' down'))).toBe(false);
    });
  });
});
