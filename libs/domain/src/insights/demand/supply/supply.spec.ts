// @traces 106-FR-012 106-FR-013
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../../../../..');
const read = (path: string) =>
  JSON.parse(readFileSync(join(ROOT, path), 'utf8'));

describe('the demand against supply route in the OpenAPI document', () => {
  const document = read('apps/api/openapi.json');
  const get = document.paths['/api/v1/admin/demand/supply']?.get;

  it('takes the brand and area filters and answers the supply document', () => {
    expect(
      get.parameters.map((p: { in: string; name: string }) => [p.in, p.name]),
    ).toEqual([
      ['query', 'brand'],
      ['query', 'area'],
    ]);
    expect(get.responses['200'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/AdminDemandSupplyDto',
    });
    expect(Object.keys(get.responses).sort()).toEqual(['200', '400', '404']);
  });

  it('describes the answer and its rows with a nullable requests per garage', () => {
    const { schemas } = document.components;

    expect(schemas.AdminDemandSupplyDto.required.sort()).toEqual([
      'areas',
      'firstDay',
      'lastDay',
      'rows',
      'writtenAt',
    ]);
    expect(
      schemas.AdminDemandSupplyRowDto.properties.requestsPerGarage,
    ).toMatchObject({ nullable: true, type: 'integer' });
    expect(schemas.AdminAreaDto.properties.kind.enum).toEqual([
      'city',
      'sector',
      'unknown',
    ]);
  });

  it('leaves the demand read as it was', () => {
    expect(document.paths['/api/v1/admin/demand'].get.parameters).toEqual([]);
  });
});

describe('the demand against supply route in the observability inventory', () => {
  const { entries } = read('infra/observability/inventory.json');
  const named = (name: string) =>
    entries.find((e: { name: string }) => e.name === name);

  it('is an endpoint watched by the route metric, its panel and alerts', () => {
    expect(named('admin-demand-supply')).toMatchObject({
      alerts: ['api-error-rate', 'api-latency'],
      dashboard: 'motorfix-api',
      kind: 'endpoint',
      metric:
        'http.server.request.duration by http.route /api/v1/admin/demand/supply',
      source: 'libs/domain/src/insights/demand/demand.controller.ts',
    });
  });

  it('names the brand-area rows in the nightly demand step', () => {
    expect(named('insights').reason).toContain('brand_area');
  });
});
