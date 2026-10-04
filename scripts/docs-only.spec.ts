import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isDocsOnly, isDocumentation } from './docs-only.ts';

describe('isDocumentation', () => {
  it.each([
    'README.md',
    'AGENTS.md',
    'apps/api/README.md',
    'libs/domain/NOTES.MD',
    'docs/architecture.png',
    'docs/guide/setup.txt',
  ])('%s is documentation', (path) => {
    expect(isDocumentation(path)).toBe(true);
  });

  it.each([
    'apps/api/src/main.ts',
    'package.json',
    '.claude/skills/speckit-auto/SKILL.md',
    '.specify/memory/constitution.md',
    '.github/pull_request_template.md',
    'apps/docs/index.ts',
    'README.md.ts',
    'mdx/page.tsx',
  ])('%s is not documentation', (path) => {
    expect(isDocumentation(path)).toBe(false);
  });
});

describe('isDocsOnly', () => {
  it('accepts a change of Markdown and docs/ files only', () => {
    expect(isDocsOnly(['README.md', 'docs/a.png', 'apps/web/NOTES.md'])).toBe(
      true,
    );
  });

  it('rejects a change that also touches code', () => {
    expect(isDocsOnly(['README.md', 'apps/api/src/main.ts'])).toBe(false);
  });

  it('rejects a change to harness Markdown', () => {
    expect(isDocsOnly(['README.md', '.claude/agents/x.md'])).toBe(false);
  });

  it('rejects an empty change', () => {
    expect(isDocsOnly([])).toBe(false);
  });

  it('ignores blank lines in the list', () => {
    expect(isDocsOnly(['README.md', '', '  '])).toBe(true);
    expect(isDocsOnly(['', ' '])).toBe(false);
  });
});

describe('the CLI', () => {
  const script = join(__dirname, 'docs-only.ts');
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
    const stdout = execFileSync('node', [script, 'base'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...env, GITHUB_OUTPUT: output },
    });
    return { output: readFileSync(output, 'utf8'), stdout };
  };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'docs-only-'));
    output = join(repo, '..', `${repo.split('/').pop()}.out`);
    git('init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'README.md'), 'readme\n');
    writeFileSync(join(repo, 'main.ts'), 'export const a = 1;\n');
    commitAll('base');
    git('branch', 'base');
  });

  afterEach(() => {
    rmSync(repo, { force: true, recursive: true });
    rmSync(output, { force: true });
  });

  it('writes docs-only=true when only documentation changed', () => {
    writeFileSync(join(repo, 'README.md'), 'readme, edited\n');
    commitAll('docs');

    const result = run();

    expect(result.output).toBe('docs-only=true\n');
    expect(result.stdout).toContain('README.md');
  });

  it('writes docs-only=false when code changed', () => {
    writeFileSync(join(repo, 'README.md'), 'readme, edited\n');
    writeFileSync(join(repo, 'main.ts'), 'export const a = 2;\n');
    commitAll('mixed');

    expect(run().output).toBe('docs-only=false\n');
  });

  it('counts both sides of a rename from code to Markdown', () => {
    git('mv', 'main.ts', 'main.md');
    commitAll('rename');

    expect(run().output).toBe('docs-only=false\n');
  });

  it('compares against the merge base, not the tip of the base branch', () => {
    git('switch', '-q', 'base');
    writeFileSync(join(repo, 'main.ts'), 'export const a = 3;\n');
    commitAll('base moved on');
    git('switch', '-q', 'main');
    writeFileSync(join(repo, 'README.md'), 'readme, edited\n');
    commitAll('docs');

    expect(run().output).toBe('docs-only=true\n');
  });

  it('fails without a base ref', () => {
    expect(() =>
      execFileSync('node', [script], { cwd: repo, stdio: 'pipe' }),
    ).toThrow();
  });
});
