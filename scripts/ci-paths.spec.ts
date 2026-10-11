import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { classify } from './ci-paths.ts';

const NONE = { compose: false, docker: false, harness: false };

describe('classify', () => {
  it('skips all three for a change to the web app only', () => {
    expect(
      classify([
        'apps/web/src/app/home/home.ts',
        'apps/web/src/app/home/home.html',
      ]),
    ).toEqual(NONE);
  });

  it('skips all three for an api, lib or end-to-end change', () => {
    expect(
      classify([
        'apps/api/src/main.ts',
        'libs/domain/src/index.ts',
        'apps/web-e2e/src/home.spec.ts',
        'README.md',
      ]),
    ).toEqual(NONE);
  });

  it.each([
    'Dockerfile',
    'apps/web/Dockerfile',
    '.dockerignore',
    '.nvmrc',
    'nx.json',
    'tsconfig.base.json',
    'docker/entrypoint.sh',
    'apps/web/project.json',
    'apps/api/tsconfig.app.json',
    'libs/domain/prisma.config.ts',
  ])('builds the images for %s', (path) => {
    expect(classify([path])).toEqual({ ...NONE, docker: true });
  });

  it.each(['package.json', 'package-lock.json'])(
    'builds the images and runs the harness for %s',
    (path) => {
      expect(classify([path])).toEqual({
        ...NONE,
        docker: true,
        harness: true,
      });
    },
  );

  it.each([
    'docker-compose.yml',
    'docker-compose.override.yml',
    'infra/observability/inventory.json',
  ])('boots the compose stack for %s', (path) => {
    expect(classify([path]).compose).toBe(true);
  });

  it.each(['infra/keycloak/Dockerfile', 'infra/keycloak/realm.json'])(
    'boots the stack and builds the images for %s',
    (path) => {
      expect(classify([path])).toEqual({
        ...NONE,
        compose: true,
        docker: true,
      });
    },
  );

  it.each([
    '.claude/hooks/merge-gate.mjs',
    '.specify/memory/constitution.md',
    '.husky/pre-commit',
    '.github/workflows/pr-qa.yml',
    'scripts/docs-only.ts',
  ])('runs the harness for %s', (path) => {
    expect(classify([path])).toEqual({ ...NONE, harness: true });
  });

  it('runs all three when ci.yml itself changes', () => {
    expect(classify(['.github/workflows/ci.yml'])).toEqual({
      compose: true,
      docker: true,
      harness: true,
    });
  });

  it('does not read a nested project.json or a Dockerfile-like name as an image input', () => {
    expect(
      classify([
        'apps/web/src/project.json',
        'libs/domain/project.json',
        'docs/Dockerfile.md',
      ]),
    ).toEqual(NONE);
  });

  it('ignores blank lines and an empty change', () => {
    expect(classify(['', '  '])).toEqual(NONE);
    expect(classify([])).toEqual(NONE);
  });
});

describe('the CLI', () => {
  const script = join(__dirname, 'ci-paths.ts');
  let repo: string;
  let output: string;

  // A git hook (the pre-commit run) exports GIT_DIR and GIT_INDEX_FILE; left
  // in place they point every command here at the real repository.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  );
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', env });
  const commitAll = (message: string) => {
    git('add', '-A');
    git(
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '-q',
      '-m',
      message,
    );
  };
  const run = () => {
    writeFileSync(output, '');
    execFileSync('node', [script, 'base'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...env, GITHUB_OUTPUT: output },
    });
    return readFileSync(output, 'utf8');
  };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'ci-paths-'));
    output = join(repo, 'github-output');
    git('init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'Dockerfile'), 'FROM node\n');
    writeFileSync(join(repo, 'main.ts'), 'export const a = 1;\n');
    commitAll('base');
    git('branch', 'base');
  });

  afterEach(() => {
    rmSync(repo, { force: true, recursive: true });
  });

  it('writes every filter false for a source change', () => {
    writeFileSync(join(repo, 'main.ts'), 'export const a = 2;\n');
    commitAll('code');

    expect(run()).toBe('compose=false\ndocker=false\nharness=false\n');
  });

  it('writes docker=true when the Dockerfile changed', () => {
    writeFileSync(join(repo, 'Dockerfile'), 'FROM node:24\n');
    commitAll('image');

    expect(run()).toBe('compose=false\ndocker=true\nharness=false\n');
  });

  it('compares against the merge base, not the tip of the base branch', () => {
    git('switch', '-q', 'base');
    writeFileSync(join(repo, 'Dockerfile'), 'FROM node:22\n');
    commitAll('base moved on');
    git('switch', '-q', 'main');
    writeFileSync(join(repo, 'main.ts'), 'export const a = 3;\n');
    commitAll('code');

    expect(run()).toBe('compose=false\ndocker=false\nharness=false\n');
  });

  it('fails without a base ref', () => {
    expect(() =>
      execFileSync('node', [script], { cwd: repo, stdio: 'pipe' }),
    ).toThrow();
  });
});
