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
});
