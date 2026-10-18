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

// @traces 172-FR-006
describe("the owner's price list read's labour range in the OpenAPI document", () => {
  it('may carry the hourly labour range, as the public profile gives it', () => {
    const list = doc.components.schemas.PriceListDto;

    expect(ref(list.properties.labour.allOf[0])).toBe('PublicLabourDto');
    expect(list.required ?? []).not.toContain('labour');
  });
});

// @traces 173-FR-004
// @traces 173-FR-005
// @traces 173-FR-007
describe('the in-place range writes in the OpenAPI document', () => {
  it("changes a default row's range with its body, its answer and its refusals", () => {
    const patch =
      doc.paths['/api/v1/garages/{garageId}/prices/{priceId}'].patch;

    expect(patch.operationId).toBe('PriceListController_setRange');
    expect(ref(patch.requestBody.content['application/json'].schema)).toBe(
      'PriceRangeDto',
    );
    expect(ref(patch.responses['200'].content['application/json'].schema)).toBe(
      'PriceRangeSavedDto',
    );
    expect(Object.keys(patch.responses).sort()).toEqual(
      ['200', '400', '401', '403', '404', '409', '415', '422'].sort(),
    );
  });

  it('changes the labour range with its body, its answer and its refusals', () => {
    const patch = doc.paths['/api/v1/garages/{garageId}/labour'].patch;

    expect(ref(patch.requestBody.content['application/json'].schema)).toBe(
      'LabourRangeDto',
    );
    expect(ref(patch.responses['200'].content['application/json'].schema)).toBe(
      'LabourRangeSavedDto',
    );
    expect(Object.keys(patch.responses).sort()).toEqual(
      ['200', '400', '401', '403', '404', '415', '422'].sort(),
    );
  });

  it("gives each owner's item the default row's id and stamp, when it has one", () => {
    const item = doc.components.schemas.PriceListItemDto;

    expect(item.properties.priceId).toMatchObject({ format: 'uuid' });
    expect(item.properties.updatedAt).toMatchObject({ format: 'date-time' });
    expect(item.required).not.toContain('priceId');
    expect(item.required).not.toContain('updatedAt');
  });
});
