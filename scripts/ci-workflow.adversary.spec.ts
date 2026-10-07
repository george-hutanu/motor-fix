import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const ci = read('.github/workflows/ci.yml');
const release = read('.github/workflows/release.yml');

function jobBlock(text: string, id: string): string {
  const lines = text.split('\n');
  const jobsAt = lines.indexOf('jobs:');
  const start = lines.indexOf(`  ${id}:`, jobsAt);
  if (start < 0) throw new Error(`no job ${id}`);
  const end = lines.findIndex((l, i) => i > start && /^ {2}\S/.test(l));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

const allRuns = (block: string) =>
  [...block.matchAll(/^ +(?:- )?run: ([^|>].*)$/gm)]
    .map((m) => m[1])
    .join('\n') +
  [...block.matchAll(/run: [|>]\n((?: {10,}.*\n?)+)/g)]
    .map((m) => m[1])
    .join('\n');

function playwrightConfig(env: Record<string, string>) {
  const script = `
    const m = await import(${JSON.stringify(
      join(root, 'apps/web-e2e/playwright.config.mts'),
    )});
    const c = m.default;
    console.log(JSON.stringify({
      workers: c.workers ?? null,
      retries: c.retries ?? null,
      failOnFlakyTests: c.failOnFlakyTests ?? false,
      webServers: Array.isArray(c.webServer) ? c.webServer.length : 0,
    }));`;
  const base: Record<string, string> = { PATH: process.env.PATH ?? '' };
  return JSON.parse(
    execFileSync(
      'node',
      ['--experimental-strip-types', '--input-type=module', '-e', script],
      { cwd: root, encoding: 'utf8', env: { ...base, ...env } },
    )
      .trim()
      .split('\n')
      .pop() as string,
  );
}

describe('CI workflow still performs every check', () => {
  const pr = ci;

  it.each([
    ['Biome', /biome ci/],
    ['Typecheck', /-t typecheck/],
    ['Build', /-t build/],
    ['Contract check', /scripts\/contract-check\.sh/],
    ['Harness lint', /npm run lint:harness/],
    ['Harness test', /npm run test:harness/],
    ['Audit', /npm audit --omit=dev --audit-level=high/],
    ['Dependency resolve', /npm install --dry-run/],
    ['Compose stack', /docker compose up -d --wait postgres redis minio/],
    ['Unit tests', /JEST_SUITE: unit/],
    ['Integration tests', /JEST_SUITE: integration/],
    ['E2E', /-t e2e/],
  ])('runs %s', (_name, pattern) => {
    expect(pr).toMatch(pattern);
  });

  it('builds the web and api images on a pull request', () => {
    const docker = jobBlock(ci, 'docker');
    expect(docker).toMatch(/- app: web\n\s+target: web/);
    expect(docker).toMatch(/- app: api\n\s+target: node-app/);
    expect(docker).toContain("github.event_name == 'pull_request'");
    expect(docker).toMatch(/push: false/);
  });

  it('does not let a failed step in the shared checks job skip the later ones', () => {
    const checks = jobBlock(ci, 'checks');
    const names = [...checks.matchAll(/- name: (.+)\n((?: {8}.+\n)*)/g)];
    const guarded = names.filter(([, name]) =>
      [
        'Biome',
        'Dependency audit',
        'Typecheck',
        'Build',
        'Contract check',
        'Harness',
        'Compose stack',
      ].includes(name),
    );
    expect(guarded.map(([, n]) => n)).toHaveLength(7);
    for (const [, , body] of guarded) {
      expect(body).toMatch(/if: \$\{\{ !cancelled\(\)/);
    }
  });

  it('keeps the dry-run resolve in the same step as the audit, after the install', () => {
    const checks = jobBlock(ci, 'checks');
    expect(checks.indexOf('./.github/actions/setup')).toBeGreaterThan(-1);
    expect(checks.indexOf('npm install --dry-run')).toBeGreaterThan(
      checks.indexOf('./.github/actions/setup'),
    );
    expect(checks).toContain('--ignore-scripts');
  });

  it('runs the unit and integration suites in separate steps with their own JEST_SUITE', () => {
    const tests = jobBlock(ci, 'tests');
    expect(tests.match(/JEST_SUITE: /g)).toHaveLength(2);
    expect(tests).not.toMatch(
      /^ {4}env:[\s\S]*?JEST_SUITE[\s\S]*?^ {4}steps:/m,
    );
    const unit = tests.slice(
      tests.indexOf('- name: Unit tests'),
      tests.indexOf('- name: Migrate'),
    );
    const integration = tests.slice(tests.indexOf('- name: Integration tests'));
    expect(unit).toMatch(/JEST_SUITE: unit/);
    expect(unit).not.toMatch(/integration/);
    expect(integration).toMatch(/JEST_SUITE: integration/);
    expect(integration).not.toMatch(/JEST_SUITE: unit/);
  });

  it('never sets JEST_SUITE at workflow level or in other jobs', () => {
    const head = ci.slice(0, ci.indexOf('\njobs:'));
    expect(head).not.toContain('JEST_SUITE');
    for (const id of ['changes', 'checks', 'e2e', 'docker', 'ci-ok']) {
      expect(jobBlock(ci, id)).not.toContain('JEST_SUITE');
    }
  });

  it('migrates the database before the integration tests', () => {
    const tests = jobBlock(ci, 'tests');
    expect(tests.indexOf('prisma migrate deploy')).toBeGreaterThan(-1);
    expect(tests.indexOf('prisma migrate deploy')).toBeLessThan(
      tests.indexOf('JEST_SUITE: integration'),
    );
  });

  it.each(['tests', 'e2e'])(
    'gives %s the database, redis and their urls',
    (id) => {
      const block = jobBlock(ci, id);
      expect(block).toMatch(/services: (&services|\*services)/);
      expect(block).toContain(
        'DATABASE_URL: postgresql://postgres:postgres@localhost:5432/postgres',
      );
      expect(block).toContain('REDIS_URL: redis://localhost:6379');
      expect(block).toContain('AUTH_TOKEN_SECRET:');
    },
  );

  it('declares postgres and redis once with health checks and published ports', () => {
    const tests = jobBlock(ci, 'tests');
    const services = tests.slice(
      tests.indexOf('services:'),
      tests.indexOf('\n    env:'),
    );
    expect(services).toMatch(/image: postgis\/postgis:17-3\.5/);
    expect(services).toMatch(/image: redis:7/);
    expect(services).toContain("'5432:5432'");
    expect(services).toContain("'6379:6379'");
    expect(services.match(/--health-cmd/g)).toHaveLength(2);
  });

  it('keeps the e2e environment the suite needs', () => {
    const e2e = jobBlock(ci, 'e2e');
    for (const key of [
      'APP_ENV: test',
      'PUBLIC_WEB_URL: http://localhost:4200',
      'EMAIL_SENDING:',
      'BREVO_API_URL: http://127.0.0.1:3025/v3',
      'GOOGLE_ISSUER: http://127.0.0.1:3026',
      'STORAGE_BUCKET: motorfix',
    ]) {
      expect(e2e).toContain(key);
    }
    expect(e2e.indexOf('domain:seed')).toBeGreaterThan(
      e2e.indexOf('prisma migrate deploy'),
    );
    expect(e2e).toMatch(/if: failure\(\)\n\s+uses: actions\/upload-artifact/);
  });
});

describe('docs-only pull requests', () => {
  it.each(['checks', 'tests', 'e2e', 'docker'])(
    'skips %s when only documentation changed',
    (id) => {
      const block = jobBlock(ci, id);
      expect(block).toContain("needs.changes.outputs.docs-only != 'true'");
      expect(block).toMatch(/needs: changes\n/);
    },
  );

  it('declares exactly the jobs changes, checks, tests, e2e, docker and ci-ok', () => {
    const lines = ci.split('\n');
    const at = lines.indexOf('jobs:');
    const ids = lines
      .slice(at + 1)
      .filter((l) => /^ {2}[\w-]+:$/.test(l))
      .map((l) => l.trim().slice(0, -1));
    expect(ids).toEqual([
      'changes',
      'checks',
      'tests',
      'e2e',
      'docker',
      'ci-ok',
    ]);
  });

  it('keeps the job names Changes and CI OK', () => {
    expect(jobBlock(ci, 'changes')).toContain('name: Changes');
    expect(jobBlock(ci, 'ci-ok')).toContain('name: CI OK');
  });

  it('gives the classifier no dependency so it always runs', () => {
    expect(jobBlock(ci, 'changes')).not.toMatch(/^ {4}needs:/m);
    expect(jobBlock(ci, 'changes')).not.toMatch(/^ {4}if:/m);
  });
});

describe('CI OK gate', () => {
  const ok = jobBlock(ci, 'ci-ok');

  it('runs even when a needed job failed or was cancelled', () => {
    expect(ok).toMatch(/^ {4}if: always\(\)$/m);
  });

  it('needs every other job', () => {
    const needs = ok
      .match(/needs: \[(.+)\]/)?.[1]
      .split(',')
      .map((s) => s.trim());
    expect(needs?.sort()).toEqual([
      'changes',
      'checks',
      'docker',
      'e2e',
      'tests',
    ]);
  });

  it('accepts only success or skipped', () => {
    expect(ok).toContain('success|skipped) ;;');
    expect(ok).toMatch(/\*\) exit 1/);
    expect(ok).not.toMatch(/cancelled\)|failure\)/);
  });

  function verdict(results: string[]): number {
    const script = ok.slice(ok.indexOf('echo "Results'), ok.length);
    try {
      execFileSync('sh', ['-c', script], {
        env: { PATH: process.env.PATH ?? '', RESULTS: results.join(' ') },
        stdio: 'pipe',
      });
      return 0;
    } catch (e) {
      return (e as { status: number }).status;
    }
  }

  it.each([
    [['success', 'success', 'success', 'success', 'success']],
    [['success', 'skipped', 'skipped', 'skipped', 'skipped']],
  ])('passes for %j', (results) => {
    expect(verdict(results)).toBe(0);
  });

  it.each([
    [['success', 'failure', 'success', 'success', 'success']],
    [['success', 'success', 'cancelled', 'success', 'success']],
    [['success', 'success', 'success', 'success', 'cancelled']],
    [['failure', 'skipped', 'skipped', 'skipped', 'skipped']],
    [['success', 'skipped', 'skipped', 'skipped', 'timed_out']],
  ])('fails for %j', (results) => {
    expect(verdict(results)).toBe(1);
  });
});

