import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The published contract the web client is generated from: the save's body
// is an undo's `savedAt` only, so a plain save sends none.
const doc = JSON.parse(
  readFileSync(join(__dirname, '../../../../../apps/api/openapi.json'), 'utf8'),
);

// @traces 290-FR-002
describe('the save in the OpenAPI document', () => {
  it('takes an optional body', () => {
    const put = doc.paths['/api/v1/me/saved-garages/{garageId}'].put;

    expect(put.requestBody.required).toBe(false);
  });
});

// @traces 291-FR-001
describe('the saved list in the OpenAPI document', () => {
  const get = doc.paths['/api/v1/me/saved-garages'].get;

  it('answers a page and documents its refusals', () => {
    expect(Object.keys(get.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
    ]);
    expect(
      get.responses['200'].content['application/json'].schema.$ref,
    ).toMatch(/SavedGaragesPageDto$/);
  });

  it('takes an optional place and cursor', () => {
    const names = get.parameters.map(
      (p: { name: string; required: boolean }) => [p.name, p.required],
    );
    expect(names).toEqual(
      expect.arrayContaining([
        ['near', false],
        ['cursor', false],
      ]),
    );
  });
});
