import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The PR workflow's jobs, read as indented text like release-workflow.spec.ts:
// fewer jobs means fewer runners held under the free plan's 20-job cap.
const root = join(__dirname, '..');
const workflow = readFileSync(
  join(root, '.github', 'workflows', 'ci.yml'),
  'utf8',
);
const lines = workflow.split('\n');
const jobsAt = lines.indexOf('jobs:');

const jobIds = lines
  .slice(jobsAt + 1)
  .filter((line) => /^ {2}[\w-]+:$/.test(line))
  .map((line) => line.trim().slice(0, -1));

function job(name: string): string {
  const start = lines.indexOf(`  ${name}:`, jobsAt);
  if (start < 0) throw new Error(`ci.yml has no job ${name}`);
  const end = lines.findIndex((line, i) => i > start && /^ {2}\S/.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

// One step of a job, from its `- name:` line to the next step.
function step(block: string, name: string): string {
  const at = block.indexOf(`- name: ${name}\n`);
  if (at < 0) throw new Error(`no step named ${name}`);
  const next = block.slice(at + 1).search(/\n {6}- /);
  return block.slice(at, next < 0 ? undefined : at + 1 + next);
}

const setting = (block: string, key: string) =>
  block.match(new RegExp(`^ +${key}: *(.+)$`, 'm'))?.[1]?.trim();

const gh = (ref: string) => `\${{ ${ref} }}`;
const DOCS_ONLY = "needs.changes.outputs.docs-only != 'true'";

describe('ci workflow', () => {
  it('runs six jobs, so a PR holds at most seven runners', () => {
    expect(jobIds).toEqual([
      'changes',
      'checks',
      'tests',
      'e2e',
      'docker',
      'ci-ok',
    ]);
    expect(
      [...job('docker').matchAll(/^ +- app: (\S+)$/gm)].map((m) => m[1]),
    ).toEqual(['web', 'api']);
  });

  it('installs the workspace in three jobs only', () => {
    const installing = jobIds.filter((id) =>
      job(id).includes('uses: ./.github/actions/setup'),
    );

    expect(installing).toEqual(['checks', 'tests', 'e2e']);
  });

  it.each([
    ['checks', 'Checks'],
    ['tests', 'Unit and integration tests'],
    ['e2e', 'E2E tests'],
  ])('%s is skipped on a documentation-only PR', (id, name) => {
    const block = job(id);

    expect(setting(block, 'name')).toBe(name);
    expect(setting(block, 'needs')).toBe('changes');
    expect(setting(block, 'if')).toBe(DOCS_ONLY);
  });

  it('builds the docker images on PRs only, skipped when docs-only', () => {
    expect(setting(job('docker'), 'if')).toBe(
      `github.event_name == 'pull_request' && ${DOCS_ONLY}`,
    );
  });

  // A failing step must not hide the others: each runs unless the job was cancelled.
  it.each([
    ['checks', 'Biome', 'npx biome ci'],
    ['checks', 'Typecheck', 'npx nx $NX_SCOPE -t typecheck'],
    ['checks', 'Build', 'npx nx $NX_SCOPE -t build'],
    ['checks', 'Contract check', 'sh scripts/contract-check.sh'],
    ['checks', 'Harness', 'npm run test:harness'],
    ['checks', 'Dependency audit', 'npm audit --omit=dev --audit-level=high'],
    [
      'checks',
      'Compose stack',
      'docker compose up -d --wait postgres redis minio',
    ],
    ['tests', 'Unit tests', 'npx nx $NX_SCOPE -t test --passWithNoTests'],
    [
      'tests',
      'Integration tests',
      'npx nx $NX_SCOPE -t test --passWithNoTests',
    ],
  ])(
    '%s runs the %s step even after an earlier one failed',
    (id, name, command) => {
      const block = step(job(id), name);

      expect(setting(block, 'if')).toMatch(/!cancelled\(\)/);
      expect(block).toContain(command);
    },
  );

  // An unguarded step after a check is skipped once that check fails (the
  // install, say, after Biome), and every check after it then fails for it.
  it('runs every unguarded checks step before the first check', () => {
    const steps = job('checks')
      .split(/\n {6}- /)
      .slice(1);
    const guarded = steps.map((s) =>
      /^\s*if: .*(!cancelled|always)\(\)/m.test(s),
    );
    const firstCheck = guarded.indexOf(true);

    expect(firstCheck).toBeGreaterThan(0);
    expect(guarded.slice(firstCheck).every(Boolean)).toBe(true);
  });

  it('runs Biome from the install, not a separate download', () => {
    expect(job('checks')).not.toContain('setup-biome');
    expect(step(job('checks'), 'Biome')).toContain('npx biome ci');
  });

  it('keeps the compose stack a PR check, not a release one', () => {
    expect(setting(step(job('checks'), 'Compose stack'), 'if')).toBe(
      gh("!cancelled() && github.event_name == 'pull_request'"),
    );
  });

  it.each([
    ['Unit tests', 'unit'],
    ['Integration tests', 'integration'],
  ])('the %s step picks its Jest suite', (name, suite) => {
    expect(setting(step(job('tests'), name), 'JEST_SUITE')).toBe(suite);
  });

  it('migrates the database before the integration tests', () => {
    const block = job('tests');

    expect(block).toContain('postgis/postgis:17-3.5');
    expect(block.indexOf('prisma migrate deploy')).toBeGreaterThan(0);
    expect(block.indexOf('prisma migrate deploy')).toBeLessThan(
      block.indexOf('- name: Integration tests'),
    );
  });

  it('CI OK needs every job and fails on anything but success or skipped', () => {
    const block = job('ci-ok');

    expect(setting(block, 'name')).toBe('CI OK');
    expect(setting(block, 'if')).toBe('always()');
    expect(setting(block, 'needs')).toBe(
      `[${jobIds.filter((id) => id !== 'ci-ok').join(', ')}]`,
    );
    expect(block).toContain('success|skipped) ;; *) exit 1 ;;');
  });
});

// The config is ESM (.mts); a child node loads it the way Playwright does.
function playwright(env: Record<string, string>) {
  const script = `import('./apps/web-e2e/playwright.config.mts').then(({ default: c }) =>
    console.log(JSON.stringify({ workers: c.workers ?? null, failOnFlakyTests: c.failOnFlakyTests ?? null })))`;
  const { BASE_URL, CI, ...rest } = process.env;
  const out = execFileSync(process.execPath, ['-e', script], {
    cwd: root,
    encoding: 'utf8',
    env: { ...rest, ...env },
  });
  return JSON.parse(out.trim().split('\n').at(-1) ?? '{}');
}

describe('playwright config', () => {
  it('runs four workers in CI and fails a test that passed only on retry', () => {
    expect(playwright({ CI: '1' })).toEqual({
      failOnFlakyTests: true,
      workers: 4,
    });
  });

  it('keeps one worker and the retry tolerance against a deployed address', () => {
    expect(
      playwright({ BASE_URL: 'https://staging.example.test', CI: '1' }),
    ).toEqual({
      failOnFlakyTests: null,
      workers: 1,
    });
  });
});