describe('workflow shape', () => {
  it('cancels a superseded pull request run but never one on main', () => {
    expect(ci).toMatch(
      /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/,
    );
    expect(ci).toMatch(
      /group: ci-\$\{\{ github\.event\.pull_request\.number \|\| github\.run_id \}\}/,
    );
  });

  it('runs every project on a release and the affected ones on a pull request', () => {
    expect(ci).toContain("'affected --base=origin/{0}'");
    expect(ci).toContain("|| 'run-many'");
  });

  it('keeps the compose stack and the docker builds off main', () => {
    expect(jobBlock(ci, 'docker')).toContain(
      "github.event_name == 'pull_request'",
    );
    expect(jobBlock(ci, 'checks')).toMatch(
      /Compose stack\n\s+if: \$\{\{ !cancelled\(\) && github\.event_name == 'pull_request' \}\}/,
    );
  });

  it('tears the compose stack down even when a check failed', () => {
    expect(jobBlock(ci, 'checks')).toMatch(
      /if: \$\{\{ always\(\) && github\.event_name == 'pull_request' \}\}\n\s+run: docker compose (?:--profile observability )?down/,
    );
  });

  it('keeps contents read-only permissions', () => {
    expect(ci).toMatch(/^permissions:\n {2}contents: read$/m);
  });

  it('has no runs block that mentions a skipped check as a comment-only no-op', () => {
    expect(allRuns(jobBlock(ci, 'checks'))).not.toMatch(/\|\| true/);
    expect(ci).not.toMatch(/continue-on-error/);
  });
});

