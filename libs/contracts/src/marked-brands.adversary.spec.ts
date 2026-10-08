import {
  fuelColumns,
  isBrandsSection,
  NOTE_MAX,
  PHRASE_MAX,
} from './marked-brands';

const ID = '3f2b8c1e-5a47-4d0b-9c1a-0d6f2e7a9b11';
const taken = (extra: Record<string, unknown> = {}) => ({
  brandId: ID,
  name: 'Dacia',
  stance: 'works_on',
  ...extra,
});

describe('brands section guard with fuels', () => {
  it('accepts a taken brand with no fuels key, an empty list and a full list', () => {
    expect(isBrandsSection({ brands: [taken()] })).toBe(true);
    expect(isBrandsSection({ brands: [taken({ fuels: [] })] })).toBe(true);
    expect(
      isBrandsSection({
        brands: [taken({ fuels: ['petrol', 'diesel', 'hybrid', 'electric'] })],
      }),
    ).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'petrol'],
    ['an object', { petrol: true }],
    ['a duplicate kind', ['petrol', 'petrol']],
    ['an unknown kind', ['lpg']],
    ['an upper-case kind', ['Petrol']],
    ['a padded kind', ['petrol ']],
    ['a number', [1]],
    ['a nested list', [['petrol']]],
    ['null inside', [null]],
  ])('refuses fuels given as %s', (_label, fuels) => {
    expect(isBrandsSection({ brands: [taken({ fuels })] })).toBe(false);
  });

  it('refuses fuels, even an empty list, on a refused brand', () => {
    const refused = { ...taken(), stance: 'does_not_take' };
    expect(isBrandsSection({ brands: [{ ...refused, fuels: [] }] })).toBe(
      false,
    );
    expect(
      isBrandsSection({ brands: [{ ...refused, fuels: ['petrol'] }] }),
    ).toBe(false);
    expect(isBrandsSection({ brands: [refused] })).toBe(true);
  });

  it('refuses fuels set to null on a taken brand', () => {
    expect(isBrandsSection({ brands: [taken({ fuels: null })] })).toBe(false);
  });

  it('refuses the same brand id twice, whatever the case', () => {
    expect(
      isBrandsSection({
        brands: [taken(), taken({ brandId: ID.toUpperCase() })],
      }),
    ).toBe(false);
  });

  it('refuses an extra key on a brand and on the section', () => {
    expect(isBrandsSection({ brands: [taken({ extra: 1 })] })).toBe(false);
    expect(isBrandsSection({ brands: [], extra: 1 })).toBe(false);
  });

  it.each([null, undefined, [], 'brands', 42])(
    'refuses %j as a section',
    (value) => {
      expect(isBrandsSection(value)).toBe(false);
    },
  );

  it('refuses brands that are not a list and a brand that is not an object', () => {
    expect(isBrandsSection({ brands: null })).toBe(false);
    expect(isBrandsSection({ brands: {} })).toBe(false);
    expect(isBrandsSection({ brands: [null] })).toBe(false);
    expect(isBrandsSection({ brands: ['x'] })).toBe(false);
  });

  it('refuses a brand id that is not a uuid', () => {
    expect(isBrandsSection({ brands: [taken({ brandId: 'dacia' })] })).toBe(
      false,
    );
    expect(isBrandsSection({ brands: [taken({ brandId: `${ID}\n` })] })).toBe(
      false,
    );
  });

  it('accepts the note and the phrase at their caps in code points and refuses one more', () => {
    const emoji = '\u{1F697}';
    expect(isBrandsSection({ brandNote: emoji.repeat(NOTE_MAX) })).toBe(true);
    expect(isBrandsSection({ brandNote: emoji.repeat(NOTE_MAX + 1) })).toBe(
      false,
    );
    expect(isBrandsSection({ refusalPhrase: 'a'.repeat(PHRASE_MAX) })).toBe(
      true,
    );
    expect(isBrandsSection({ refusalPhrase: 'a'.repeat(PHRASE_MAX + 1) })).toBe(
      false,
    );
  });

  it('refuses a note that is not a string', () => {
    expect(isBrandsSection({ brandNote: 5 })).toBe(false);
    expect(isBrandsSection({ brandNote: null })).toBe(false);
  });

  it('handles ten thousand brands without accepting a repeated id', () => {
    const many = Array.from({ length: 10_000 }, (_, i) =>
      taken({
        brandId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      }),
    );
    expect(isBrandsSection({ brands: many })).toBe(true);
    expect(isBrandsSection({ brands: [...many, many[0]] })).toBe(false);
  });
});

describe('fuel columns', () => {
  it('ticks all four when fuels is absent', () => {
    expect(fuelColumns()).toEqual({
      diesel: true,
      electric: true,
      hybrid: true,
      petrol: true,
    });
  });

  it('unticks all four for an empty list, which is not the same as absent', () => {
    expect(fuelColumns([])).toEqual({
      diesel: false,
      electric: false,
      hybrid: false,
      petrol: false,
    });
  });

  it('ticks only the listed kinds', () => {
    expect(fuelColumns(['electric'])).toEqual({
      diesel: false,
      electric: true,
      hybrid: false,
      petrol: false,
    });
  });

  it('keys the columns in petrol, diesel, hybrid, electric order whatever the input order', () => {
    expect(Object.keys(fuelColumns(['electric', 'petrol']))).toEqual([
      'petrol',
      'diesel',
      'hybrid',
      'electric',
    ]);
  });
});
