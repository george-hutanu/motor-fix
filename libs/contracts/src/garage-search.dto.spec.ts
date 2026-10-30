import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  GaragePinsQueryDto,
  GarageSearchQueryDto,
  SimilarGaragesQueryDto,
} from './garage-search.dto';

const BRAND = '9f1c2a7b-0000-4000-8000-000000000000';

function errors(query: Record<string, unknown>) {
  return validateSync(plainToInstance(GarageSearchQueryDto, query), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).flatMap((error) => Object.values(error.constraints ?? {}));
}

// @traces 267-FR-004 267-FR-005 267-FR-006
// @traces 1356-FR-009
describe('GarageSearchQueryDto', () => {
  it('takes a brand id alone', () => {
    expect(errors({ brandId: BRAND })).toEqual([]);
  });

  it('takes a brand id and a cursor of 256 characters', () => {
    expect(errors({ brandId: BRAND, cursor: 'a'.repeat(256) })).toEqual([]);
  });

  it('refuses a search without a brand', () => {
    expect(errors({})).toContain('brandId must be a UUID');
  });

  it('refuses a brand that is not a uuid', () => {
    expect(errors({ brandId: 'dacia' })).toContain('brandId must be a UUID');
  });

  it('refuses a cursor of 257 characters', () => {
    expect(errors({ brandId: BRAND, cursor: 'a'.repeat(257) })).toContain(
      'cursor must be shorter than or equal to 256 characters',
    );
  });

  it('refuses a parameter it does not know', () => {
    expect(errors({ brandId: BRAND, order: 'rating' })).toContain(
      'property order should not exist',
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

const BBOX_MESSAGE =
  'bbox must be south,west,north,east inside Romania, at most 100 km wide';

// @traces 269-FR-005
describe.each([
  ['GarageSearchQueryDto', GarageSearchQueryDto],
  ['GaragePinsQueryDto', GaragePinsQueryDto],
] as const)('%s bbox', (_name, dto) => {
  const check = (query: Record<string, unknown>) =>
    validateSync(plainToInstance(dto, query), {
      forbidNonWhitelisted: true,
      whitelist: true,
    }).flatMap((error) => Object.values(error.constraints ?? {}));

  it('takes a box over Bucharest', () => {
    expect(check({ bbox: '44.35,26,44.5,26.25', brand: 'bmw' })).toEqual([]);
  });

  it('takes a box with a place and a radius', () => {
    expect(
      check({
        bbox: '44.35,26,44.5,26.25',
        brand: 'bmw',
        near: '44.437,26.117',
        radius: '50',
      }),
    ).toEqual([]);
  });

  it.each([
    ['not four numbers', '44.35,26,44.5'],
    ['a word', '44.35,26,44.5,east'],
    ['a latitude past the pole', '44.35,26,91,26.25'],
    ['a longitude past the antimeridian', '44.35,26,44.5,181'],
    ['south at north', '44.5,26,44.5,26.25'],
    ['south above north', '44.6,26,44.5,26.25'],
    ['west at east', '44.35,26.25,44.5,26.25'],
    ['west east of east', '44.35,26.3,44.5,26.25'],
    ['a corner in Bulgaria', '43.2,26,43.6,26.25'],
    ['a corner in Hungary', '46.1,19.9,46.3,20.4'],
    ['a box 110 km tall', '44.35,26,45.338,26.25'],
    ['a box 101 km wide on its southern edge', '44.35,26,44.5,27.271'],
  ])('refuses %s', (_case, bbox) => {
    expect(check({ bbox, brand: 'bmw' })).toContain(BBOX_MESSAGE);
  });

  it('takes a box 100 km wide on its southern edge', () => {
    expect(check({ bbox: '44.35,26,44.5,27.257', brand: 'bmw' })).toEqual([]);
  });

  it('refuses a repeated bbox key', () => {
    expect(
      check({
        bbox: ['44.35,26,44.5,26.25', '44.35,26,44.5,26.25'],
        brand: 'bmw',
      }),
    ).toContain(BBOX_MESSAGE);
  });
});

// @traces 269-FR-001
describe('GaragePinsQueryDto', () => {
  const check = (query: Record<string, unknown>) =>
    validateSync(plainToInstance(GaragePinsQueryDto, query), {
      forbidNonWhitelisted: true,
      whitelist: true,
    }).flatMap((error) => Object.values(error.constraints ?? {}));

  it('takes the brand and place a search takes', () => {
    expect(
      check({ brand: 'bmw', near: '44.437,26.117', radius: '25' }),
    ).toEqual([]);
  });

  it.each([
    ['ids', { ids: ID(1) }],
    ['log', { log: '1' }],
    ['cursor', { cursor: 'abc' }],
    ['sort', { sort: 'price' }],
  ])('refuses %s, which only a page of the list reads', (_case, extra) => {
    expect(check({ brand: 'bmw', ...extra })).not.toEqual([]);
  });

  it('refuses neither and both of brand and brandId', () => {
    expect(check({})).not.toEqual([]);
    expect(check({ brand: 'bmw', brandId: BRAND })).not.toEqual([]);
  });
});

// @traces 1261-FR-001
describe('the result filters', () => {
  const both = [
    ['the list', GarageSearchQueryDto],
    ['the pins', GaragePinsQueryDto],
  ] as const;
  const check = (
    dto: typeof GarageSearchQueryDto | typeof GaragePinsQueryDto,
    query: Record<string, unknown>,
  ) =>
    validateSync(plainToInstance(dto, query), {
      forbidNonWhitelisted: true,
      whitelist: true,
    }).flatMap((error) => Object.values(error.constraints ?? {}));

  describe.each(both)('on %s', (_route, dto) => {
    it.each(['150', '200', '250', '300'])('takes max_price %s', (value) => {
      expect(check(dto, { brand: 'bmw', max_price: value })).toEqual([]);
    });

    it('reads max_price as the number of lei', () => {
      expect(
        plainToInstance(dto, { brand: 'bmw', max_price: '250' }).max_price,
      ).toBe(250);
    });

    it.each(['3.5', '4.0', '4.5'])('takes min_rating %s', (value) => {
      expect(check(dto, { brand: 'bmw', min_rating: value })).toEqual([]);
    });

    it('takes card 1 and all three together', () => {
      expect(check(dto, { brand: 'bmw', card: '1' })).toEqual([]);
      expect(
        check(dto, {
          brand: 'bmw',
          card: '1',
          max_price: '200',
          min_rating: '4.0',
        }),
      ).toEqual([]);
    });

    it.each([
      '175',
      '200.0',
      '0200',
      '2e2',
      '0x96',
      ' 200',
      '',
      '-150',
      'null',
    ])('refuses max_price %j', (value) => {
      expect(check(dto, { brand: 'bmw', max_price: value })).not.toEqual([]);
    });

    it.each(['4', '4,0', '4.00', '3', '5.0', '0', '', 'true'])(
      'refuses min_rating %j',
      (value) => {
        expect(check(dto, { brand: 'bmw', min_rating: value })).not.toEqual([]);
      },
    );

    it.each(['0', 'true', 'yes', '', '01'])('refuses card %j', (value) => {
      expect(check(dto, { brand: 'bmw', card: value })).not.toEqual([]);
    });

    it.each(['max_price', 'min_rating', 'card'])(
      'refuses a null or a repeated %s',
      (key) => {
        const value = { card: '1', max_price: '200', min_rating: '4.0' }[key];
        expect(check(dto, { brand: 'bmw', [key]: null })).not.toEqual([]);
        expect(check(dto, { brand: 'bmw', [key]: [value, value] })).not.toEqual(
          [],
        );
      },
    );
  });
});

// @traces 1260-FR-001 1260-FR-011
describe.each([
  ['GarageSearchQueryDto', GarageSearchQueryDto],
  ['GaragePinsQueryDto', GaragePinsQueryDto],
] as const)('%s open now and open on Saturday', (_name, dto) => {
  const check = (query: Record<string, unknown>) =>
    validateSync(plainToInstance(dto, query), {
      forbidNonWhitelisted: true,
      whitelist: true,
    }).flatMap((error) => Object.values(error.constraints ?? {}));

  it('takes open_now=1, open_saturday=1 and both together', () => {
    expect(check({ brand: 'bmw', open_now: '1' })).toEqual([]);
    expect(check({ brand: 'bmw', open_saturday: '1' })).toEqual([]);
    expect(check({ brand: 'bmw', open_now: '1', open_saturday: '1' })).toEqual(
      [],
    );
  });

  it('takes a search with neither filter', () => {
    const query = plainToInstance(dto, { brand: 'bmw' });

    expect(check({ brand: 'bmw' })).toEqual([]);
    expect(query.open_now).toBeUndefined();
    expect(query.open_saturday).toBeUndefined();
  });

  it.each(['open_now', 'open_saturday'])(
    'refuses every value of %s other than 1, naming it',
    (name) => {
      for (const value of ['true', '0', 'yes', '', ' 1', '01']) {
        const found = check({ brand: 'bmw', [name]: value });
        expect(found).not.toEqual([]);
        expect(found.every((message) => message.startsWith(`${name} `))).toBe(
          true,
        );
      }
    },
  );

  it.each(['open_now', 'open_saturday'])(
    'refuses a repeated %s key, naming it',
    (name) => {
      const found = check({ brand: 'bmw', [name]: ['1', '1'] });
      expect(found).not.toEqual([]);
      expect(found.join()).toMatch(new RegExp(`^${name} `));
    },
  );
});

const NEAR = '44.437,26.117';

// @traces 328-FR-001
describe('GarageSearchQueryDto sort', () => {
  it.each(['rating', 'distance', 'price'])(
    'takes sort=%s with a place',
    (sort) => {
      expect(errors({ brand: 'bmw', near: NEAR, sort })).toEqual([]);
    },
  );

  it.each(['rating', 'price'])('takes sort=%s without a place', (sort) => {
    expect(errors({ brand: 'bmw', sort })).toEqual([]);
  });

  it('leaves the sort out when none is asked for', () => {
    const query = plainToInstance(GarageSearchQueryDto, { brand: 'bmw' });

    expect(query.sort).toBeUndefined();
  });

  it.each(['newest', 'RATING', '', 'rating,price'])(
    'refuses the sort %p, naming sort',
    (sort) => {
      expect(errors({ brand: 'bmw', near: NEAR, sort }).join()).toMatch(
        /^sort /,
      );
    },
  );

  it('refuses a repeated sort key', () => {
    expect(
      errors({ brand: 'bmw', near: NEAR, sort: ['price', 'rating'] }),
    ).not.toEqual([]);
  });

  it.each([
    ['no place', { brand: 'bmw' }],
    ['a box and no place', { bbox: '44.35,26,44.5,26.25', brand: 'bmw' }],
  ])('refuses sort=distance with %s, naming sort', (_, query) => {
    expect(errors({ ...query, sort: 'distance' }).join()).toMatch(/^sort /);
  });
});

function similarErrors(query: Record<string, unknown>) {
  return validateSync(plainToInstance(SimilarGaragesQueryDto, query), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).flatMap((error) => Object.values(error.constraints ?? {}));
}

// @traces 385-FR-012 385-FR-014
describe('SimilarGaragesQueryDto', () => {
  it('takes no brand, or a brand by its slug', () => {
    expect(similarErrors({})).toEqual([]);
    expect(similarErrors({ brand: 'bmw' })).toEqual([]);
    expect(similarErrors({ brand: 'alfa-romeo' })).toEqual([]);
  });

  it.each(['BMW', 'alfa romeo', 'a'.repeat(81), '', 'bmw/1'])(
    'refuses the slug %p',
    (brand) => {
      expect(similarErrors({ brand })).not.toEqual([]);
    },
  );

  it('refuses a repeated brand key', () => {
    expect(similarErrors({ brand: ['bmw', 'dacia'] })).not.toEqual([]);
  });

  it('refuses a parameter it does not know', () => {
    expect(similarErrors({ brandId: BRAND })).not.toEqual([]);
    expect(similarErrors({ near: '44.4,26.1' })).not.toEqual([]);
  });
});
