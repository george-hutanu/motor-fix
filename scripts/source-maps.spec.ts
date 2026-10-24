import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');

const stage = (name: string) => {
  const from = dockerfile.search(new RegExp(`^FROM .* AS ${name}$`, 'm'));
  const next = dockerfile.slice(from + 1).search(/^FROM /m);
  return next < 0
    ? dockerfile.slice(from)
    : dockerfile.slice(from, from + 1 + next);
};

// @traces 251-FR-010
describe('readable server stacks', () => {
  it('starts the Node servers with their source maps', () => {
    expect(stage('node-app')).toMatch(
      /^ENV NODE_OPTIONS="--max-old-space-size-percentage=75 --enable-source-maps"$/m,
    );
  });

  it('leaves the web server as it is', () => {
    expect(stage('web')).not.toContain('--enable-source-maps');
  });

  it.each(['api', 'worker', 'mcp'])('builds %s with its source maps', (app) => {
    const config = readFileSync(
      join(root, 'apps', app, 'webpack.config.cjs'),
      'utf8',
    );
    expect(config).toMatch(/sourceMap: true/);
  });
});

// @traces 1188-FR-003 1188-FR-004 1188-FR-006
describe('the Node runtime in every image', () => {
  it('turns the compile cache on in a directory the node user can write', () => {
    expect(stage('runtime')).toMatch(
      /^ENV NODE_COMPILE_CACHE=\/tmp\/node-compile-cache$/m,
    );
  });

  it('sizes the heap at 75% of the container for the web server', () => {
    expect(stage('runtime')).toMatch(
      /^ENV NODE_OPTIONS=--max-old-space-size-percentage=75$/m,
    );
    expect(stage('web')).not.toMatch(/NODE_OPTIONS/);
  });

  it('fails the build when the image Node does not take the heap option', () => {
    expect(stage('build')).toMatch(
      /^RUN node --max-old-space-size-percentage=75 -e 0$/m,
    );
  });

  it('fails the build when an app that lists sharp cannot load it', () => {
    const build = stage('build');
    const install = build.indexOf('npm ci --omit=dev');
    const check = build.search(
      /grep -q '"sharp"' package\.json; then node -e "require\('sharp'\)"/,
    );
    expect(install).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(install);
  });
});

// @traces 251-FR-011
describe('the error tracker', () => {
  it('is Grafana Cloud alone: no package depends on a second tracker', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const names = Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
    });

    expect(names).toContain('@grafana/faro-web-sdk');
    expect(
      names.filter((n) => /sentry|bugsnag|rollbar|honeybadger/i.test(n)),
    ).toEqual([]);
  });
});
