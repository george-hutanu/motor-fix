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

  // @traces 346-FR-007
  repoIt('counts every OpenAPI operation and misses nothing', () => {
    expect(checkInventory(root)).toEqual([]);
  });

  // The opening hours ride the profile read the inventory already counts.
  // @traces 308-FR-017
  it('serves the opening hours through the existing profile read', () => {
    const openapi = JSON.parse(
      readFileSync(join(root, 'apps/api/openapi.json'), 'utf8'),
    );

    expect(Object.keys(openapi.paths['/api/v1/garages/{slug}'])).toEqual([
      'get',
    ]);
    expect(
      openapi.components.schemas.PublicGarageDto.properties,
    ).toHaveProperty('hours');
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

// @traces 299-FR-017
describe('the whole system log read', () => {
  it('keeps the route metric and says what the filters, the search and the cursor add', () => {
    const inventory = JSON.parse(
      readFileSync(join(root, 'infra/observability/inventory.json'), 'utf8'),
    );
    const entries: {
      name?: string;
      metric?: string;
      reason?: string;
      story?: string;
    }[] = Object.values(inventory).flatMap((each) =>
      Array.isArray(each) ? each : [],
    );
    const log = entries.find((each) => each.name === 'admin-system-log');

    expect(log?.story).toMatch(/\bST-299\b/);
    expect(log?.metric).toBe(
      'http.server.request.duration by http.route /api/v1/admin/system-log',
    );
    expect(log?.reason).toMatch(/type, severity, source/);
    expect(log?.reason).toMatch(/search/);
    expect(log?.reason).toMatch(/cursor/);
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

// @traces 210-FR-013
describe('the garage legal check read route', () => {
  it('is an OpenAPI operation the inventory lists with its metric and alerts', () => {
    const read = JSON.parse(
      readFileSync(join(root, 'apps/api/openapi.json'), 'utf8'),
    ).paths['/api/v1/garages/{garageId}/legal-check'];
    const inventory = JSON.parse(
      readFileSync(join(root, 'infra/observability/inventory.json'), 'utf8'),
    );
    const entries: {
      name?: string;
      metric?: string;
      alerts?: string[];
      story?: string;
    }[] = Object.values(inventory).flatMap((each) =>
      Array.isArray(each) ? each : [],
    );
    const legal = entries.find((each) => each.name === 'garage-legal-check');

    expect(Object.keys(read)).toEqual(['get']);
    expect(legal?.story).toBe('ST-210');
    expect(legal?.metric).toMatch(
      /\/api\/v1\/garages\/:garageId\/legal-check$/,
    );
    expect(legal?.alerts).toEqual(
      expect.arrayContaining(['api-error-rate', 'api-latency']),
    );
  });
});

// @traces 009-FR-013
describe('the copy voice on requests, drafts and the admin read', () => {
  repoIt('rides the routes the inventory already counts, adding none', () => {
    const api = JSON.parse(
      readFileSync(join(root, 'apps/api/openapi.json'), 'utf8'),
    );
    const fields = (schema: string) =>
      Object.keys(api.components.schemas[schema].properties);

    expect(fields('CreateQuoteRequestDto')).toContain('copyVoice');
    expect(fields('CreateListingDraftDto')).toContain('copyVoice');
    expect(fields('CopyVoiceDto')).toEqual(
      expect.arrayContaining(['requests', 'listings']),
    );
    expect(Object.keys(api.paths['/api/v1/quote-requests'])).toEqual(['post']);
    expect(Object.keys(api.paths['/api/v1/listing-drafts'])).toEqual(['post']);
    expect(Object.keys(api.paths['/api/v1/admin/copy-voices'])).toEqual([
      'get',
    ]);
    expect(checkInventory(root)).toEqual([]);
  });
});

// @traces 1192-FR-012
describe('the photo variant route', () => {
  it('is one OpenAPI operation, templated by its path, that the inventory counts', () => {
    const paths = Object.keys(
      JSON.parse(readFileSync(join(root, 'apps/api/openapi.json'), 'utf8'))
        .paths,
    ).filter((path) => path.startsWith('/api/v1/images/'));

    expect(paths).toEqual(['/api/v1/images/g/{owner}/{digest}/{file}']);
    expect(checkInventory(root)).toEqual([]);
  });
});

// @traces 398-FR-013
describe('the garage feature switch route', () => {
  repoIt(
    'is an OpenAPI operation the inventory lists under the api alerts, with no metric of its own',
    () => {
      const write = JSON.parse(
        readFileSync(join(root, 'apps/api/openapi.json'), 'utf8'),
      ).paths['/api/v1/garages/{garageId}/features/{feature}'];
      const inventory = JSON.parse(
        readFileSync(join(root, 'infra/observability/inventory.json'), 'utf8'),
      );
      const entries: {
        name?: string;
        metric?: string;
        alerts?: string[];
      }[] = Object.values(inventory).flatMap((each) =>
        Array.isArray(each) ? each : [],
      );
      const set = entries.find((each) => each.name === 'garage-features-set');

      expect(Object.keys(write)).toEqual(['put']);
      expect(set?.metric).toMatch(/^http\.server\.request\.duration/);
      expect(set?.alerts).toEqual(['api-error-rate', 'api-latency']);
      expect(checkInventory(root)).toEqual([]);
    },
  );
});

// @traces 025-FR-014
describe("the mechanic's reviews read and the review-ratings queue", () => {
  const inventory = () => {
    const parsed = JSON.parse(
      readFileSync(join(root, 'infra/observability/inventory.json'), 'utf8'),
    );
    const entries: {
      kind?: string;
      name?: string;
      metric?: string;
      source?: string;
      alerts?: string[];
    }[] = Object.values(parsed).flatMap((each) =>
      Array.isArray(each) ? each : [],
    );
    return entries;
  };

  it('lists the public read with its route metric and alerts', () => {
    const read = JSON.parse(
      readFileSync(join(root, 'apps/api/openapi.json'), 'utf8'),
    ).paths['/api/v1/reviews/mechanic/{mechanicId}'];
    const entry = inventory().find((each) => each.name === 'mechanic-reviews');

    expect(Object.keys(read)).toEqual(['get']);
    expect(entry?.metric).toMatch(
      /\/api\/v1\/reviews\/mechanic\/\{mechanicId\}$/,
    );
    expect(entry?.alerts).toEqual(['api-error-rate', 'api-latency']);
  });

  // @traces 024-FR-022
  it('lists the garage reviews read with its route metric, panel and alerts', () => {
    const read = JSON.parse(
      readFileSync(join(root, 'apps/api/openapi.json'), 'utf8'),
    ).paths['/api/v1/reviews/garage/{garageId}'];
    const entry = inventory().find((each) => each.name === 'garage-reviews');

    expect(Object.keys(read)).toEqual(['get']);
    expect(entry?.metric).toMatch(/\/api\/v1\/reviews\/garage\/\{garageId\}$/);
    expect(entry?.source).toBe('libs/domain/src/reviews/reviews.controller.ts');
    expect(entry?.alerts).toEqual(['api-error-rate', 'api-latency']);
  });

  it('lists the queue with its failed-job and backlog alerts', () => {
    const entry = inventory().find((each) => each.name === 'review-ratings');

    expect(entry?.kind).toBe('queue');
    expect(entry?.source).toBe(
      'libs/domain/src/reviews/ratings/ratings.module.ts',
    );
    expect(entry?.alerts).toEqual(
      expect.arrayContaining(['worker-jobs-failed', 'worker-queue-backlog']),
    );
  });
});

// @traces 133-FR-014
// @traces 1246-FR-025
describe("the staff read and the owner's save of a garage's own profile", () => {
  it('lists both operations with their metric and only the shared API alerts', () => {
    const read = JSON.parse(
      readFileSync(join(root, 'apps/api/openapi.json'), 'utf8'),
    ).paths['/api/v1/garages/{garageId}/profile'];
    const entries: { name?: string; [key: string]: unknown }[] = Object.values(
      JSON.parse(
        readFileSync(join(root, 'infra/observability/inventory.json'), 'utf8'),
      ),
    ).flatMap((each) => (Array.isArray(each) ? each : []));

    expect(Object.keys(read).sort()).toEqual(['get', 'patch']);
    expect(
      entries.find((each) => each.name === 'garage-profile'),
    ).toMatchObject({
      alerts: ['api-error-rate', 'api-latency'],
      dashboard: 'motorfix-api',
      metric: expect.stringMatching(/\/api\/v1\/garages\/:garageId\/profile$/),
      source:
        'libs/domain/src/garages/garage-profile/garage-profile.controller.ts',
    });
  });
});

// @traces 055-FR-015
describe("the garage's team read route", () => {
  it('is an OpenAPI operation the inventory lists with its metric and alerts', () => {
    const read = JSON.parse(
      readFileSync(join(root, 'apps/api/openapi.json'), 'utf8'),
    ).paths['/api/v1/garages/{garageId}/mechanics'];
    const inventory = JSON.parse(
      readFileSync(join(root, 'infra/observability/inventory.json'), 'utf8'),
    );
    const entries: { name?: string; metric?: string; alerts?: string[] }[] =
      Object.values(inventory).flatMap((each) =>
        Array.isArray(each) ? each : [],
      );
    const team = entries.find((each) => each.name === 'garage-mechanics-list');

    // @traces 056-FR-022
    expect(Object.keys(read).sort()).toEqual(['get', 'post']);
    expect(team?.metric).toMatch(/\/api\/v1\/garages\/:garageId\/mechanics$/);
    expect(team?.alerts).toEqual(['api-error-rate', 'api-latency']);
    // The owner's three writes, each with its route's metric and alerts.
    for (const [name, route] of [
      ['garage-mechanics-add', /\/mechanics$/],
      ['garage-mechanics-edit', /\/mechanics\/:mechanicId$/],
      ['garage-mechanics-remove', /\/mechanics\/:mechanicId$/],
    ] as const) {
      const write = entries.find((each) => each.name === name);
      expect(write?.metric).toMatch(route);
      expect(write?.alerts).toEqual(['api-error-rate', 'api-latency']);
    }
  });
});

// @traces 105-FR-018
describe('the admin brand list routes', () => {
  repoIt(
    'are OpenAPI operations the inventory lists with its metric and alerts',
    () => {
      const paths = JSON.parse(
        readFileSync(join(root, 'apps/api/openapi.json'), 'utf8'),
      ).paths;
      const inventory = JSON.parse(
        readFileSync(join(root, 'infra/observability/inventory.json'), 'utf8'),
      );
      const entries: { name?: string; metric?: string; alerts?: string[] }[] =
        Object.values(inventory).flatMap((each) =>
          Array.isArray(each) ? each : [],
        );
      const brands = entries.find((each) => each.name === 'admin-brands');

      expect(Object.keys(paths['/api/v1/admin/brands'])).toEqual(
        expect.arrayContaining(['get', 'post']),
      );
      expect(Object.keys(paths['/api/v1/admin/brands/{id}'])).toEqual([
        'patch',
      ]);
      expect(brands?.metric).toMatch(/\/api\/v1\/admin\/brands\/:id/);
      expect(brands?.alerts).toEqual(['api-error-rate', 'api-latency']);
      expect(checkInventory(root)).toEqual([]);
    },
  );
});

describe('the browser monitoring records', () => {
  const inventory = JSON.parse(
    readFileSync(join(root, 'infra/observability/inventory.json'), 'utf8'),
  );
  const readme = readFileSync(
    join(root, 'infra/observability/README.md'),
    'utf8',
  );

  // @traces 947-FR-011
  it('say Faro receives sessions and journeys under analytics consent only', () => {
    const faro = JSON.stringify(inventory).match(
      /"name":"grafana-faro"[^}]*"reason":"([^"]*)"/,
    )?.[1];

    expect(faro).toMatch(
      /under analytics consent only, a per-tab session id and the journey events session_start, session_resume and view_changed/,
    );
    expect(readme).toMatch(/Without analytics\s+consent: no session id/);
    expect(readme).toMatch(/no session replay is loaded/);
    expect(readme).not.toMatch(/only once the analytics consent gate\s+ships/);
  });
});

// @traces 102-FR-019
describe('the garage members read route', () => {
  it('is an OpenAPI operation the inventory lists with its metric, alerts and reason', () => {
    const route = JSON.parse(
      readFileSync(join(root, 'apps/api/openapi.json'), 'utf8'),
    ).paths['/api/v1/garages/{garageId}/members'];
    const inventory = JSON.parse(
      readFileSync(join(root, 'infra/observability/inventory.json'), 'utf8'),
    );
    const entries: {
      name?: string;
      metric?: string;
      alerts?: string[];
      reason?: string;
    }[] = Object.values(inventory).flatMap((each) =>
      Array.isArray(each) ? each : [],
    );
    const members = entries.find((each) => each.name === 'garage-members-list');

    expect(Object.keys(route)).toContain('get');
    expect(members?.metric).toMatch(/\/api\/v1\/garages\/:garageId\/members$/);
    expect(members?.alerts?.length).toBeGreaterThan(0);
    expect(members?.reason).toBeTruthy();
  });

  // @traces 058-FR-020
  it("lists the mechanic schedule routes under the API's existing alerts", () => {
    const { entries } = JSON.parse(
      readFileSync(join(root, 'infra/observability/inventory.json'), 'utf8'),
    ) as {
      entries: {
        alerts?: string[];
        metric?: string;
        name: string;
        reason?: string;
      }[];
    };
    const schedule = entries.filter((each) =>
      /mechanics\/:mechanicId\/(hours|days-off)/.test(each.metric ?? ''),
    );

    expect(
      schedule.map((each) => each.metric?.split(' ').at(-1)).sort(),
    ).toEqual([
      '/api/v1/garages/:garageId/mechanics/:mechanicId/days-off',
      '/api/v1/garages/:garageId/mechanics/:mechanicId/days-off/:dayOffId',
      '/api/v1/garages/:garageId/mechanics/:mechanicId/hours',
      '/api/v1/garages/:garageId/mechanics/:mechanicId/hours',
    ]);
    for (const each of schedule) {
      expect(each.alerts).toEqual(['api-error-rate', 'api-latency']);
      expect(each.reason).toBeTruthy();
    }
  });
});

// @traces 427-FR-015
// @traces 427-FR-016
// @traces 1395-FR-007
describe('the time-block routes', () => {
  repoIt(
    'are five OpenAPI operations the inventory lists under the api alerts, and the schedule read carries blocks',
    () => {
      const api = JSON.parse(
        readFileSync(join(root, 'apps/api/openapi.json'), 'utf8'),
      );
      const inventory = JSON.parse(
        readFileSync(join(root, 'infra/observability/inventory.json'), 'utf8'),
      );
      const base = '/api/v1/garages/{garageId}/time-blocks';

      expect(Object.keys(api.paths[base]).sort()).toEqual(['get', 'post']);
      expect(Object.keys(api.paths[`${base}/{blockId}`]).sort()).toEqual([
        'delete',
        'patch',
      ]);
      expect(Object.keys(api.paths[`${base}/options`])).toEqual(['get']);
      expect(
        Object.keys(api.components.schemas.GarageScheduleDto.properties),
      ).toContain('blocks');
      // The mechanic is the shared card, not an untyped object.
      expect(
        api.components.schemas.TimeBlockDto.properties.mechanic.allOf,
      ).toEqual([{ $ref: '#/components/schemas/BookingMechanicDto' }]);
      const listed = inventory.entries.filter(
        (entry: { kind: string; name: string }) =>
          entry.kind === 'endpoint' &&
          entry.name.startsWith('garage-time-block'),
      );
      expect(listed).toHaveLength(5);
      for (const entry of listed) {
        expect(entry.alerts).toEqual(['api-error-rate', 'api-latency']);
        expect(entry.story).toBe(
          entry.name === 'garage-time-block-options-read'
            ? 'ST-1395'
            : 'ST-427',
        );
      }
      expect(checkInventory(root)).toEqual([]);
    },
  );
});
