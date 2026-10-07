import {
  type DetailsSection,
  detailsComplete,
  isDetailsSection,
  isMechanicsSection,
  isPricesSection,
  isRomanianPhone,
  type MechanicsSection,
  mechanicsComplete,
  type PricesSection,
  pricesComplete,
} from './listing-sections';
import { leiToBani as lei } from './price-range';

const JOB = '0b9f3c1e-6a43-4c55-9d1c-6f3f1b7d2a10';
const BRAND = '6d3b3a0e-2f8e-4b1f-8c2a-1d4e5f6a7b8c';

const details: DetailsSection = {
  businessKind: 'company',
  knownFor: 'Frâne și distribuție la mărci germane',
  name: 'Service Popescu',
  phone: '0722 123 456',
};

const prices: PricesSection = {
  jobs: [
    { fromBani: lei(150), jobTypeId: JOB, toBani: lei(300) },
    { brandId: BRAND, fromBani: lei(250), jobTypeId: JOB, toBani: lei(450) },
    { fromBani: lei(400), name: 'Schimb ambreiaj', toBani: lei(900) },
  ],
  labour: { fromBani: lei(120), toBani: lei(200) },
};

const mechanics: MechanicsSection = {
  mechanics: [{ name: 'Ion Marin', speciality: 'Diagnoză' }, { name: 'Ana' }],
  onProfile: false,
};

const entries = (count: number, brandId?: string) =>
  Array.from({ length: count }, () => ({
    ...(brandId ? { brandId } : {}),
    fromBani: lei(100),
    jobTypeId: JOB,
  }));

describe('the details section', () => {
  it('accepts the section as typed, and an empty one', () => {
    expect(isDetailsSection(details)).toBe(true);
    expect(isDetailsSection({})).toBe(true);
    expect(
      isDetailsSection({ businessKind: 'mobile', mobileLegalForm: 'pfa' }),
    ).toBe(true);
  });

  it.each([
    ['an unknown key', { ...details, email: 'a@b.ro' }],
    ['a number for the name', { name: 42 }],
    ['a string over 160 code units', { knownFor: 'x'.repeat(161) }],
    ['an unknown kind of business', { businessKind: 'srl' }],
    ['an unknown legal form', { mobileLegalForm: 'ii' }],
    ['an array', []],
    ['null', null],
  ])('refuses %s', (_, value) => {
    expect(isDetailsSection(value)).toBe(false);
  });

  it('is complete with a name, a Romanian phone, what it is known for and a kind', () => {
    expect(detailsComplete(details)).toBe(true);
  });

  it.each([
    ['a one-letter trimmed name', { ...details, name: '  A  ' }],
    ['a name over 80 characters', { ...details, name: 'x'.repeat(81) }],
    ['a foreign phone', { ...details, phone: '+44 20 7946 0958' }],
    ['a short phone', { ...details, phone: '0722 123' }],
    ['a blank known-for', { ...details, knownFor: '   ' }],
    ['no kind of business', { ...details, businessKind: undefined }],
    [
      'a mobile service with no legal form',
      { ...details, businessKind: 'mobile' as const },
    ],
  ])('is not complete with %s', (_, value) => {
    expect(detailsComplete(value)).toBe(false);
  });

  it('wants the legal form only for a mobile service', () => {
    expect(
      detailsComplete({
        ...details,
        businessKind: 'mobile',
        mobileLegalForm: 'company',
      }),
    ).toBe(true);
    expect(detailsComplete({ ...details, mobileLegalForm: 'pfa' })).toBe(false);
  });

  it('reads a phone as Romanian only as +40 and nine digits', () => {
    expect(isRomanianPhone('+40722123456')).toBe(true);
    expect(isRomanianPhone('+4072212345')).toBe(false);
    expect(isRomanianPhone('+33612345678')).toBe(false);
  });
});

