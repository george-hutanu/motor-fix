import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { block, check, read, script } from './workflow-text.ts';

describe('PR title check against hostile titles', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pr-title-'));
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it('does not run a command substitution inside a title it accepts', () => {
    const marker = join(dir, 'ran-accepted');
    const { code } = check(`feat: $(touch ${marker})`, dir);
    expect(code).toBe(0);
    expect(existsSync(marker)).toBe(false);
  });

  it('does not run a command substitution inside a title it refuses', () => {
    const marker = join(dir, 'ran-refused');
    const { code, out } = check(`$(touch ${marker}) bad`, dir);
    expect(code).toBe(1);
    expect(existsSync(marker)).toBe(false);
    expect(out).toContain(`$(touch ${marker}) bad`);
  });

  it('does not run backticks inside a refused title', () => {
    const marker = join(dir, 'ran-backtick');
    const { code } = check(`\`touch ${marker}\``, dir);
    expect(code).toBe(1);
    expect(existsSync(marker)).toBe(false);
  });

  it('does not run a command after a closing quote in a refused title', () => {
    const marker = join(dir, 'ran-quote');
    const { code } = check(`"; touch ${marker}; echo "`, dir);
    expect(code).toBe(1);
    expect(existsSync(marker)).toBe(false);
  });

  it('does not expand variables or globs in a refused title', () => {
    writeFileSync(join(dir, 'sentinel-file'), '');
    const { code, out } = check('* $HOME \x24{PATH}', dir);
    expect(code).toBe(1);
    expect(out).toContain('"* $HOME \x24{PATH}"');
  });

  it('accepts a title with quotes, backslashes and shell metacharacters in the subject', () => {
    expect(check(`feat(api): it's "quoted" \\ & | ; > < \`x\``).code).toBe(0);
  });

  it('refuses an empty title', () => {
    const { code, out } = check('');
    expect(code).toBe(1);
    expect(out).toContain('PR title is not a Conventional Commit');
  });

  it('refuses a title of only whitespace', () => {
    expect(check('   ').code).toBe(1);
    expect(check('\t\n').code).toBe(1);
  });

  it('refuses a title with leading whitespace before the type', () => {
    expect(check(' feat: subject').code).toBe(1);
    expect(check('\nfeat: subject').code).toBe(1);
  });

  it('refuses a title whose first line is wrong even if a later line is a valid title', () => {
    expect(check('Add things\nfeat: subject').code).toBe(1);
  });

  it('refuses a conventional type with nothing after the colon and space', () => {
    expect(check('feat: ').code).toBe(1);
    expect(check('feat:').code).toBe(1);
  });

  it('refuses a title whose subject starts with a space after a valid prefix', () => {
    expect(check('fix(api):  subject').code).toBe(1);
  });

  it('refuses a title with a full-width colon or a non-breaking space separator', () => {
    expect(check('feat： subject').code).toBe(1);
    expect(check('feat: subject').code).toBe(1);
  });

  it('refuses a title with an upper-case type or an empty scope', () => {
    expect(check('Feat: subject').code).toBe(1);
    expect(check('FEAT: subject').code).toBe(1);
    expect(check('feat(): subject').code).toBe(1);
  });

  it('refuses a scope with a space, an upper-case letter or a unicode letter', () => {
    expect(check('feat(my scope): subject').code).toBe(1);
    expect(check('feat(Api): subject').code).toBe(1);
    expect(check('feat(café): subject').code).toBe(1);
  });

  it('refuses nested scopes and a doubled breaking marker', () => {
    expect(check('feat(a)(b): subject').code).toBe(1);
    expect(check('feat!!: subject').code).toBe(1);
    expect(check('feat!(api): subject').code).toBe(1);
  });

  it('refuses a type that only starts like a valid one', () => {
    expect(check('features: subject').code).toBe(1);
    expect(check('fixup: subject').code).toBe(1);
    expect(check('chore-x: subject').code).toBe(1);
  });

  it('accepts unicode in the subject', () => {
    expect(check('fix(web): corectează diacriticele șțâîă').code).toBe(0);
    expect(check('feat: 🚗 add the garage map').code).toBe(0);
  });

  it('accepts a very long valid title and refuses a very long invalid one', () => {
    expect(check(`feat: ${'a'.repeat(50_000)}`).code).toBe(0);
    expect(check(`${'a'.repeat(50_000)}: subject`).code).toBe(1);
  });

  it('does not let a newline in a refused title start a second workflow command', () => {
    const { code, out } = check('bad\n::set-output name=x::y');
    expect(code).toBe(1);
    const commands = out.split('\n').filter((l) => l.startsWith('::'));
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatch(/^::error::/);
  });

  it('prints one error line for a refused title that holds a carriage return', () => {
    const { out } = check('bad\r::warning::injected');
    expect(out.split('\n').filter((l) => l.startsWith('::'))).toHaveLength(1);
  });

  it('gives the same verdict twice for the same title', () => {
    const first = check('chore(ci): same title');
    const second = check('chore(ci): same title');
    expect(second).toEqual(first);
  });

  it('refuses when the title variable is not set at all', () => {
    const run = spawnSync('bash', ['-c', script()], {
      encoding: 'utf8',
      env: { PATH: process.env['PATH'] },
    });
    expect(run.status).toBe(1);
  });

  it('reads the title from the environment and never interpolates it into the script', () => {
    expect(script()).not.toContain('github.event');
    expect(script()).not.toMatch(/\$\{\{/);
    expect(read('pr-title.yml')).toMatch(
      /^ +TITLE: \$\{\{ github\.event\.pull_request\.title \}\}$/m,
    );
  });
});

describe('PR title workflow triggers and permissions', () => {
  const workflow = read('pr-title.yml');

  it('does not use pull_request_target', () => {
    expect(workflow).not.toMatch(/pull_request_target/);
  });

  it('runs on exactly one event type family and no other trigger', () => {
    expect(
      block(workflow, 'on', 0)
        .split('\n')
        .filter((l) => /^ {2}\S/.test(l)),
    ).toEqual(['  pull_request:']);
  });

  it('grants the token no permissions', () => {
    expect(block(workflow, 'permissions', 0).trim()).toBe('permissions: {}');
  });

  it('does not run on a body-only trigger beyond the four listed types', () => {
    const types = block(workflow, 'pull_request', 2).match(
      /types: \[(.*)\]/,
    )?.[1];
    expect(types?.split(',').length).toBe(4);
  });

  it('keys the concurrency group on the PR number and not on the run or a shared constant', () => {
    const group = block(workflow, 'concurrency', 0).match(/group: (.*)/)?.[1];
    expect(group).toBe('pr-title-\x24{{ github.event.pull_request.number }}');
    expect(group).not.toMatch(/run_id|github\.ref|github\.sha/);
  });

  it('uses a concurrency group that differs from the CI workflow group', () => {
    const ci = block(read('ci.yml'), 'concurrency', 0).match(
      /group: (.*)/,
    )?.[1];
    const title = block(workflow, 'concurrency', 0).match(/group: (.*)/)?.[1];
    expect(title?.startsWith('pr-title-')).toBe(true);
    expect(ci?.startsWith('ci-')).toBe(true);
    expect(title).not.toBe(ci);
  });

  it('has a single job named PR title with a timeout', () => {
    const jobs = block(workflow, 'jobs', 0)
      .split('\n')
      .filter((l) => /^ {2}\S/.test(l));
    expect(jobs).toEqual(['  title:']);
    expect(workflow).toMatch(/^ {4}timeout-minutes: \d+$/m);
  });

  it('does not skip the title check for a documentation-only or bot PR', () => {
    expect(workflow).not.toMatch(/^\s+if:/m);
    expect(workflow).not.toMatch(/paths(-ignore)?:/);
    expect(workflow).not.toMatch(/dependabot/i);
  });
});

describe('CI workflow after the title check moved out', () => {
  const ci = read('ci.yml');

  it('lists no edited type on its pull_request trigger', () => {
    expect(ci).not.toMatch(/types:.*edited/);
    expect(block(ci, 'on', 0)).not.toMatch(/edited/);
  });

  it('keeps workflow_call and pull_request as its only triggers', () => {
    expect(
      block(ci, 'on', 0)
        .split('\n')
        .filter((l) => /^ {2}\S/.test(l)),
    ).toEqual(['  pull_request:', '  workflow_call:']);
  });

  it('still cancels a running PR run on a new push but never on a called run', () => {
    expect(block(ci, 'concurrency', 0)).toMatch(
      /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/,
    );
  });

  it('mentions the title job nowhere in a needs list', () => {
    expect(ci).not.toMatch(/needs:.*pr-title/s);
    expect(ci).not.toMatch(/pr-title\b.*\]/);
    expect(ci).not.toMatch(/needs\.pr-title/);
  });

  it('keeps CI OK waiting for every remaining job and running always', () => {
    const okBlock = block(ci, 'ci-ok', 2);
    expect(okBlock).toMatch(/if: always\(\)/);
    for (const job of ['changes', 'checks', 'tests', 'e2e', 'docker']) {
      expect(okBlock).toMatch(new RegExp(`\\b${job}\\b`));
    }
  });

  it('declares only job ids that exist in the needs list of CI OK', () => {
    const jobs = block(ci, 'jobs', 0)
      .split('\n')
      .map((l) => l.match(/^ {2}([a-z][a-z0-9-]*):$/)?.[1])
      .filter((j): j is string => Boolean(j) && j !== 'ci-ok');
    const needs =
      block(ci, 'ci-ok', 2).match(/needs:\s*\[([^\]]*)\]/s)?.[1] ?? '';
    const listed = needs
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);
    expect(listed.sort()).toEqual(jobs.sort());
  });

  it('holds no job that checks the title pattern', () => {
    expect(ci).not.toMatch(/Conventional Commit:/);
    expect(ci).not.toMatch(/github\.event\.pull_request\.title/);
  });
});

