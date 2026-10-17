import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { script } from './workflow-text.ts';

// The release workflow's job settings, read as indented text: the repository
// has no YAML parser as a direct dependency, and these few keys are enough.
const workflow = readFileSync(
  join(__dirname, '..', '.github', 'workflows', 'release.yml'),
  'utf8',
);

function job(name: string): string {
  const lines = workflow.split('\n');
  const start = lines.indexOf(`  ${name}:`);
  if (start < 0) throw new Error(`release.yml has no job ${name}`);
  const end = lines.findIndex((line, i) => i > start && /^ {2}\S/.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

const setting = (block: string, key: string) =>
  block.match(new RegExp(`^ +${key}: *(.+)$`, 'm'))?.[1]?.trim();

// Runs one staging step's `run: |` script in bash from the repository root,
// with only PATH and the given variables.
function stepRun(name: string, env: Record<string, string>) {
  const block = job('staging');
  const start = block.indexOf(`- name: ${name}`);
  if (start < 0) throw new Error(`staging has no step ${name}`);
  const next = block.indexOf('- name:', start + 1);
  const step = block.slice(start, next < 0 ? undefined : next);
  const run = spawnSync('bash', ['-e', '-c', script(step)], {
    cwd: join(__dirname, '..'),
    encoding: 'utf8',
    env: { PATH: process.env['PATH'], ...env },
  });
  return { code: run.status, out: `${run.stdout}${run.stderr}` };
}

// A GitHub expression, as the workflow writes it.
const gh = (ref: string) => `\${{ ${ref} }}`;

describe('release workflow', () => {
  it.each([
    ['production', 'release-production'],
    ['staging', 'release-staging'],
  ])(
    '%s deploys queue in their own group and never cancel one in progress',
    (name, group) => {
      const block = job(name);

      expect(setting(block, 'group')).toBe(group);
      expect(setting(block, 'cancel-in-progress')).toBe('false');
    },
  );

  // Merges in quick succession queue their checks instead of each holding
  // five runners at once; a queued run is replaced by the newest, a running
  // one finishes.
  it('runs one release check at a time, never cancelling one in progress', () => {
    const block = job('checks');

    expect(setting(block, 'group')).toBe('release-checks');
    expect(setting(block, 'cancel-in-progress')).toBe('false');
  });

  // @traces 1170-FR-004
  // A PR no longer runs the integration suite, so the release asks CI for it
  // and nothing is built or deployed until it passed.
  it('runs the integration suite in its checks, before the images', () => {
    const block = job('checks');

    expect(setting(block, 'uses')).toBe('./.github/workflows/ci.yml');
    expect(block).toMatch(/^ {4}with:\n {6}integration: true$/m);
    expect(setting(job('images'), 'needs')).toBe('checks');
  });

  // Only main's builds can write a cache PRs can read, so the images job
  // writes the scopes the PR's Docker build job reads.
  function image(id: string): string {
    const block = job('images');
    const at = block.indexOf(`- id: ${id}\n`);
    const next = block.indexOf('- id: ', at + 1);
    return block.slice(at, next < 0 ? undefined : next);
  }

  it.each(['web', 'api'])(
    'the %s image reads and writes its own layer cache',
    (app) => {
      const step = image(app);

      expect(setting(step, 'cache-from')).toBe(`type=gha,scope=${app}`);
      expect(setting(step, 'cache-to')).toBe(`type=gha,mode=max,scope=${app}`);
    },
  );

  it.each(['worker', 'mcp'])(
    'the %s image reads the api cache, the same node-app stage, and writes none',
    (app) => {
      const step = image(app);

      expect(setting(step, 'cache-from')).toBe('type=gha,scope=api');
      expect(setting(step, 'cache-to')).toBeUndefined();
    },
  );

  // @traces 1348-FR-001
  it('promotes to production only after images and staging pass, and only while it is on', () => {
    const block = job('production');
    const condition = setting(block, 'if');

    expect(condition).toBe("vars.PRODUCTION_ENABLED == 'true'");
    expect(condition).not.toMatch(/needs\.|success\(|failure\(|always\(/);
    expect(setting(block, 'needs')).toBe('[images, staging]');
    expect(setting(block, 'environment')).toBe('production');
    expect(setting(block, 'group')).toBe('release-production');
    expect(block).toContain(
      'run: exec node scripts/railway-deploy.ts production',
    );
  });

  // @traces 1348-FR-001
  it('ends staging with a note, after the core flows, while production is off', () => {
    const block = job('staging');
    const at = block.indexOf('- name: Note that production is off');
    const note = block.slice(at);

    expect(at).toBeGreaterThan(block.indexOf('- name: Core flows on staging'));
    expect(note).not.toMatch(/^ {6}- /m);
    expect(setting(note, 'if')).toBe("vars.PRODUCTION_ENABLED != 'true'");
  });

  // @traces 1348-FR-001
  it('says in a notice and in the run summary that production is off and who turns it on', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-note-'));
    try {
      const summary = join(dir, 'summary.md');
      const { code, out } = stepRun('Note that production is off', {
        GITHUB_STEP_SUMMARY: summary,
      });
      const notice = out
        .split('\n')
        .find((line) => line.startsWith('::notice'));

      expect(code).toBe(0);
      expect(notice).toContain('PRODUCTION_ENABLED');
      expect(notice).toContain('owner');
      const lines = readFileSync(summary, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('PRODUCTION_ENABLED');
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it.each(['staging', 'production'])(
    '%s runs the deploy script as the step process, so a cancel reaches it',
    (name) => {
      expect(job(name)).toMatch(
        new RegExp(
          `^ +run: exec node scripts/railway-deploy\\.ts ${name}$`,
          'm',
        ),
      );
    },
  );

  // Staging is seeded only by the hand-started reset, so a seed account added
  // after the last reset (sofer2@, comutare@) was missing there and the specs
  // signing in as it failed the release. The seed only adds what is missing.
  it('seeds staging after the deploy and before the core-flow run', () => {
    const block = job('staging');
    const deploy = block.indexOf(
      'run: exec node scripts/railway-deploy.ts staging',
    );
    const seed = block.indexOf('name: Seed staging inside the api');
    const e2e = block.indexOf('name: Core flows on staging');
    const step = block.slice(seed, block.indexOf('- name:', seed + 1));

    expect(deploy).toBeGreaterThan(0);
    expect(seed).toBeGreaterThan(deploy);
    expect(e2e).toBeGreaterThan(seed);
    expect(step).toContain("printf 'export SEED_ONLY=1\\n'");
    expect(step).toContain('cat scripts/reset-staging.sh');
    expect(step).toMatch(
      /railway ssh --project "\$RAILWAY_PROJECT_ID" --environment "\$RAILWAY_ENVIRONMENT_ID" --service "\$RAILWAY_SERVICE_API" -- sh -s/,
    );
    expect(step).toContain('::add-mask::');
    expect(setting(step, 'SEED_PASSWORD')).toBe(gh('secrets.SEED_PASSWORD'));
    expect(step).not.toMatch(/echo[^\n]*\$\{?SEED_PASSWORD/);
    expect(setting(block, 'RAILWAY_PROJECT_ID')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("removes the seed run's SSH key even when the seed fails", () => {
    const block = job('staging');
    const at = block.indexOf('railway ssh keys remove "$KEY_NAME"');
    const step = block.slice(block.lastIndexOf('- name:', at), at);

    expect(block).toContain(
      'railway ssh keys add --key ~/.ssh/id_ed25519.pub --name "$KEY_NAME"',
    );
    expect(at).toBeGreaterThan(0);
    expect(step).toMatch(/^ +if: always\(\)$/m);
  });

  function step(block: string, name: string): string {
    const at = block.indexOf(`- name: ${name}\n`);
    if (at < 0) throw new Error(`no step ${name}`);
    const next = block.indexOf('\n      - ', at + 1);
    return block.slice(at, next < 0 ? undefined : next);
  }

  const GRAFANA = gh(
    "secrets.GRAFANA_SA_TOKEN != '' && vars.GRAFANA_URL != ''",
  );

  // @traces 879-FR-013
  it('pushes every dashboard to Grafana after the builds, the token in the header only', () => {
    const block = job('images');
    const push = step(block, 'Push the dashboards');

    expect(setting(block, 'GRAFANA')).toBe(GRAFANA);
    expect(push).toMatch(/^ +if: env\.GRAFANA == 'true'$/m);
    expect(push).toContain('infra/observability/grafana/dashboards/*.json');
    expect(push).toContain('overwrite: true');
    expect(push).toContain('/api/dashboards/db');
    expect(push).toContain('--fail-with-body');
    expect(push).toContain('--max-time 60');
    expect(push).toContain(
      `GRAFANA_SA_TOKEN: ${gh('secrets.GRAFANA_SA_TOKEN')}`,
    );
    expect(push).toContain(`GRAFANA_URL: ${gh('vars.GRAFANA_URL')}`);
    expect(push.match(/\$\{GRAFANA_SA_TOKEN\}/g)).toHaveLength(1);
    expect(push).toContain(`-H "Authorization: Bearer \${GRAFANA_SA_TOKEN}"`);
    expect(block.indexOf('- name: Push the dashboards')).toBeGreaterThan(
      block.indexOf('- id: mcp'),
    );
    expect(setting(job('staging'), 'needs')).toBe('images');
  });

  // @traces 879-FR-013
  it('skips the push with a notice naming what is not set, and goes on', () => {
    const skip = step(job('images'), 'Skip the dashboards');

    expect(skip).toMatch(/^ +if: env\.GRAFANA != 'true'$/m);
    expect(skip).toContain('GRAFANA_SA_TOKEN');
    expect(skip).toContain('GRAFANA_URL');
    expect(skip).toContain('::notice::');
    expect(skip).not.toContain('exit 1');
  });

  // @traces 879-FR-014
  it.each(['staging', 'production'])(
    'annotates the %s deploy in Grafana right after it',
    (name) => {
      const block = job(name);
      const note = step(block, 'Annotate the deploy');

      expect(setting(block, 'GRAFANA')).toBe(GRAFANA);
      expect(note).toMatch(/^ +\[ "\$GRAFANA" = "true" \] \|\| exit 0$/m);
      expect(note).toContain(`"env:${name}"`);
      expect(note).toContain('"deploy"');
      expect(note).toContain('/api/annotations');
      expect(note).toContain('--max-time 60');
      expect(note).toContain(`--arg sha "\${GITHUB_SHA}"`);
      expect(note).toContain(`-H "Authorization: Bearer \${GRAFANA_SA_TOKEN}"`);
      expect(block.indexOf('- name: Annotate the deploy')).toBeGreaterThan(
        block.indexOf(`railway-deploy.ts ${name}`),
      );
    },
  );

  // @traces 879-FR-014
  it.each(['staging', 'production'])(
    'warns, and does not fail the %s release, when Grafana refuses the annotation',
    (name) => {
      const note = step(job(name), 'Annotate the deploy');

      expect(note).toMatch(/\|\|\s+echo "::warning::[^"]*annotation[^"]*"$/m);
      expect(note).not.toContain('continue-on-error');
    },
  );
  // The identity server and the MCP server reach staging only: production is
  // shut down by the owner's decision and promotes neither.
  it('builds the keycloak image from its own folder and exposes its digest', () => {
    const block = job('images');
    const step = image('keycloak');

    expect(setting(block, 'keycloak')).toBe(
      gh('steps.keycloak.outputs.digest'),
    );
    expect(setting(step, 'context')).toBe('infra/keycloak');
    expect(setting(step, 'file')).toBe('infra/keycloak/Dockerfile');
    expect(setting(step, 'push')).toBe('true');
    expect(setting(step, 'tags')).toBe(
      `ghcr.io/${gh('github.repository')}-keycloak:${gh('github.sha')}`,
    );
    expect(block.indexOf('- name: Push the dashboards')).toBeGreaterThan(
      block.indexOf('- id: keycloak'),
    );
  });

  it('gives staging the images and service ids of the MCP and identity servers', () => {
    const block = job('staging');

    expect(setting(block, 'IMAGE_MCP')).toBe(
      `ghcr.io/${gh('github.repository')}-mcp@${gh('needs.images.outputs.mcp')}`,
    );
    expect(setting(block, 'IMAGE_KEYCLOAK')).toBe(
      `ghcr.io/${gh('github.repository')}-keycloak@${gh('needs.images.outputs.keycloak')}`,
    );
    expect(setting(block, 'RAILWAY_SERVICE_MCP')).toBe(
      gh('vars.RAILWAY_SERVICE_MCP'),
    );
    expect(setting(block, 'RAILWAY_SERVICE_KEYCLOAK')).toBe(
      gh('vars.RAILWAY_SERVICE_KEYCLOAK'),
    );
    expect(block).toContain(
      "- name: Deploy and wait for each service's health check",
    );
  });

  // @traces 1019-FR-007
  it('checks the MCP sign-in right after the deploy, before the core flows', () => {
    const block = job('staging');
    const deploy = block.indexOf(
      'run: exec node scripts/railway-deploy.ts staging',
    );
    const check = block.indexOf('name: Check the MCP sign-in on staging');
    const e2e = block.indexOf('name: Core flows on staging');
    const step = block.slice(check, block.indexOf('- name:', check + 1));

    expect(setting(block, 'MCP_URL')).toBe(gh('vars.MCP_URL'));
    expect(deploy).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(deploy);
    expect(e2e).toBeGreaterThan(check);
    expect(step).toContain('node scripts/mcp-smoke.ts "$MCP_URL"');
    expect(step).not.toMatch(/continue-on-error|\|\| *true|if:/);
  });

  // @traces 1019-FR-007
  it.each([
    ['', '', 'RAILWAY_SERVICE_MCP, MCP_URL'],
    ['svc', '', 'MCP_URL'],
    ['', 'https://mcp.example/mcp', 'RAILWAY_SERVICE_MCP'],
  ])(
    'skips the MCP check with one notice when service %j or address %j is unset',
    (service, address, missing) => {
      const run = stepRun('Check the MCP sign-in on staging', {
        MCP_URL: address,
        RAILWAY_SERVICE_MCP: service,
      });

      expect(run.code).toBe(0);
      expect(run.out.trim()).toBe(
        `::notice::MCP sign-in check skipped (unset: ${missing})`,
      );
    },
  );

  // @traces 1019-FR-007
  it('fails the staging job when the MCP check fails', () => {
    const run = stepRun('Check the MCP sign-in on staging', {
      MCP_URL: 'http://127.0.0.1:9/mcp',
      RAILWAY_SERVICE_MCP: 'svc',
    });

    expect(run.code).toBe(1);
    expect(run.out).toMatch(/^FAIL challenge/m);
  });

  it('never gives production the MCP or identity server', () => {
    expect(job('production')).not.toMatch(/MCP|KEYCLOAK|keycloak/);
  });
});

// The constitution's three core flows run before every release: search to a
// quote request, the quote, and a listing to its approval. Each keeps at
// least one test tagged @core, the tag the release's staging step selects.
describe('the core flows a release runs', () => {
  const e2e = join(__dirname, '..', 'apps', 'web-e2e', 'src');
  const tagged = (file: string) =>
    readFileSync(join(e2e, file), 'utf8').match(/@core['`]/g)?.length ?? 0;

  it('selects the tests tagged @core on staging', () => {
    expect(job('staging')).toContain(
      'run: npx nx run web-e2e:e2e --skip-nx-cache --grep @core\n',
    );
  });

  it.each([
    ['search to a quote request', 'home.spec.ts'],
    ['search to a quote request', 'quote-request.spec.ts'],
    ['the quote', 'send-quote.spec.ts'],
    ['a listing to its approval', 'admin-dashboard.spec.ts'],
    ['a listing to its approval', 'garage-views.spec.ts'],
  ])('%s keeps a @core test in %s', (_flow, file) => {
    expect(tagged(file)).toBeGreaterThan(0);
  });
});

// @traces 430-FR-004
describe('the CDN purge after a deploy', () => {
  // A step's lines, from its `- name:` to the next step.
  function step(block: string, name: string): string {
    const lines = block.split('\n');
    const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
    if (start < 0) return '';
    const indent = lines[start]?.indexOf('-') ?? 0;
    const end = lines.findIndex(
      (line, i) =>
        i > start &&
        line.indexOf('- ') === indent &&
        line.trim().startsWith('- '),
    );
    return lines.slice(start, end < 0 ? undefined : end).join('\n');
  }

  const stepNames = (block: string) =>
    [...block.matchAll(/^ {6}- name: (.+)$/gm)].map((m) => m[1]?.trim());

  it.each([
    ['staging', "Deploy and wait for each service's health check"],
    [
      'production',
      'Deploy the staging-proven digests and wait for /health/ready',
    ],
  ])('%s purges its zone right after its deploy is healthy', (name, deploy) => {
    const names = stepNames(job(name));

    expect(names.indexOf('Purge the CDN')).toBe(names.indexOf(deploy) + 1);
  });

  it.each(['staging', 'production'])(
    '%s skips the purge with a notice until the key is set, and a failed purge only warns',
    (name) => {
      const purge = step(job(name), 'Purge the CDN');

      expect(setting(purge, 'BUNNY_API_KEY')).toBe(gh('secrets.BUNNY_API_KEY'));
      expect(setting(purge, 'BUNNY_PULL_ZONE_ID')).toBe(
        gh('vars.BUNNY_PULL_ZONE_ID'),
      );
      expect(purge).toContain('[ -n "$BUNNY_API_KEY" ] ||');
      expect(purge).toContain('::notice::');
      expect(purge).toMatch(
        /node scripts\/cdn\.ts purge --zone \|\|\s*echo "::warning::/,
      );
      expect(purge).not.toMatch(/continue-on-error|^\s+if:/m);
    },
  );
});
