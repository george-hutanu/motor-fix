import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

  it('promotes to production only after images and staging pass', () => {
    const block = job('production');

    expect(setting(block, 'needs')).toBe('[images, staging]');
    expect(setting(block, 'environment')).toBe('production');
    expect(block).not.toMatch(/^ +if:/m);
    expect(block).toContain(
      'run: exec node scripts/railway-deploy.ts production',
    );
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
  it('seeds staging after the deploy and before the end-to-end run', () => {
    const block = job('staging');
    const deploy = block.indexOf(
      'run: exec node scripts/railway-deploy.ts staging',
    );
    const seed = block.indexOf('name: Seed staging inside the api');
    const e2e = block.indexOf('name: End to end on staging');
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

  it('never gives production the MCP or identity server', () => {
    expect(job('production')).not.toMatch(/MCP|KEYCLOAK|keycloak/);
  });
});
