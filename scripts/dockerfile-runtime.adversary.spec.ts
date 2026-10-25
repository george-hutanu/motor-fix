import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const text = readFileSync(join(__dirname, '..', 'Dockerfile'), 'utf8');
const lines = text.split('\n');

function stage(name: string): string {
  const start = lines.findIndex((l) =>
    new RegExp(`^FROM .* AS ${name}\\s*$`).test(l),
  );
  if (start < 0) throw new Error(`no stage ${name}`);
  const end = lines.findIndex((l, i) => i > start && /^FROM /.test(l));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

// The value the last ENV leaves, each \${key} in it read as Docker does: the
// value the earlier lines (or the parent stage) set.
function lastEnv(block: string, key: string): string | undefined {
  let value: string | undefined;
  for (const [, raw] of block.matchAll(new RegExp(`^ENV ${key}=(.*)$`, 'gm')))
    value = raw
      .replace(/^"|"$/g, '')
      .replaceAll(`\${${key}}`, value ?? '')
      .trim();
  return value;
}

// @traces 1188-FR-004
describe('the heap flag in the images', () => {
  it('sizes the web image heap at 75 percent and never by a fixed megabyte figure', () => {
    const options = lastEnv(
      `${stage('runtime')}\n${stage('web')}`,
      'NODE_OPTIONS',
    );
    expect(options).toBe('--max-old-space-size-percentage=75');
  });

  it('keeps source maps and the percentage heap together in the node-app image', () => {
    const options = lastEnv(
      `${stage('runtime')}\n${stage('node-app')}`,
      'NODE_OPTIONS',
    );
    expect(options?.split(/\s+/).sort()).toEqual([
      '--enable-source-maps',
      '--max-old-space-size-percentage=75',
    ]);
  });

  it('has no fixed --max-old-space-size figure anywhere in the file', () => {
    expect(text).not.toMatch(/--max-old-space-size=\d/);
  });

  it('checks the flag in the build stage before any dependency is installed', () => {
    const build = stage('build');
    const check = build.indexOf('node --max-old-space-size-percentage=75 -e 0');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(build.indexOf('npm ci'));
  });
});

// @traces 1188-FR-003
describe('the compile cache in the images', () => {
  it('sets a compile cache directory the node user can write, outside /app', () => {
    const dir = lastEnv(stage('runtime'), 'NODE_COMPILE_CACHE');
    expect(dir).toMatch(/^\/(tmp|home\/node)\//);
  });

  it('does not override the compile cache in the web or node-app targets', () => {
    expect(stage('web')).not.toMatch(/NODE_COMPILE_CACHE/);
    expect(stage('node-app')).not.toMatch(/NODE_COMPILE_CACHE/);
  });

  it('sets the cache before the process user switch and runs as node', () => {
    const runtime = stage('runtime');
    expect(runtime.indexOf('NODE_COMPILE_CACHE')).toBeLessThan(
      runtime.indexOf('USER node'),
    );
  });

  it('does not disable the cache through NODE_DISABLE_COMPILE_CACHE', () => {
    expect(text).not.toMatch(/NODE_DISABLE_COMPILE_CACHE/);
  });
});

// @traces 1188-FR-006
describe('the image-processing library in the build stage', () => {
  it('loads sharp only after the pruned dependencies are installed', () => {
    const build = stage('build');
    const install = build.indexOf('npm ci --omit=dev');
    const load = build.indexOf("require('sharp')");
    expect(install).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(install);
  });

  it('does not rebuild any native module from source', () => {
    expect(text).not.toMatch(/npm rebuild|node-gyp|--build-from-source/);
  });

  it('runs the load check in the app directory with no shell fallback that hides a failure', () => {
    const load = lines.find((l) => l.includes("require('sharp')")) ?? '';
    expect(load).toContain(`cd dist/apps/\${APP}`);
    expect(load).not.toMatch(/\|\|\s*(true|:)|;\s*true|2>\s*\/dev\/null/);
  });

  it('installs the runtime dependencies without running install scripts that need a compiler', () => {
    expect(stage('build')).not.toMatch(/apt-get|build-essential|python3/);
  });
});

// @traces 1188-FR-005
describe('one process per replica in the images', () => {
  it('starts each target with a plain node command, not a cluster or process manager', () => {
    expect(text).not.toMatch(/pm2|cluster|forever|--workers/i);
    expect(stage('web')).toContain('CMD ["node", "server/server.mjs"]');
    expect(stage('node-app')).toContain('CMD ["node", "main.js"]');
  });
});
