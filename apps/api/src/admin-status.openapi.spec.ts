import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../..');
const json = (path: string) =>
  JSON.parse(readFileSync(join(root, path), 'utf8'));

// The published contract the web client is generated from.
const doc = json('apps/api/openapi.json');

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
