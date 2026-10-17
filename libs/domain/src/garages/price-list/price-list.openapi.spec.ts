import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The published contract the web client is generated from.
const doc = JSON.parse(
  readFileSync(join(__dirname, '../../../../../apps/api/openapi.json'), 'utf8'),
);
const ref = (schema: { $ref: string }) => schema.$ref.split('/').pop();
const route =
  doc.paths['/api/v1/garages/{garageId}/prices/{jobTypeId}/brands/{brandId}'];

// @traces 386-FR-012
describe('the brand range writes in the OpenAPI document', () => {
  it('sets a range with its body, its answer and its refusals', () => {
    const { put } = route;

    expect(ref(put.requestBody.content['application/json'].schema)).toBe(
      'BrandRangeDto',
    );
    expect(ref(put.responses['200'].content['application/json'].schema)).toBe(
      'BrandRangeSavedDto',
    );
    expect(Object.keys(put.responses).sort()).toEqual(
      ['200', '400', '401', '403', '404', '415', '422'].sort(),
    );
  });

  it('removes a range with no body in its answer', () => {
    expect(Object.keys(route.delete.responses).sort()).toEqual(
      ['204', '400', '401', '403', '404'].sort(),
    );
  });

  it("lists each job's brand ranges on the owner's read", () => {
    const item = doc.components.schemas.PriceListItemDto;

    expect(item.required).toContain('brandRanges');
    expect(ref(item.properties.brandRanges.items)).toBe('BrandRangeItemDto');
  });
});