describe('release workflow', () => {
  const images = jobBlock(release, 'images');

  it('pushes all four images', () => {
    expect(images.match(/push: true/g)).toHaveLength(4);
    expect(images).not.toMatch(/push: false/);
    for (const app of ['web', 'api', 'worker', 'mcp']) {
      expect(images).toContain(`-${app}:\${{ github.sha }}`);
    }
  });

  it('logs in to the registry before building', () => {
    expect(images.indexOf('docker/login-action')).toBeGreaterThan(-1);
    expect(images.indexOf('docker/login-action')).toBeLessThan(
      images.indexOf('build-push-action'),
    );
    expect(release).toMatch(/packages: write/);
  });

  function build(id: string) {
    const at = images.indexOf(`- id: ${id}\n`);
    const next = images.indexOf('\n      - id:', at + 1);
    return images.slice(at, next < 0 ? undefined : next);
  }

  it.each([
    ['web', 'web'],
    ['api', 'api'],
  ])('writes the %s cache to the scope pull requests read', (id, scope) => {
    const b = build(id);
    expect(b).toContain(`cache-from: type=gha,scope=${scope}`);
    expect(b).toContain(`cache-to: type=gha,mode=max,scope=${scope}`);
  });

  it.each(['worker', 'mcp'])('reads but never writes a cache for %s', (id) => {
    const b = build(id);
    expect(b).toContain('cache-from: type=gha,scope=api');
    expect(b).not.toContain('cache-to');
  });

  it('uses the same cache scopes as the pull request docker builds', () => {
    const docker = jobBlock(ci, 'docker');
    expect(docker).toContain(`scope=$${'{{'} matrix.app }}`);
    expect(images).toContain('scope=web');
    expect(images).toContain('scope=api');
  });

  it('builds the same targets for web and api as the pull request does', () => {
    expect(build('web')).toContain('target: web');
    expect(build('api')).toContain('target: node-app');
    expect(build('worker')).toContain('target: node-app');
    expect(build('mcp')).toContain('target: node-app');
  });

  it('serialises staging and production without cancelling a running deploy', () => {
    const staging = jobBlock(release, 'staging');
    const production = jobBlock(release, 'production');
    expect(staging).toMatch(
      /group: release-staging\n\s+cancel-in-progress: false/,
    );
    expect(production).toMatch(
      /group: release-production\n\s+cancel-in-progress: false/,
    );
  });

  it('collapses only the checks job and never cancels a running one', () => {
    const checks = jobBlock(release, 'checks');
    expect(checks).toMatch(
      /group: release-checks\n\s+cancel-in-progress: false/,
    );
    expect(checks).toContain('uses: ./.github/workflows/ci.yml');
    expect(release).not.toMatch(/^concurrency:/m);
  });

  it('chains images after checks, staging after images and production after both', () => {
    expect(images).toMatch(/needs: checks\n/);
    expect(jobBlock(release, 'staging')).toMatch(/needs: images\n/);
    expect(jobBlock(release, 'production')).toMatch(
      /needs: \[images, staging\]/,
    );
  });

  it('deploys production to the staging-proven digests', () => {
    const production = jobBlock(release, 'production');
    expect(production).toContain('needs.images.outputs.web');
    expect(production).toContain('needs.images.outputs.api');
    expect(production).toContain('needs.images.outputs.worker');
    expect(production).toContain('environment: production');
  });

  it('runs the staging end-to-end suite against the deployed address', () => {
    const staging = jobBlock(release, 'staging');
    expect(staging).toContain(`BASE_URL: $${'{{'} vars.PUBLIC_WEB_URL }}`);
    expect(staging).toContain('--skip-nx-cache');
  });

  it('triggers only on pushes to main', () => {
    expect(release).toMatch(/on:\n {2}push:\n {4}branches: \[main\]/);
  });
});

