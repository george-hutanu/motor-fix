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
