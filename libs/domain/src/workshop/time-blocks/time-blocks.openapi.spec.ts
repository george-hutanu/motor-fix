import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The published contract the web client is generated from.
const doc = JSON.parse(
  readFileSync(join(__dirname, '../../../../../apps/api/openapi.json'), 'utf8'),
);

// @traces 1395-FR-001
// @traces 1395-FR-006
describe('what a block may take, in the OpenAPI document', () => {
  const get = doc.paths['/api/v1/garages/{garageId}/time-blocks/options']?.get;

  it('publishes the read under its own operation id', () => {
    expect(get?.operationId).toBe('timeBlockOptions');
    expect(
      get.responses['200'].content['application/json'].schema.$ref,
    ).toMatch(/TimeBlockOptionsDto$/);
  });

  it('documents every answer the read can give', () => {
    expect(Object.keys(get?.responses ?? {}).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
    ]);
  });

  it('holds the lift count and the mechanics, nothing else', () => {
    const dto = doc.components.schemas.TimeBlockOptionsDto;

    expect(Object.keys(dto?.properties ?? {}).sort()).toEqual([
      'liftCount',
      'mechanics',
    ]);
    expect(dto.required).toEqual(['liftCount', 'mechanics']);
    expect(dto.properties.liftCount.type).toBe('number');
    expect(dto.properties.mechanics.items.$ref).toMatch(/BookingMechanicDto$/);
  });
});
