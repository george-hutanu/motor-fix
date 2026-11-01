import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../..');
const json = (path: string) =>
  JSON.parse(readFileSync(join(root, path), 'utf8'));

// The published contract the web client is generated from.
const doc = json('apps/api/openapi.json');
const schemas = doc.components.schemas;

// @traces 295-FR-006
describe('the admin status read, in the OpenAPI document', () => {
  it('describes GET /api/v1/admin/status behind a token, answering the status DTO or 404', () => {
    const read = doc.paths['/api/v1/admin/status'];

    expect([
      Object.keys(read),
      read.get.security,
      read.get.responses['200'].content['application/json'].schema,
      Object.keys(read.get.responses).sort(),
    ]).toEqual([
      ['get'],
      [{ bearer: [] }],
      { $ref: '#/components/schemas/AdminStatusDto' },
      ['200', '404'],
    ]);
  });

  it('holds six tiles, the problems and the sentences', () => {
    const status = schemas.AdminStatusDto;

    expect([
      status.required,
      status.properties.tiles.minItems,
      status.properties.tiles.maxItems,
      status.properties.problems.items.enum,
    ]).toEqual([
      ['tiles', 'problems', 'sentences'],
      6,
      6,
      ['api', 'search', 'maps', 'email', 'notifications', 'backup'],
    ]);
  });

  it('describes a tile without the unconfirmed check', () => {
    expect(Object.keys(schemas.StatusTileDto.properties).sort()).toEqual([
      'checkedAt',
      'detail',
      'key',
      'short',
      'since',
      'stale',
      'state',
    ]);
  });

  it('is in the regenerated client', () => {
    const source = readFileSync(
      join(root, 'libs/data-access/src/lib/fn/admin/status-controller-read.ts'),
      'utf8',
    );

    expect(source).toContain(
      "statusControllerRead.PATH = '/api/v1/admin/status';",
    );
    expect(source).toContain('StrictHttpResponse<AdminStatusDto>');
  });
});

// @traces 295-FR-007
describe('the admin status read, in the observability inventory', () => {
  it('lists the route on the API dashboard with the API error and latency rules', () => {
    const inventory = json('infra/observability/inventory.json') as {
      entries: Record<string, unknown>[];
    };

    expect(
      inventory.entries.find((e) => e['name'] === 'admin-status'),
    ).toMatchObject({
      alerts: ['api-error-rate', 'api-latency'],
      dashboard: 'motorfix-api',
      kind: 'endpoint',
      metric: 'http.server.request.duration by http.route /api/v1/admin/status',
      source: 'libs/domain/src/status/status.controller.ts',
    });
  });
});
