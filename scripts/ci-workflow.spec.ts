// @traces 875-FR-005 875-FR-006
// @traces 879-FR-015
// @traces 1037-FR-010
// @traces 1170-FR-001 1170-FR-002 1170-FR-003
// @traces 1176-FR-002 1176-FR-004
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
  // Integration and E2E run on demand, so a PR still holds at most seven
  // runners: Changes, Checks, Unit tests, three Docker builds, CI OK.
  it('runs seven jobs, so a PR holds at most seven runners', () => {
    expect(jobIds).toEqual([
      'changes',
      'checks',
      'unit',
      'integration',
      'e2e',
      'docker',
      'ci-ok',
    ]);
    expect(
      [...job('docker').matchAll(/^ +- app: (\S+)$/gm)].map((m) => m[1]),
    ).toEqual(['web', 'api', 'keycloak']);
  });

  it('builds the keycloak image from its own folder, the others from the root', () => {
    const block = job('docker');
    const row = (app: string) => {
      const at = block.indexOf(`- app: ${app}\n`);
      const next = block.indexOf('- app: ', at + 1);
      return block.slice(at, next < 0 ? block.indexOf('steps:') : next);
    };

    expect(setting(row('web'), 'context')).toBe('.');
    expect(setting(row('web'), 'file')).toBe('Dockerfile');
    expect(setting(row('api'), 'context')).toBe('.');
    expect(setting(row('api'), 'file')).toBe('Dockerfile');
    expect(setting(row('keycloak'), 'context')).toBe('infra/keycloak');
    expect(setting(row('keycloak'), 'file')).toBe('infra/keycloak/Dockerfile');
    const build = block.slice(block.indexOf('docker/build-push-action'));
    expect(setting(build, 'context')).toBe(gh('matrix.context'));
    expect(setting(build, 'file')).toBe(gh('matrix.file'));
  });

  it('installs the workspace in four jobs only', () => {
    const installing = jobIds.filter((id) =>
      job(id).includes('uses: ./.github/actions/setup'),
    );

    expect(installing).toEqual(['checks', 'unit', 'integration', 'e2e']);
  });

  it.each([
    ['checks', 'Checks'],
    ['unit', 'Unit tests'],
  ])('%s is skipped on a documentation-only PR', (id, name) => {
    const block = job(id);

    expect(setting(block, 'name')).toBe(name);
    expect(setting(block, 'needs')).toBe('changes');
    expect(setting(block, 'if')).toBe(DOCS_ONLY);
  });

  // The end-to-end suite costs a runner on every PR and, against staging,
  // most of the web service's egress: it runs by hand only.
  it('runs the E2E job on demand only, and uploads its report whatever the result', () => {
    const block = job('e2e');

    expect(setting(block, 'name')).toBe('E2E tests');
    expect(setting(block, 'if')).toBe(
      "github.event_name == 'workflow_dispatch'",
    );
    expect(workflow).toContain(
      '\n        default: false\n  workflow_dispatch:\n',
    );
    expect(block).toMatch(
      /- if: \$\{\{ !cancelled\(\) \}\}\n {8}uses: actions\/upload-artifact@\S+\n {8}with:\n {10}name: playwright-report\n/,
    );
  });

  // The unit suite needs no database: a PR's test job has no service containers.
  it('runs the unit suite on a PR with no PostgreSQL or Redis', () => {
    const block = job('unit');

    expect(block).not.toMatch(/^ {4}services:/m);
    expect(block).not.toContain('DATABASE_URL');
    expect(block).not.toContain('REDIS_URL');
    expect(block).not.toContain('JEST_SUITE: integration');
  });

  // Like E2E, the integration suite runs by hand; a caller (the release) asks
  // for it by input, since a workflow_call carries the caller's event name.
  it('runs the integration job on demand and when the caller asks, never on a PR', () => {
    const block = job('integration');

    expect(setting(block, 'name')).toBe('Integration tests');
    expect(setting(block, 'needs')).toBe('changes');
    expect(setting(block, 'if')).toBe(
      "github.event_name == 'workflow_dispatch' || inputs.integration",
    );
    expect(block).toMatch(/^ {4}services: &services$/m);
    expect(workflow).toContain(
      'on:\n  pull_request:\n  workflow_call:\n    inputs:\n      integration:\n        type: boolean\n        default: false\n',
    );
  });

  it('builds the docker images on a PR that changes an image input, and by hand', () => {
    expect(setting(job('docker'), 'if')).toBe(
      "github.event_name == 'workflow_dispatch' || (github.event_name == 'pull_request' && needs.changes.outputs.docker == 'true')",
    );
  });

  it('classifies the changed paths on a PR and hands every filter on', () => {
    const block = job('changes');

    expect(block).toContain(
      `run: node scripts/ci-paths.ts origin/${gh('github.base_ref')}`,
    );
    for (const [name, id] of [
      ['docs-only', 'classify'],
      ['docker', 'paths'],
      ['compose', 'paths'],
      ['harness', 'paths'],
    ]) {
      expect(setting(block, name)).toBe(gh(`steps.${id}.outputs.${name}`));
    }
  });

  // Off a PR the filter outputs are empty, so != 'false' runs them there.
  const HARNESS = gh(
    "!cancelled() && needs.changes.outputs.harness != 'false'",
  );

  it.each(['harness-playwright', 'harness-browser'])(
    'installs the harness browser only when the harness runs (%s)',
    (id) => {
      const block = job('checks');

      expect(setting(block.slice(block.indexOf(`- id: ${id}\n`)), 'if')).toBe(
        HARNESS,
      );
    },
  );

  it('runs the harness specs only when a harness input changed, or off a PR', () => {
    expect(setting(step(job('checks'), 'Harness'), 'if')).toBe(HARNESS);
    expect(setting(step(job('checks'), 'Browser for the harness'), 'if')).toBe(
      gh(
        "!cancelled() && needs.changes.outputs.harness != 'false' && steps.harness-browser.outputs.cache-hit != 'true'",
      ),
    );
  });

  // A failing step must not hide the others: each runs unless the job was cancelled.
  it.each([
    ['checks', 'Biome', 'npx biome ci'],
    ['checks', 'Typecheck', 'npx nx $NX_SCOPE -t typecheck'],
    ['checks', 'Build', 'npx nx $NX_SCOPE -t build'],
    ['checks', 'Contract check', 'sh scripts/contract-check.sh'],
    [
      'checks',
      'Observability inventory',
      'node scripts/observability-inventory.ts',
    ],
    ['checks', 'Dashboard check', 'node scripts/dashboard-check.ts'],
    ['checks', 'Harness', 'npm run test:harness'],
    ['checks', 'Structure', 'node scripts/structure-check.ts'],
    ['checks', 'Dependency audit', 'npm audit --omit=dev --audit-level=high'],
    [
      'checks',
      'Compose stack',
      'docker compose up -d --wait postgres redis storage',
    ],
    ['unit', 'Unit tests', 'npx nx $NX_SCOPE -t test --passWithNoTests'],
  ])(
    '%s runs the %s step even after an earlier one failed',
    (id, name, command) => {
      const block = step(job(id), name);

      expect(setting(block, 'if')).toMatch(/!cancelled\(\)/);
      expect(block).toContain(command);
    },
  );

  // On a pull request the baseline may not list a file the base branch's
  // baseline lacks; a push to main has no base to compare against.
  it('compares the structure baseline with the base branch on a pull request', () => {
    const block = step(job('checks'), 'Structure');

    expect(block).toContain('--base origin/');
    expect(block).toContain('github.base_ref');
    expect(block).toContain("github.event_name == 'pull_request'");
  });

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

  it('checks banned words on every PR, documentation-only ones included, against the base list', () => {
    const banned = step(job('changes'), 'Banned words');
    expect(setting(banned, 'if')).toBe("github.event_name == 'pull_request'");
    expect(setting(banned, 'run')).toBe(
      `node scripts/banned-words.ts --base origin/${gh('github.base_ref')}`,
    );
  });

  it('runs Biome from the install, not a separate download', () => {
    expect(job('checks')).not.toContain('setup-biome');
    expect(step(job('checks'), 'Biome')).toContain('npx biome ci');
  });

  it('keeps the compose stack a PR check that runs when the stack changed', () => {
    const when =
      "github.event_name == 'pull_request' && needs.changes.outputs.compose == 'true'";

    expect(setting(step(job('checks'), 'Compose stack'), 'if')).toBe(
      gh(`!cancelled() && ${when}`),
    );
    expect(setting(step(job('checks'), 'Stop the compose stack'), 'if')).toBe(
      gh(`always() && ${when}`),
    );
  });

  it('boots the local observability profile and proves Grafana and OTLP answer', () => {
    const block = step(job('checks'), 'Compose stack');

    expect(block).toContain(
      'docker compose --profile observability up -d otel-lgtm',
    );
    expect(block).toMatch(/curl -fsS[^\n]*localhost:3300\/api\/health/);
    expect(block).toMatch(/curl -fsS -X POST[^\n]*localhost:4318\/v1\/logs/);
    expect(step(job('checks'), 'Stop the compose stack')).toContain(
      'docker compose --profile observability down -v --remove-orphans',
    );
  });

  // @traces 1175-FR-001 1175-FR-002 1175-FR-004
  it('runs the compose store on Valkey, refusing writes rather than evicting', () => {
    const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8');
    const service = compose.match(/^ {2}redis:\n((?: {4}.*\n|\n)+)/m)?.[1];

    expect(service).toMatch(/image: valkey\/valkey:9\n/);
    expect(service).toContain(
      "command: ['valkey-server', '--maxmemory-policy', 'noeviction']",
    );
    expect(service).toContain('valkey-cli');
    expect(compose).not.toMatch(/image: redis|redis-server|redis-cli/);
  });

  it('keeps otel-lgtm behind its profile at an exact version', () => {
    const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8');
    const service = compose.match(/^ {2}otel-lgtm:\n((?: {4}.*\n|\n)+)/m)?.[1];

    expect(service).toMatch(/image: grafana\/otel-lgtm:\d+\.\d+\.\d+\n/);
    expect(service).toMatch(/profiles: \[observability\]/);
    expect(compose.match(/profiles: .*/g)).toEqual([
      'profiles: [assistants]',
      'profiles: [observability]',
    ]);
  });

  it.each([
    ['unit', 'Unit tests', 'unit'],
    ['integration', 'Integration tests', 'integration'],
  ])("the %s job's %s step picks its Jest suite", (id, name, suite) => {
    expect(setting(step(job(id), name), 'JEST_SUITE')).toBe(suite);
  });

  it('migrates the database before the integration tests', () => {
    const block = job('integration');

    expect(block).toContain('ghcr.io/george-hutanu/motor-fix-postgres:18');
    expect(block.indexOf('prisma migrate deploy')).toBeGreaterThan(0);
    expect(block.indexOf('prisma migrate deploy')).toBeLessThan(
      block.indexOf('- name: Integration tests'),
    );
  });

  // The image preloads pg_stat_statements itself: no step restarts the
  // service container before the data-store specs read the view.
  // @traces 878-FR-013 1174-FR-003
  it('migrates straight after the object store, with no preload step', () => {
    const block = job('integration');

    expect(block).not.toContain('Preload pg_stat_statements');
    expect(block).not.toContain('docker restart');
    expect(block.indexOf('- name: Object storage')).toBeLessThan(
      block.indexOf('- name: Migrate the test database'),
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

describe('the object store the stack boots', () => {
  const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8');
  const services = [...compose.matchAll(/^ {2}([\w-]+):$/gm)].map((m) => m[1]);
  const storage =
    compose.match(/^ {2}storage:\n((?: {4}.*\n|\n)+)/m)?.[1] ?? '';
  const value = (key: string) =>
    storage.match(new RegExp(`^ +${key}: *(.+)$`, 'm'))?.[1]?.trim();
  const seconds = (key: string) =>
    Number(/^(\d+)s?$/.exec(value(key) ?? '')?.[1]);
  const storageEnv = {
    STORAGE_ACCESS_KEY_ID: 'motorfix',
    STORAGE_BUCKET: 'motorfix',
    STORAGE_ENDPOINT: 'http://localhost:9000',
    STORAGE_SECRET_ACCESS_KEY: 'motorfix-secret',
  };

  it('is one storage service with no setup service beside it', () => {
    expect(services).toEqual([
      'postgres',
      'redis',
      'storage',
      'keycloak',
      'otel-lgtm',
    ]);
  });

  it("runs a release pinned by digest, creating the apps' bucket as it starts", () => {
    expect(value('image')).toMatch(
      /^chrislusf\/seaweedfs:\d+\.\d+@sha256:[0-9a-f]{64}$/,
    );
    expect(value('command')).toMatch(/^mini .*-bucket=motorfix\b/);
    expect(value('command')).toContain('-master.telemetry=false');
  });

  it("serves the apps' endpoint and keys, its host port overridable", () => {
    expect(storage).toMatch(/- '\$\{STORAGE_PORT:-9000\}:8333'/);
    expect(value('AWS_ACCESS_KEY_ID')).toBe(storageEnv.STORAGE_ACCESS_KEY_ID);
    expect(value('AWS_SECRET_ACCESS_KEY')).toBe(
      storageEnv.STORAGE_SECRET_ACCESS_KEY,
    );
  });

  it('reports healthy only once the bucket exists, within 120 seconds', () => {
    expect(value('test')).toContain('/healthz');
    expect(value('test')).toContain('/buckets/motorfix/');
    expect(
      seconds('start_period') + seconds('interval') * seconds('retries'),
    ).toBeLessThanOrEqual(120);
  });

  it('runs the store spec in the compose stack check, against the store it started', () => {
    const block = step(job('checks'), 'Compose stack');

    expect(block).not.toContain('setup');
    expect(block).toMatch(
      /npx jest -c libs\/domain\/jest\.config\.cts libs\/domain\/src\/storage\/object-store\.integration\.spec\.ts/,
    );
    for (const [name, value] of Object.entries(storageEnv)) {
      expect(block).toContain(`${name}: ${value}`);
    }
  });

  it('starts the store for the integration suite, so the store spec never skips there', () => {
    const integration = job('integration');

    expect(step(integration, 'Object storage')).toContain(
      'docker compose up -d --wait storage',
    );
    for (const [name, value] of Object.entries(storageEnv)) {
      expect(integration).toContain(`${name}: ${value}`);
    }
  });

  it('starts the store for the end-to-end photo flows with no setup step', () => {
    const block = step(job('e2e'), 'Object storage');

    expect(block).toContain('docker compose up -d --wait storage');
    expect(block).not.toContain('setup');
  });
});
