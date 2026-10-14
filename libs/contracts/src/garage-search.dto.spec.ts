import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { GarageSearchQueryDto } from './garage-search.dto';

const BRAND = '9f1c2a7b-0000-4000-8000-000000000000';

function errors(query: Record<string, unknown>) {
  return validateSync(plainToInstance(GarageSearchQueryDto, query), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).flatMap((error) => Object.values(error.constraints ?? {}));
}

// @traces 267-FR-004 267-FR-005 267-FR-006
describe('GarageSearchQueryDto', () => {
  it('takes a brand id alone', () => {
    expect(errors({ brandId: BRAND })).toEqual([]);
  });

  it('takes a brand id and a cursor of 200 characters', () => {
    expect(errors({ brandId: BRAND, cursor: 'a'.repeat(200) })).toEqual([]);
  });

  it('refuses a search without a brand', () => {
    expect(errors({})).toContain('brandId must be a UUID');
  });

  it('refuses a brand that is not a uuid', () => {
    expect(errors({ brandId: 'dacia' })).toContain('brandId must be a UUID');
  });

  it('refuses a cursor of 201 characters', () => {
    expect(errors({ brandId: BRAND, cursor: 'a'.repeat(201) })).toContain(
      'cursor must be shorter than or equal to 200 characters',
    );
  });

  it('refuses a parameter it does not know', () => {
    expect(errors({ brandId: BRAND, sort: 'rating' })).toContain(
      'property sort should not exist',
    );
  });
});

const ID = (n: number) =>
  `9f1c2a7b-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = (count: number) =>
  Array.from({ length: count }, (_, n) => ID(n + 1)).join(',');

// @traces 267-FR-004
describe('GarageSearchQueryDto naming the brand', () => {
  it('takes a brand by its slug alone', () => {
    expect(errors({ brand: 'bmw' })).toEqual([]);
    expect(errors({ brand: 'alfa-romeo' })).toEqual([]);
    expect(errors({ brand: 'a'.repeat(80) })).toEqual([]);
  });

  it.each(['BMW', 'alfa romeo', 'a'.repeat(81), '', 'bmw/1'])(
    'refuses the slug %p',
    (brand) => {
      expect(errors({ brand })).not.toEqual([]);
    },
  );

  it('refuses a slug and an id together', () => {
    expect(errors({ brand: 'bmw', brandId: BRAND })).not.toEqual([]);
  });

  it('refuses a repeated brand key', () => {
    expect(errors({ brand: ['bmw', 'dacia'] })).not.toEqual([]);
  });
});

// @traces 267-FR-005
describe('GarageSearchQueryDto radius', () => {
  it.each(['25', '50'])('takes a radius of %s km', (radius) => {
    expect(errors({ brand: 'bmw', radius })).toEqual([]);
  });

  it.each(['30', '0', '100', '25.5', 'far'])(
    'refuses a radius of %p',
    (radius) => {
      expect(errors({ brand: 'bmw', radius })).not.toEqual([]);
    },
  );

  it('reads the radius as a number', () => {
    expect(
      plainToInstance(GarageSearchQueryDto, { brand: 'bmw', radius: '50' }),
    ).toMatchObject({ radius: 50 });
  });
});

// @traces 267-FR-006
describe('GarageSearchQueryDto ids', () => {
  it('takes one id and twenty ids', () => {
    expect(errors({ brand: 'bmw', ids: ID(1) })).toEqual([]);
    expect(errors({ brand: 'bmw', ids: ids(20) })).toEqual([]);
  });

  it('refuses twenty-one ids', () => {
    expect(errors({ brand: 'bmw', ids: ids(21) })).not.toEqual([]);
  });

  it.each([
    ['a non-uuid', `${ID(1)},dacia`],
    ['a repeated id', `${ID(1)},${ID(1)}`],
    ['an empty entry', `${ID(1)},`],
    ['nothing', ''],
  ])('refuses %s', (_case, value) => {
    expect(errors({ brand: 'bmw', ids: value })).not.toEqual([]);
  });

  it('refuses a repeated ids key', () => {
    expect(errors({ brand: 'bmw', ids: [ID(1), ID(2)] })).not.toEqual([]);
  });
});

// @traces 267-FR-007
describe('GarageSearchQueryDto log', () => {
  it('takes log=1', () => {
    expect(errors({ brand: 'bmw', log: '1' })).toEqual([]);
  });

  it.each(['0', 'true', 'yes', ''])('refuses log=%p', (log) => {
    expect(errors({ brand: 'bmw', log })).not.toEqual([]);
  });
});
