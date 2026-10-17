import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkInventory } from './observability-inventory.ts';

const root = join(__dirname, '..');
// Under an in-place mutation run (scripts/mutation.ts) the repository's own
// sources are instrumented, so a spec that reads them or times a scan skips.
const repoIt = process.env['MUTATION_IN_PLACE'] ? it.skip : it;

// @traces 220-FR-016
describe('the repository inventory', () => {
  repoIt(
    'lists the request, quote and job read routes in the OpenAPI document',
    () => {
      const paths = Object.keys(
        JSON.parse(readFileSync(join(root, 'apps/api/openapi.json'), 'utf8'))
          .paths,
      );

      expect(paths).toEqual(
        expect.arrayContaining([
          '/api/v1/requests',
          '/api/v1/requests/{id}',
          '/api/v1/garage/requests',
          '/api/v1/garage/requests/{id}',
          '/api/v1/garage/jobs',
          '/api/v1/garage/jobs/{id}',
        ]),
      );
    },
  );

  repoIt('counts every OpenAPI operation and misses nothing', () => {
    expect(checkInventory(root)).toEqual([]);
  });

  // @traces 115-FR-014
  it('lists the listing draft check with its request metric', () => {
    const inventory = JSON.parse(
      readFileSync(join(root, 'infra/observability/inventory.json'), 'utf8'),
    );
    const entries: { name?: string; metric?: string }[] = Object.values(
      inventory,
    ).flatMap((each) => (Array.isArray(each) ? each : []));
    const check = entries.find((each) => each.name === 'listing-draft-check');

    expect(check?.metric).toMatch(/\/api\/v1\/listing-drafts\/:id\/check/);
  });
});

// @traces 092-FR-013
describe('the car edit and removal routes', () => {
  it('are OpenAPI operations the inventory counts', () => {
    const car = JSON.parse(
      readFileSync(join(root, 'apps/api/openapi.json'), 'utf8'),
    ).paths['/api/v1/cars/{id}'];

    expect(Object.keys(car)).toEqual(
      expect.arrayContaining(['patch', 'delete']),
    );
    expect(checkInventory(root)).toEqual([]);
  });
});

// @traces 291-FR-005
describe('the saved garages list route', () => {
  it('is an OpenAPI operation the inventory lists with its metric and alerts', () => {
    const list = JSON.parse(
      readFileSync(join(root, 'apps/api/openapi.json'), 'utf8'),
    ).paths['/api/v1/me/saved-garages'];
    const inventory = JSON.parse(
      readFileSync(join(root, 'infra/observability/inventory.json'), 'utf8'),
    );
    const entries: { name?: string; metric?: string; alerts?: string[] }[] =
      Object.values(inventory).flatMap((each) =>
        Array.isArray(each) ? each : [],
      );
    const saved = entries.find((each) => each.name === 'saved-garages');

    expect(Object.keys(list)).toContain('get');
    expect(saved?.metric).toMatch(/\/api\/v1\/me\/saved-garages(,| )/);
    expect(saved?.alerts?.length).toBeGreaterThan(0);
  });
});

// @traces 298-FR-013
describe('the system log read route', () => {
  it('is an OpenAPI operation the inventory lists with its metric and alerts', () => {
    const read = JSON.parse(
      readFileSync(join(root, 'apps/api/openapi.json'), 'utf8'),
    ).paths['/api/v1/admin/system-log'];
    const inventory = JSON.parse(
      readFileSync(join(root, 'infra/observability/inventory.json'), 'utf8'),
    );
    const entries: { name?: string; metric?: string; alerts?: string[] }[] =
      Object.values(inventory).flatMap((each) =>
        Array.isArray(each) ? each : [],
      );
    const log = entries.find((each) => each.name === 'admin-system-log');

    expect(Object.keys(read)).toEqual(['get']);
    expect(log?.metric).toMatch(/\/api\/v1\/admin\/system-log$/);
    expect(log?.alerts?.length).toBeGreaterThan(0);
  });
});

describe('the map pins and verification file entries', () => {
  it('keeps the ST-269 pins route and counter beside the ST-302 file routes', () => {
    const inventory = JSON.parse(
      readFileSync(join(root, 'infra/observability/inventory.json'), 'utf8'),
    );
    const names = (inventory.entries as { name: string }[]).map(
      (each) => each.name,
    );

    expect(names).toEqual(
      expect.arrayContaining([
        'search-garages-pins',
        'motorfix_search_pins_total',
        'admin-verification-file-read',
        'admin-verification-file-open',
      ]),
    );
  });
});

// @traces 270-FR-012
describe('the reads a result card and its pin use', () => {
  it('are the search and pins routes the inventory already lists, with their alerts', () => {
    const paths = JSON.parse(
      readFileSync(join(root, 'apps/api/openapi.json'), 'utf8'),
    ).paths;
    const inventory = JSON.parse(
      readFileSync(join(root, 'infra/observability/inventory.json'), 'utf8'),
    );
    const entries: { name?: string; alerts?: string[] }[] = Object.values(
      inventory,
    ).flatMap((each) => (Array.isArray(each) ? each : []));
    const alerted = (name: string) =>
      entries.find((each) => each.name === name)?.alerts?.length ?? 0;

    expect(Object.keys(paths['/api/v1/search/garages'])).toContain('get');
    expect(Object.keys(paths['/api/v1/search/garages/pins'])).toContain('get');
    expect(alerted('search-garages')).toBeGreaterThan(0);
    expect(alerted('search-garages-pins')).toBeGreaterThan(0);
  });
});
