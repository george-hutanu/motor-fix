import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The published contract the web client is generated from.
const doc = JSON.parse(
  readFileSync(
    join(__dirname, '../../../../../../apps/api/openapi.json'),
    'utf8',
  ),
);

// @traces 093-FR-007
describe('the due items in the OpenAPI document', () => {
  const get = doc.paths['/api/v1/cars/due-items']?.get;

  it('answers the due items and documents the refusals of the car list', () => {
    expect(get.operationId).toBe('CarsController_dueItems');
    expect(Object.keys(get.responses).sort()).toEqual(['200', '401', '404']);
    expect(
      get.responses['200'].content['application/json'].schema.$ref,
    ).toMatch(/DueItemsDto$/);
  });

  it('describes every field of a row and of the answer', () => {
    const { DueItemDto, DueItemsDto } = doc.components.schemas;

    expect([...DueItemDto.required].sort()).toEqual([
      'carId',
      'carName',
      'daysLeft',
      'dueKm',
      'dueOn',
      'kind',
      'kmLeft',
      'passed',
      'state',
    ]);
    expect(DueItemDto.properties.kind.enum).toEqual(['itp', 'oil']);
    expect(DueItemDto.properties.state.enum).toEqual([
      'red',
      'amber',
      'green',
      'grey',
    ]);
    expect([...DueItemsDto.required].sort()).toEqual([
      'carCount',
      'dueSoonCount',
      'items',
    ]);
    expect(DueItemsDto.properties.items.items.$ref).toMatch(/DueItemDto$/);
  });
});