describe('end-to-end configuration', () => {
  const dir = join(root, 'apps/web-e2e');

  it('runs several workers and fails a flaky pass when it starts its own servers', () => {
    const c = playwrightConfig({ CI: 'true' });
    expect(c.workers).toBeGreaterThan(1);
    expect(c.workers).toBeLessThanOrEqual(4);
    expect(c.failOnFlakyTests).toBe(true);
    expect(c.retries).toBe(2);
    expect(c.webServers).toBe(5);
  });

  it('keeps one worker and its retries against a deployed address', () => {
    const c = playwrightConfig({
      BASE_URL: 'https://staging.example.test',
      CI: 'true',
    });
    expect(c.workers).toBe(1);
    expect(c.retries).toBe(2);
    expect(c.failOnFlakyTests).toBe(false);
    expect(c.webServers).toBe(0);
  });

  it('treats an empty BASE_URL as a local run', () => {
    const c = playwrightConfig({ BASE_URL: '', CI: 'true' });
    expect(c.webServers).toBe(5);
    expect(c.failOnFlakyTests).toBe(true);
  });

  it('does not set a worker count in config source beyond the named constant', () => {
    const src = readFileSync(join(dir, 'playwright.config.mts'), 'utf8');
    expect(src.match(/workers:/g)).toHaveLength(1);
    expect(src).not.toMatch(/retries: 0/);
  });
});
