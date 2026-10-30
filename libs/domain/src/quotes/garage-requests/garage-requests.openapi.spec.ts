import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { QUOTE_OUTCOMES } from '@motor-fix/contracts';

// The published contract the web client is generated from.
const doc = JSON.parse(
  readFileSync(join(__dirname, '../../../../../apps/api/openapi.json'), 'utf8'),
);

// @traces 346-FR-002 346-FR-008
describe('a garage request row in the OpenAPI document', () => {
  const row = doc.components.schemas.GarageRequestSummaryDto;

  it('carries what became of the quote, one of the outcomes or null', () => {
    expect(row.properties.outcome).toMatchObject({
      enum: [...QUOTE_OUTCOMES],
      nullable: true,
      type: 'string',
    });
    expect(row.required).toContain('outcome');
  });
});
