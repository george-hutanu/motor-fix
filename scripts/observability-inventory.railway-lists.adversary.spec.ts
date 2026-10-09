import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { checkInventory } from './observability-inventory.ts';

const NONE = { alerts: 'none', dashboard: 'none', reason: 'later' };
let root: string;

const put = (path: string, content: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
};

const entries = (...names: string[]) =>
  names.map((name) => ({
    ...NONE,
    kind: 'railway-service',
    name,
    source: 'scripts/railway-deploy.ts',
    story: 'ST-1',
  }));

const app = {
  ...NONE,
  kind: 'app',
  name: 'api',
  source: 'apps/api',
  story: 'ST-1',
};

const inventory = (list: unknown[]) =>
  put(
    'infra/observability/inventory.json',
    JSON.stringify({
      endpoints: { count: 0, source: 'apps/api/openapi.json' },
      entries: [app, ...list],
    }),
  );

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'inventory-lists-'));
  put('apps/api/openapi.json', JSON.stringify({ paths: {} }));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('railway service discovery across environment lists', () => {
  it('reports a service that only the staging list names as missing', () => {
    put(
      'scripts/railway-deploy.ts',
      "const E = { production: { services: ['api'] }, staging: { services: ['api', 'mcp'] } };\n",
    );
    inventory(entries('api'));

    expect(checkInventory(root)).toEqual([
      'missing railway-service mcp (scripts/railway-deploy.ts)',
    ]);
  });

  it('reads a list that spans several lines with double quotes', () => {
    put(
      'scripts/railway-deploy.ts',
      'const E = {\n  staging: {\n    services: [\n      "api",\n      "keycloak",\n    ],\n  },\n};\n',
    );
    inventory(entries('api'));

    expect(checkInventory(root)).toEqual([
      'missing railway-service keycloak (scripts/railway-deploy.ts)',
    ]);
  });

  it('lists a service shared by two environments once', () => {
    put(
      'scripts/railway-deploy.ts',
      "const E = { a: { services: ['api'] }, b: { services: ['api'] } };\n",
    );
    inventory(entries('api'));

    expect(checkInventory(root)).toEqual([]);
  });

  it('flags an entry as stale once no list names the service any more', () => {
    put(
      'scripts/railway-deploy.ts',
      "const E = { staging: { services: ['api'] } };\n",
    );
    inventory(entries('api', 'mcp'));

    expect(checkInventory(root)).toEqual(['stale railway-service mcp']);
  });

  it('finds no service when the deploy script is absent', () => {
    inventory(entries('api'));

    expect(checkInventory(root)).toEqual(['stale railway-service api']);
  });
});
