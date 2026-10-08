import {
  FUELS,
  fuelColumns,
  isBrandsSection,
  NOTE_MAX,
  PHRASE_MAX,
} from './marked-brands';

const DACIA = '6d3b3a0e-2f8e-4b1f-8c2a-1d4e5f6a7b8c';
const BMW = '0b9f3c1e-6a43-4c55-9d1c-6f3f1b7d2a10';

const taken = (extra: Record<string, unknown> = {}) => ({
  brandId: DACIA,
  name: 'Dacia',
  stance: 'works_on',
  ...extra,
});

describe('the step 2 section', () => {
  it('offers petrol, diesel, hybrid and electric', () => {
    expect(FUELS).toEqual(['petrol', 'diesel', 'hybrid', 'electric']);
  });

  it.each([
    ['an empty section', {}],
    ['no brand marked', { brands: [] }],
    ['a taken brand kept before fuels existed', { brands: [taken()] }],
    [
      'a taken brand with some fuels',
      { brands: [taken({ fuels: ['petrol', 'diesel'] })] },
    ],
    [
      'a taken brand with every fuel unticked',
      { brands: [taken({ fuels: [] })] },
    ],
    [
      'a refused brand beside a taken one',
      {
        brands: [
          taken(),
          { brandId: BMW, name: 'BMW', stance: 'does_not_take' },
        ],
      },
    ],
    [
      'the two texts at their longest',
      {
        brandNote: 'n'.repeat(NOTE_MAX),
        brands: [],
        refusalPhrase: 'p'.repeat(PHRASE_MAX),
      },
    ],
    [
      'texts counted in letters, not code units',
      { brandNote: 'ș'.repeat(NOTE_MAX), brands: [] },
    ],
  ])('accepts %s', (_, section) => {
    expect(isBrandsSection(section)).toBe(true);
  });

  it.each([
    ['a section that is not an object', ['Dacia']],
    ['nothing', null],
    ['brands that are not a list', { brands: 'Dacia' }],
    ['an unknown key', { brands: [], colour: 'blue' }],
    [
      'a brand without an id',
      { brands: [{ name: 'Dacia', stance: 'works_on' }] },
    ],
    [
      'a brand id that is not a uuid',
      { brands: [taken({ brandId: 'dacia' })] },
    ],
    [
      'a brand without a name',
      { brands: [{ brandId: DACIA, stance: 'works_on' }] },
    ],
    ['an unknown stance', { brands: [taken({ stance: 'maybe' })] }],
    [
      'a brand marked twice',
      { brands: [taken(), taken({ stance: 'does_not_take' })] },
    ],
    [
      'a brand marked twice, once in capitals',
      {
        brands: [
          taken(),
          taken({ brandId: DACIA.toUpperCase(), stance: 'does_not_take' }),
        ],
      },
    ],
    ['a brand with another key', { brands: [taken({ logo: 'x.png' })] }],
    ['an unknown fuel', { brands: [taken({ fuels: ['lpg'] })] }],
    ['a repeated fuel', { brands: [taken({ fuels: ['diesel', 'diesel'] })] }],
    ['fuels that are not a list', { brands: [taken({ fuels: 'diesel' })] }],
    [
      'fuels on a refused brand',
      { brands: [taken({ fuels: ['petrol'], stance: 'does_not_take' })] },
    ],
    [
      'a note one letter too long',
      { brandNote: 'n'.repeat(NOTE_MAX + 1), brands: [] },
    ],
    [
      'a refusal phrase one letter too long',
      { brands: [], refusalPhrase: 'p'.repeat(PHRASE_MAX + 1) },
    ],
    ['a note that is not text', { brandNote: 12, brands: [] }],
  ])('refuses %s', (_, section) => {
    expect(isBrandsSection(section)).toBe(false);
  });
});

describe("a taken brand's fuel columns", () => {
  it('ticks all four when the brand names no fuels', () => {
    expect(fuelColumns(undefined)).toEqual({
      diesel: true,
      electric: true,
      hybrid: true,
      petrol: true,
    });
  });

  it('unticks all four for an empty list', () => {
    expect(fuelColumns([])).toEqual({
      diesel: false,
      electric: false,
      hybrid: false,
      petrol: false,
    });
  });

  it('ticks only the fuels listed', () => {
    expect(fuelColumns(['petrol', 'hybrid'])).toEqual({
      diesel: false,
      electric: false,
      hybrid: true,
      petrol: true,
    });
  });
});
