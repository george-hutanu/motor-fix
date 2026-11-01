import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The published contract the web client is generated from, and the
// observability entry the two routes ship with.
const root = join(__dirname, '../../../../..');
const read = (file: string) =>
  JSON.parse(readFileSync(join(root, file), 'utf8'));
const doc = read('apps/api/openapi.json');

// @traces 035-FR-009
describe('the 3D car models in the OpenAPI document', () => {
  it('publishes the answer and the file route, with their refusals', () => {
    const answer = doc.paths['/api/v1/car-models-3d'].get;
    const file = doc.paths['/api/v1/car-models-3d/files/{key}'].get;

    expect(Object.keys(answer.responses).sort()).toEqual(['200', '400', '404']);
    expect(file.operationId).toBe('getCarModel3dFile');
    expect(Object.keys(file.responses).sort()).toEqual(['200', '404', '503']);
  });

  it('takes a required brand and an optional car', () => {
    const names = doc.paths['/api/v1/car-models-3d'].get.parameters.map(
      (p: { name: string; required: boolean }) => [p.name, p.required],
    );
    expect(names).toEqual([
      ['brand', true],
      ['car', false],
    ]);
  });

  it('gives each system its code, names and job ids, and no position', () => {
    const system = doc.components.schemas.CarModel3dSystemDto;

    expect(Object.keys(system.properties).sort()).toEqual([
      'code',
      'jobTypeIds',
      'nameEn',
      'nameRo',
    ]);
  });
});

// @traces 035-FR-010
describe('the 3D car models in the observability inventory', () => {
  it('lists both routes on the API dashboard with its error and latency alerts', () => {
    const entry = read('infra/observability/inventory.json').entries.find(
      (e: { name: string }) => e.name === 'car-models-3d',
    );

    expect(entry).toMatchObject({
      alerts: ['api-error-rate', 'api-latency'],
      dashboard: 'motorfix-api',
      kind: 'endpoint',
    });
    expect(entry.metric).toContain('/api/v1/car-models-3d/files/:key');
    expect(entry.reason).toContain('3D files uploaded: <n> written');
  });
});
