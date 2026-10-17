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

// @traces 357-FR-011
describe('the price list read route', () => {
  const read = (path: string) =>
    JSON.parse(readFileSync(join(root, path), 'utf8'));

  repoIt('is counted by the inventory from the OpenAPI document', () => {
    const openapi = read('apps/api/openapi.json');
    const operations = Object.values(
      openapi.paths as Record<string, object>,
    ).reduce((sum, each) => sum + Object.keys(each).length, 0);

    expect(Object.keys(openapi.paths)).toContain(
      '/api/v1/garages/{garageId}/prices',
    );
    expect(read('infra/observability/inventory.json').endpoints).toEqual({
      count: operations,
      source: 'apps/api/openapi.json',
    });
    expect(checkInventory(root)).toEqual([]);
  });

  it("falls under the api's duration and error panels and alerts, which no route filter narrows", () => {
    const inventory = read('infra/observability/inventory.json');
    const api = (
      inventory.entries as {
        kind: string;
        name: string;
        dashboard: string;
        alerts: string[];
      }[]
    ).find((each) => each.kind === 'app' && each.name === 'api');
    expect(api?.dashboard).toBe('motorfix-api');
    expect(api?.alerts).toEqual(
      expect.arrayContaining(['api-error-rate', 'api-latency']),
    );

    const rules = (
      read('infra/observability/alerts/api.json').groups as {
        rules: { uid: string; data: { model: { expr?: string } }[] }[];
      }[]
    ).flatMap((group) => group.rules);
    for (const uid of ['api-error-rate', 'api-latency']) {
      const exprs = rules
        .find((rule) => rule.uid === uid)
        ?.data.map((each) => each.model.expr ?? '')
        .join(' ');
      expect(exprs).toMatch(
        /http_server_request_duration_seconds_\w+\{service_name="api"/,
      );
      expect(exprs).not.toContain('http_route');
    }

    const panels = (
      read('infra/observability/grafana/dashboards/motorfix-api.json')
        .panels as {
        title: string;
        targets?: { expr?: string }[];
      }[]
    ).map((panel) => ({
      expr: (panel.targets ?? []).map((each) => each.expr ?? '').join(' '),
      title: panel.title,
    }));
    const byRoute = panels.find((each) => each.title === 'Requests by route');
    const errorsByRoute = panels.find(
      (each) => each.title === 'Errors by route',
    );
    expect(byRoute?.expr).toMatch(
      /sum by \(http_route\).*http_server_request_duration_seconds_count/,
    );
    expect(errorsByRoute?.expr).toMatch(/http_response_status_code=~"5\.\."/);
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
