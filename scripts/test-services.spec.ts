import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  composeProject,
  needsServices,
  noDockerMessage,
  parsePort,
  projectName,
  schemaDrift,
  serviceEnv,
  shellExports,
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
      // from the repository root.
      const run = spawnSync('node', ['scripts/test-services.ts', root], {
        cwd: join(__dirname, '..'),
        encoding: 'utf8',
        env: {
          ...process.env,
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
