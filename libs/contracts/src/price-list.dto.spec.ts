import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  LabourRangeDto,
  PRICE_LIST_REASONS,
  type PriceListItemDto,
  PriceRangeDto,
} from './price-list.dto';

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

const strict = { forbidNonWhitelisted: true, whitelist: true };
const problemsOf = async (type: new () => object, plain: object) =>
  (await validate(plainToInstance(type, plain), strict)).map(
    (error) => error.property,
  );
const STAMP = '2026-10-18T08:00:00.000Z';

// @traces 173-FR-004
// @traces 173-FR-007
describe('the body of a default range write', () => {
  const body = {
    durationMinutes: 120,
    expectedUpdatedAt: STAMP,
    fromBani: 95_000,
    toBani: 145_000,
  };

  it('takes the three values and the stamp the owner read', async () => {
    expect(await problemsOf(PriceRangeDto, body)).toEqual([]);
  });

  it('takes null to clear the top and the duration', async () => {
    expect(
      await problemsOf(PriceRangeDto, {
        ...body,
        durationMinutes: null,
        toBani: null,
      }),
    ).toEqual([]);
  });

  it.each([
    ['not whole', { fromBani: 1.5, toBani: '2' }],
    ['negative', { durationMinutes: -15, fromBani: -1 }],
    ['missing', { fromBani: undefined, toBani: undefined }],
  ])('leaves values that are %s to the one range check', async (_, values) => {
    expect(await problemsOf(PriceRangeDto, { ...body, ...values })).toEqual([]);
  });

  it.each([
    ['a missing stamp', { expectedUpdatedAt: undefined }, 'expectedUpdatedAt'],
    ['a malformed stamp', { expectedUpdatedAt: 'ieri' }, 'expectedUpdatedAt'],
    ['an unknown field', { visible: false }, 'visible'],
  ])('refuses %s', async (_, values, property) => {
    expect(await problemsOf(PriceRangeDto, { ...body, ...values })).toEqual([
      property,
    ]);
  });
});

// @traces 173-FR-005
describe('the body of a labour range write', () => {
  it('takes both ends and leaves their values to the one range check', async () => {
    expect(
      await problemsOf(LabourRangeDto, { fromBani: 20_000, toBani: 26_000 }),
    ).toEqual([]);
    expect(
      await problemsOf(LabourRangeDto, { fromBani: -1, toBani: 2.5 }),
    ).toEqual([]);
  });

  it('refuses an unknown field', async () => {
    expect(
      await problemsOf(LabourRangeDto, {
        fromBani: 20_000,
        labourFromBani: 1,
        toBani: 26_000,
      }),
    ).toEqual(['labourFromBani']);
  });
});

// @traces 173-FR-007
describe("an owner's price list item", () => {
  it("may carry the default row's id and when it was last saved", async () => {
    const item = {
      brandRanges: [],
      jobTypeId: randomUUID(),
      nameEn: 'Front brakes',
      nameRo: 'Frâne față',
      priceId: randomUUID(),
      public: true,
      updatedAt: STAMP,
    } satisfies PriceListItemDto;

    expect(item.priceId).toBeDefined();
  });
});
