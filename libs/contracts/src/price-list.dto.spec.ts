import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PRICE_LIST_REASONS } from './price-list.dto';

const root = join(__dirname, '..', '..', '..');
const openapi = JSON.parse(
  readFileSync(join(root, 'apps', 'api', 'openapi.json'), 'utf8'),
);
const generatedRead = readFileSync(
  join(
    root,
    'libs/data-access/src/lib/fn/garages/price-list-controller-read.ts',
  ),
  'utf8',
);

// @traces 357-FR-010
describe('the price list read in the OpenAPI document', () => {
  it('answers a garage id with the price list schema', () => {
    const read = openapi.paths['/api/v1/garages/{garageId}/prices'].get;

    expect(read.operationId).toBe('PriceListController_read');
    expect(read.responses['200'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/PriceListDto',
    });
    expect(openapi.components.schemas.PriceListDto.properties.items).toEqual(
      expect.objectContaining({
        items: { $ref: '#/components/schemas/PriceListItemDto' },
      }),
    );
  });

  it('is carried by the generated client with the same path and type', () => {
    expect(generatedRead).toContain(
      "priceListControllerRead.PATH = '/api/v1/garages/{garageId}/prices'",
    );
    expect(generatedRead).toContain('StrictHttpResponse<PriceListDto>');
  });
});

// @traces 357-FR-012
describe('the reasons a job is hidden', () => {
  const vocabulary = [
    'no_top_price',
    'hidden_by_garage',
    'not_authorised',
    'awaiting_approval',
    'rejected',
  ];

  it('are exactly the codes the view labels', () => {
    expect([...PRICE_LIST_REASONS].sort()).toEqual([...vocabulary].sort());
  });

  it('reach the OpenAPI document as the same codes and no labels', () => {
    const reason =
      openapi.components.schemas.PriceListItemDto.properties.reason;

    expect(reason.enum).toEqual([...PRICE_LIST_REASONS]);
    const document = JSON.stringify(openapi);
    for (const label of [
      'fără preț maxim',
      'ascuns de tine',
      'nu e în autorizația RAR',
      'așteaptă aprobarea',
      'respins',
    ]) {
      expect(document).not.toContain(label);
    }
  });
});