describe('the prices section', () => {
  it('accepts the section and an empty one', () => {
    expect(isPricesSection(prices)).toBe(true);
    expect(isPricesSection({})).toBe(true);
    expect(isPricesSection({ jobs: [{ jobTypeId: JOB }], labour: {} })).toBe(
      true,
    );
  });

  it('holds 50 entries without a brand and any number of brand ranges up to 500', () => {
    expect(isPricesSection({ jobs: entries(50) })).toBe(true);
    expect(isPricesSection({ jobs: entries(51) })).toBe(false);
    expect(
      isPricesSection({ jobs: [...entries(50), ...entries(450, BRAND)] }),
    ).toBe(true);
    expect(
      isPricesSection({ jobs: [...entries(50), ...entries(451, BRAND)] }),
    ).toBe(false);
  });

  it.each([
    ['an unknown key', { ...prices, notes: '' }],
    ['a fraction of a ban', { labour: { fromBani: 100.5 } }],
    ['a string price', { labour: { fromBani: '100' } }],
    ['an unknown labour key', { labour: { fromBani: 100, perHour: true } }],
    [
      'an entry with both a job and a name',
      { jobs: [{ jobTypeId: JOB, name: 'Ambreiaj' }] },
    ],
    ['an entry with neither', { jobs: [{ fromBani: 100 }] }],
    ['a name over 80 characters', { jobs: [{ name: 'x'.repeat(81) }] }],
    ['a job that is not an id', { jobs: [{ jobTypeId: 'oil-service' }] }],
    [
      'an unknown entry key',
      { jobs: [{ durationMinutes: 60, jobTypeId: JOB }] },
    ],
    ['jobs that are not a list', { jobs: {} }],
  ])('refuses %s', (_, value) => {
    expect(isPricesSection(value)).toBe(false);
  });

  it('is complete with labour and every entry priced, one without a brand', () => {
    expect(pricesComplete(prices)).toBe(true);
  });

  it('lets a wide range through', () => {
    expect(
      pricesComplete({
        ...prices,
        labour: { fromBani: lei(100), toBani: lei(900) },
      }),
    ).toBe(true);
  });

  it.each([
    ['no labour top', { ...prices, labour: { fromBani: lei(120) } }],
    [
      'a labour top below its start',
      { ...prices, labour: { fromBani: lei(200), toBani: lei(100) } },
    ],
    ['no jobs', { ...prices, jobs: [] }],
    ['only brand ranges', { ...prices, jobs: [prices.jobs?.[1] ?? {}] }],
    [
      'an entry with no top',
      { ...prices, jobs: [{ fromBani: lei(100), jobTypeId: JOB }] },
    ],
    [
      'an entry under 1 leu',
      { ...prices, jobs: [{ fromBani: 50, jobTypeId: JOB, toBani: lei(10) }] },
    ],
    [
      'a proposed name of one letter',
      { ...prices, jobs: [{ fromBani: lei(1), name: ' A ', toBani: lei(2) }] },
    ],
  ])('is not complete with %s', (_, value) => {
    expect(pricesComplete(value)).toBe(false);
  });
});

describe('the mechanics section', () => {
  it('accepts the section, an empty list and an empty section', () => {
    expect(isMechanicsSection(mechanics)).toBe(true);
    expect(isMechanicsSection({ mechanics: [], onProfile: true })).toBe(true);
    expect(isMechanicsSection({})).toBe(true);
  });

  it('holds at most 30 mechanics', () => {
    const rows = (count: number) =>
      Array.from({ length: count }, () => ({ name: 'Ion' }));
    expect(isMechanicsSection({ mechanics: rows(30) })).toBe(true);
    expect(isMechanicsSection({ mechanics: rows(31) })).toBe(false);
  });

  it.each([
    ['a name over 60', { mechanics: [{ name: 'x'.repeat(61) }] }],
    [
      'a speciality over 80',
      { mechanics: [{ name: 'Ion', speciality: 'x'.repeat(81) }] },
    ],
    ['a row without a name', { mechanics: [{ speciality: 'Diagnoză' }] }],
    ['a switch that is not a boolean', { onProfile: 'yes' }],
    ['an unknown key', { mechanics: [], visible: true }],
    ['an unknown row key', { mechanics: [{ name: 'Ion', phone: '0722' }] }],
  ])('refuses %s', (_, value) => {
    expect(isMechanicsSection(value)).toBe(false);
  });

  it('is complete when every name has two letters, and with no mechanics', () => {
    expect(mechanicsComplete(mechanics)).toBe(true);
    expect(mechanicsComplete({ mechanics: [], onProfile: false })).toBe(true);
    expect(mechanicsComplete({})).toBe(true);
    expect(mechanicsComplete({ mechanics: [{ name: ' I ' }] })).toBe(false);
  });
});
