import { previewCard } from './preview-card';
import type { BrandsSection, MarkedBrand } from '../brands-section';

const BMW = 'b-bmw';
const DACIA = 'b-dacia';
const TESLA = 'b-tesla';
const AUDI = 'b-audi';
const ORDER = [BMW, DACIA, TESLA];

const mark = (
  brandId: string,
  name: string,
  stance: MarkedBrand['stance'],
): MarkedBrand => ({ brandId, name, stance });

const card = (over: Partial<Parameters<typeof previewCard>[0]> = {}) =>
  previewCard({
    brands: { brands: [] },
    details: {},
    mechanics: {},
    order: ORDER,
    prices: undefined,
    ...over,
  });

describe('the preview card', () => {
  it('holds exactly the fields drivers would see', () => {
    expect(Object.keys(card()).sort()).toEqual(
      ['brands', 'mechanics', 'mobileKm', 'name', 'range', 'sample'].sort(),
    );
  });

  it('is empty for an empty draft', () => {
    expect(card()).toEqual({
      brands: null,
      mechanics: [],
      mobileKm: null,
      name: null,
      range: null,
      sample: null,
    });
  });

  it.each([
    ['  Service Ionescu  ', 'Service Ionescu'],
    ['   ', null],
    [undefined, null],
  ])('reads the name %j as %j', (name, expected) => {
    expect(card({ details: { name } }).name).toBe(expected);
  });

  it.each([
    [
      { fromBani: 15000, toBani: 25000 },
      { from: 150, to: 250 },
    ],
    [{ fromBani: 15000 }, { from: 150, to: null }],
    [{ toBani: 25000 }, { from: null, to: 250 }],
    [{}, null],
  ])('reads the labour range %j in whole lei', (labour, expected) => {
    expect(card({ prices: { labour } }).range).toEqual(expected);
  });

  it('has no range when the prices step was never opened', () => {
    expect(card({ prices: undefined }).range).toBeNull();
    expect(card({ prices: { jobs: [] } }).range).toBeNull();
  });

  it('lists the brands in the order the brands step shows them, unknown ones after in draft order', () => {
    const brands: BrandsSection = {
      brandNote: 'Doar diesel',
      brands: [
        mark(AUDI, 'Audi', 'works_on'),
        mark(DACIA, 'Dacia', 'works_on'),
        mark(TESLA, 'Tesla', 'does_not_take'),
        mark(BMW, 'BMW', 'works_on'),
      ],
    };

    expect(card({ brands }).brands).toEqual({
      brandNote: null,
      doesNotTake: [{ id: TESLA, name: 'Tesla' }],
      refusalPhrase: null,
      worksOn: [
        { id: BMW, name: 'BMW' },
        { id: DACIA, name: 'Dacia' },
        { id: AUDI, name: 'Audi' },
      ],
    });
  });

  it('keeps the first mark of a brand the draft repeats, and the first place of one the order repeats', () => {
    const brands: BrandsSection = {
      brands: [
        mark(TESLA, 'Tesla', 'works_on'),
        mark(BMW, 'BMW', 'works_on'),
        mark(TESLA, 'Tesla', 'does_not_take'),
      ],
    };

    const listed = card({ brands, order: [TESLA, BMW, TESLA] }).brands;
    expect(listed?.worksOn).toEqual([
      { id: TESLA, name: 'Tesla' },
      { id: BMW, name: 'BMW' },
    ]);
    expect(listed?.doesNotTake).toEqual([]);
  });

  it('takes the first taken brand in display order as the sample, even one marked later', () => {
    const brands: BrandsSection = {
      brands: [mark(DACIA, 'Dacia', 'works_on'), mark(BMW, 'BMW', 'works_on')],
    };

    expect(card({ brands }).sample).toEqual({ id: BMW, name: 'BMW' });
  });

  it('has no sample when brands are only refused', () => {
    const brands: BrandsSection = {
      brands: [mark(TESLA, 'Tesla', 'does_not_take')],
    };

    const result = card({ brands });
    expect(result.sample).toBeNull();
    expect(result.brands?.worksOn).toEqual([]);
    expect(result.brands?.doesNotTake).toEqual([{ id: TESLA, name: 'Tesla' }]);
  });

  it('keeps a trimmed specialist phrase, and counts it as something chosen', () => {
    expect(
      card({ brands: { brands: [], refusalPhrase: '  Doar germane  ' } })
        .brands,
    ).toEqual({
      brandNote: null,
      doesNotTake: [],
      refusalPhrase: 'Doar germane',
      worksOn: [],
    });
    expect(
      card({ brands: { brands: [], refusalPhrase: '   ' } }).brands,
    ).toBeNull();
  });

  it('shows the mechanics with their initials only while the switch is on', () => {
    const mechanics = [
      { name: 'Mihai Dumitru', speciality: 'Electrică' },
      { name: '   ' },
      { name: '  Ana  ' },
      { name: 'Ion  Vasile   Pop' },
    ];

    expect(
      card({ mechanics: { mechanics, onProfile: true } }).mechanics,
    ).toEqual([
      { initials: 'MD', name: 'Mihai Dumitru' },
      { initials: 'A', name: 'Ana' },
      { initials: 'IP', name: 'Ion  Vasile   Pop' },
    ]);
    expect(
      card({ mechanics: { mechanics, onProfile: false } }).mechanics,
    ).toEqual([]);
    expect(card({ mechanics: { mechanics } }).mechanics).toEqual([]);
  });

  it.each([
    ['mobile', 20],
    ['company', null],
    ['pfa', null],
    [undefined, null],
  ] as const)('gives a %s garage a service radius of %j km', (kind, km) => {
    expect(card({ details: { businessKind: kind } }).mobileKm).toBe(km);
  });

  it('gives a mobile mechanic the radius typed on the place step', () => {
    const place = { radiusKm: 35 };
    expect(card({ details: { businessKind: 'mobile' }, place }).mobileKm).toBe(
      35,
    );
    expect(
      card({ details: { businessKind: 'company' }, place }).mobileKm,
    ).toBeNull();
  });

  it('never carries the phone, what the garage is known for, the brand note or a speciality', () => {
    const result = card({
      brands: {
        brandNote: 'NOTA-SECRETA',
        brands: [mark(BMW, 'BMW', 'works_on')],
      },
      details: {
        businessKind: 'mobile',
        knownFor: 'CUNOSCUT-PENTRU',
        name: 'Service',
        phone: '+40712345678',
      },
      mechanics: {
        mechanics: [{ name: 'Mihai', speciality: 'SPECIALITATE' }],
        onProfile: true,
      },
      place: {
        address: 'ADRESA-SEDIU',
        lat: 44.8565,
        lng: 24.8692,
        radiusKm: 35,
      },
    });

    const text = JSON.stringify(result);
    for (const secret of [
      '+40712345678',
      '0712345678',
      'CUNOSCUT-PENTRU',
      'NOTA-SECRETA',
      'SPECIALITATE',
      'ADRESA-SEDIU',
      '44.8565',
      '24.8692',
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});
