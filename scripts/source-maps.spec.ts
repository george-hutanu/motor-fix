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
      /^ENV NODE_OPTIONS=--enable-source-maps$/m,
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
