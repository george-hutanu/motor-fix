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

describe('release workflow', () => {
  it.each([
    ['production', 'release-production'],
    ['staging', 'release-staging'],
  ])('%s deploys queue in their own group and never cancel one in progress', (name, group) => {
    const block = job(name);

    expect(setting(block, 'group')).toBe(group);
    expect(setting(block, 'cancel-in-progress')).toBe('false');
  });

  it('promotes to production only after images and staging pass', () => {
    const block = job('production');

    expect(setting(block, 'needs')).toBe('[images, staging]');
    expect(setting(block, 'environment')).toBe('production');
    expect(block).not.toMatch(/^ +if:/m);
    expect(block).toContain(
      'run: exec node scripts/railway-deploy.ts production',
    );
  });

  it.each([
    'staging',
    'production',
  ])('%s runs the deploy script as the step process, so a cancel reaches it', (name) => {
    expect(job(name)).toMatch(
      new RegExp(`^ +run: exec node scripts/railway-deploy\\.ts ${name}$`, 'm'),
    );
  });
});
