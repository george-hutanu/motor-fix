import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkInventory } from './observability-inventory.ts';

const root = join(__dirname, '..');

// @traces 220-FR-016
describe('the repository inventory', () => {
  it('lists the request, quote and job read routes in the OpenAPI document', () => {
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
  });

  it('counts every OpenAPI operation and misses nothing', () => {
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