describe('release workflow calling CI', () => {
  const release = read('release.yml');

  it('calls ci.yml as a reusable workflow', () => {
    expect(block(release, 'checks', 2)).toMatch(
      /uses: \.\/\.github\/workflows\/ci\.yml$/m,
    );
  });

  it('does not need or reference a title job', () => {
    expect(release).not.toMatch(/pr-title/);
    expect(release).not.toMatch(/github\.event\.pull_request/);
  });

  it('does not call the title workflow and does not trigger on pull requests', () => {
    expect(release).not.toMatch(/pr-title\.yml/);
    expect(block(release, 'on', 0)).not.toMatch(/pull_request/);
  });

  it('keeps the image job gated on the checks job', () => {
    expect(block(release, 'images', 2)).toMatch(/needs: checks/);
  });
});

describe('AGENTS.md', () => {
  const agents = readFileSync(join(__dirname, '..', 'AGENTS.md'), 'utf8');

  it('names the title workflow and no longer lists the title as a CI job', () => {
    expect(agents).toContain('.github/workflows/pr-title.yml');
    expect(agents).not.toMatch(
      /^- PR CI: .*\n\s+PR title \(Conventional Commit\), Biome/m,
    );
    expect(agents).not.toMatch(/runs only the PR title, Changes and `CI OK`/);
  });
});
