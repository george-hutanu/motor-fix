import {
  type DetailsSection,
  detailsComplete,
  isDetailsSection,
  isMechanicsSection,
  isPricesSection,
  mechanicsComplete,
  type PricesSection,
  pricesComplete,
} from './listing-sections';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const good: DetailsSection = {
  businessKind: 'company',
  knownFor: 'Frâne',
  name: 'Service Popescu',
  phone: '0722 123 456',
};

const range = { fromBani: 10_000, toBani: 20_000 };

describe('isDetailsSection under hostile input', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'name'],
    ['a number', 7],
    ['an array', []],
    ['an array holding a section', [good]],
  ])('refuses %s', (_, value) => {
    expect(isDetailsSection(value)).toBe(false);
  });

  it('takes the empty section and a full one', () => {
    expect(isDetailsSection({})).toBe(true);
    expect(isDetailsSection({ ...good, mobileLegalForm: undefined })).toBe(
      true,
    );
  });

  it.each([
    ['null name', { name: null }],
    ['numeric name', { name: 7 }],
    ['numeric phone', { phone: 722123456 }],
    ['array knownFor', { knownFor: ['a'] }],
    ['null business kind', { businessKind: null }],
    ['unknown business kind', { businessKind: 'llc' }],
    ['upper-case business kind', { businessKind: 'PFA' }],
    ['legal form of ii', { mobileLegalForm: 'ii' }],
    ['legal form of mobile', { mobileLegalForm: 'mobile' }],
    ['an extra key', { email: 'a@b.ro' }],
    ['a prototype key', JSON.parse('{"__proto__":{"name":"x"}}')],
  ])('refuses %s', (_, extra) => {
    expect(isDetailsSection({ ...good, ...extra })).toBe(false);
  });

  it('allows a text of exactly 160 code units and refuses 161, in every text key', () => {
    for (const key of ['name', 'phone', 'knownFor'] as const) {
      expect(isDetailsSection({ [key]: 'a'.repeat(160) })).toBe(true);
      expect(isDetailsSection({ [key]: 'a'.repeat(161) })).toBe(false);
    }
  });

  it('counts UTF-16 code units, so 81 astral characters are over the bound', () => {
    expect(isDetailsSection({ name: '😀'.repeat(80) })).toBe(true);
    expect(isDetailsSection({ name: '😀'.repeat(81) })).toBe(false);
  });
});

describe('detailsComplete at the edges', () => {
  it('is complete for a good company', () => {
    expect(detailsComplete(good)).toBe(true);
  });

  it('is incomplete for the empty section', () => {
    expect(detailsComplete({})).toBe(false);
  });

  it.each([
    ['one character', 'a', false],
    ['one character padded with spaces', '   a   ', false],
    ['two characters', 'ab', true],
    ['two characters padded', '  ab  ', true],
    ['spaces only', '      ', false],
    ['80 characters', 'a'.repeat(80), true],
    ['80 characters padded', ` ${'a'.repeat(80)} `, true],
    ['81 characters', 'a'.repeat(81), false],
    ['81 characters with padding that trims to 80', ` ${'a'.repeat(80)}`, true],
  ])('judges a garage name of %s after trimming', (_, name, expected) => {
    expect(detailsComplete({ ...good, name })).toBe(expected);
  });

  it.each([
    ['empty', '', false],
    ['spaces only', '   ', false],
    ['one character', 'x', true],
    ['160 characters', 'x'.repeat(160), true],
    ['161 characters', 'x'.repeat(161), false],
    ['160 characters padded', `  ${'x'.repeat(160)}  `, true],
  ])('judges a "best at" line that is %s', (_, knownFor, expected) => {
    expect(detailsComplete({ ...good, knownFor })).toBe(expected);
  });

  it.each([
    ['0722123456', true],
    ['0722 123 456', true],
    ['+40 722 123 456', true],
    ['0040722123456', true],
    ['  0722123456  ', true],
    ['', false],
    ['   ', false],
    ['072212345', false],
    ['07221234567', false],
    ['+4072212345', false],
    ['+407221234567', false],
    ['+44 7911 123456', false],
    ['+49 30 123456', false],
    ['0722abc456', false],
    ['٠٧٢٢١٢٣٤٥٦', false],
    ['+40 ٧٢٢ ١٢٣ ٤٥٦', false],
    ['0722-123-456; DROP TABLE', false],
  ])('judges the phone %j', (phone, expected) => {
    expect(detailsComplete({ ...good, phone })).toBe(expected);
  });

  it('needs a business kind', () => {
    const { businessKind: _, ...without } = good;
    expect(detailsComplete(without)).toBe(false);
  });

  it('needs a legal form for a mobile mechanic', () => {
    expect(detailsComplete({ ...good, businessKind: 'mobile' })).toBe(false);
    expect(
      detailsComplete({
        ...good,
        businessKind: 'mobile',
        mobileLegalForm: 'pfa',
      }),
    ).toBe(true);
    expect(
      detailsComplete({
        ...good,
        businessKind: 'mobile',
        mobileLegalForm: 'company',
      }),
    ).toBe(true);
  });

  it.each(['company', 'pfa', 'ii'] as const)(
    'is incomplete for %s when a stale legal form is still set',
    (businessKind) => {
      expect(
        detailsComplete({ ...good, businessKind, mobileLegalForm: 'pfa' }),
      ).toBe(false);
    },
  );
});

describe('isPricesSection under hostile input', () => {
  const entry = { fromBani: 10_000, jobTypeId: id(1), toBani: 20_000 };

  it.each([null, undefined, 'x', 3, [], [entry]])('refuses %j', (value) => {
    expect(isPricesSection(value)).toBe(false);
  });

  it('takes the empty section, an empty list and a section with no labour', () => {
    expect(isPricesSection({})).toBe(true);
    expect(isPricesSection({ jobs: [] })).toBe(true);
    expect(isPricesSection({ jobs: [entry] })).toBe(true);
    expect(isPricesSection({ labour: {} })).toBe(true);
  });

  it.each([
    ['an extra key on the section', { extra: 1 }],
    ['jobs as an object', { jobs: {} }],
    ['jobs as null', { jobs: null }],
    ['labour as null', { labour: null }],
    ['labour as an array', { labour: [] }],
    ['an extra key on labour', { labour: { fromBani: 1, name: 'x' } }],
    ['a labour end as a string', { labour: { fromBani: '100' } }],
    ['a labour end as null', { labour: { toBani: null } }],
    ['a labour end as NaN', { labour: { fromBani: Number.NaN } }],
    [
      'a labour end as Infinity',
      { labour: { toBani: Number.POSITIVE_INFINITY } },
    ],
    ['a fractional labour end', { labour: { fromBani: 100.5 } }],
  ])('refuses %s', (_, section) => {
    expect(isPricesSection(section)).toBe(false);
  });

  it.each([
    ['holding both an id and a name', { ...entry, name: 'Frâne' }],
    ['holding neither an id nor a name', { fromBani: 100 }],
    ['an id that is not a uuid', { ...entry, jobTypeId: 'front-brakes' }],
    ['an empty id', { ...entry, jobTypeId: '' }],
    ['a null id with a name', { jobTypeId: null, name: 'x' }],
    ['a name of 81 characters', { fromBani: 100, name: 'n'.repeat(81) }],
    ['a name that is a number', { fromBani: 100, name: 12 }],
    ['a brand id that is not a uuid', { ...entry, brandId: 'dacia' }],
    ['an empty brand id', { ...entry, brandId: '' }],
    ['a null brand id', { ...entry, brandId: null }],
    ['a fractional end', { ...entry, fromBani: 100.5 }],
    ['a string end', { ...entry, toBani: '200' }],
    ['a null end', { ...entry, toBani: null }],
    ['a duration', { ...entry, durationMinutes: 30 }],
    ['a visible flag', { ...entry, visible: true }],
    ['an entry that is a string', 'x'],
    ['an entry that is null', null],
  ])('refuses an entry %s', (_, bad) => {
    expect(isPricesSection({ jobs: [bad] })).toBe(false);
  });

  it('refuses a good list with one bad entry in the middle', () => {
    expect(isPricesSection({ jobs: [entry, { fromBani: 1 }, entry] })).toBe(
      false,
    );
  });

  it('takes a name of exactly 80 characters', () => {
    expect(
      isPricesSection({ jobs: [{ fromBani: 100, name: 'n'.repeat(80) }] }),
    ).toBe(true);
  });

  it('takes upper-case uuids', () => {
    expect(
      isPricesSection({ jobs: [{ jobTypeId: id(1).replace(/0/g, 'A') }] }),
    ).toBe(true);
  });

  it('takes 50 entries without a brand and refuses 51', () => {
    const jobs = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ jobTypeId: id(i + 1) }));
    expect(isPricesSection({ jobs: jobs(50) })).toBe(true);
    expect(isPricesSection({ jobs: jobs(51) })).toBe(false);
  });

  it('takes 500 entries in all and refuses 501', () => {
    const defaults = Array.from({ length: 50 }, (_, i) => ({
      jobTypeId: id(i + 1),
    }));
    const brands = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        brandId: id(1000 + i),
        jobTypeId: id(1),
      }));
    expect(isPricesSection({ jobs: [...defaults, ...brands(450)] })).toBe(true);
    expect(isPricesSection({ jobs: [...defaults, ...brands(451)] })).toBe(
      false,
    );
  });

  it('does not count brand ranges toward the 50', () => {
    const jobs = [
      ...Array.from({ length: 50 }, (_, i) => ({ jobTypeId: id(i + 1) })),
      { brandId: id(900), jobTypeId: id(1) },
    ];
    expect(isPricesSection({ jobs })).toBe(true);
  });

  it('judges ten thousand entries without accepting them', () => {
    const jobs = Array.from({ length: 10_000 }, (_, i) => ({
      brandId: id(i + 1),
      jobTypeId: id(1),
    }));
    expect(isPricesSection({ jobs })).toBe(false);
  });
});

describe('pricesComplete at the edges', () => {
  const full: PricesSection = {
    jobs: [{ jobTypeId: id(1), ...range }],
    labour: range,
  };

  it('is complete for a labour range and one valid job', () => {
    expect(pricesComplete(full)).toBe(true);
  });

  it.each([
    ['the empty section', {}],
    ['no job list', { labour: range }],
    ['an empty job list', { jobs: [], labour: range }],
    ['no labour', { jobs: full.jobs }],
    ['an empty labour', { jobs: full.jobs, labour: {} }],
    [
      'a labour without a top',
      { jobs: full.jobs, labour: { fromBani: 10_000 } },
    ],
    [
      'a labour without a start',
      { jobs: full.jobs, labour: { toBani: 10_000 } },
    ],
    [
      'a labour top below its start',
      { jobs: full.jobs, labour: { fromBani: 20_000, toBani: 10_000 } },
    ],
    [
      'a labour start of 99 bani',
      { jobs: full.jobs, labour: { fromBani: 99, toBani: 20_000 } },
    ],
    [
      'a labour top past the maximum',
      { jobs: full.jobs, labour: { fromBani: 100, toBani: 10_000_001 } },
    ],
    [
      'a labour end as a huge integer',
      { jobs: full.jobs, labour: { fromBani: 100, toBani: 1e21 } },
    ],
    [
      'a job row with no range',
      { jobs: [{ jobTypeId: id(1) }], labour: range },
    ],
    [
      'a job row with only a start',
      { jobs: [{ fromBani: 100, jobTypeId: id(1) }], labour: range },
    ],
    [
      'a good row and a bad row',
      {
        jobs: [
          { jobTypeId: id(1), ...range },
          { fromBani: 500, jobTypeId: id(2), toBani: 100 },
        ],
        labour: range,
      },
    ],
    [
      'brand ranges and no job row',
      { jobs: [{ brandId: id(9), jobTypeId: id(1), ...range }], labour: range },
    ],
    [
      'a proposed job named with one character',
      { jobs: [{ name: ' a ', ...range }], labour: range },
    ],
    [
      'a proposed job named with spaces',
      { jobs: [{ name: '     ', ...range }], labour: range },
    ],
    [
      'a proposed job named past 80 characters',
      { jobs: [{ name: 'n'.repeat(81), ...range }], labour: range },
    ],
  ] as [string, PricesSection][])('is incomplete for %s', (_, section) => {
    expect(pricesComplete(section)).toBe(false);
  });

  it.each([
    ['a start of exactly 1 leu', { fromBani: 100, toBani: 100 }],
    ['a top equal to the start', { fromBani: 5_000, toBani: 5_000 }],
    ['a top of exactly the maximum', { fromBani: 100, toBani: 10_000_000 }],
    [
      'a start and top of exactly the maximum',
      { fromBani: 10_000_000, toBani: 10_000_000 },
    ],
  ])('is complete for %s on labour and on a job', (_, ends) => {
    expect(
      pricesComplete({ jobs: [{ jobTypeId: id(1), ...ends }], labour: ends }),
    ).toBe(true);
  });

  it('stays complete for a very wide range, which is only a warning', () => {
    const wide = { fromBani: 100, toBani: 9_000_000 };
    expect(
      pricesComplete({ jobs: [{ jobTypeId: id(1), ...wide }], labour: wide }),
    ).toBe(true);
  });

  it('is complete with a proposed job named by two characters padded', () => {
    expect(
      pricesComplete({ jobs: [{ name: ' ab ', ...range }], labour: range }),
    ).toBe(true);
  });

  it('is complete with a job row, its brand range and a proposed job', () => {
    expect(
      pricesComplete({
        jobs: [
          { jobTypeId: id(1), ...range },
          { brandId: id(9), jobTypeId: id(1), ...range },
          { name: 'Spălare motor', ...range },
        ],
        labour: range,
      }),
    ).toBe(true);
  });

  it('is incomplete when a brand range has an empty range even if its job is filled', () => {
    expect(
      pricesComplete({
        jobs: [
          { jobTypeId: id(1), ...range },
          { brandId: id(9), jobTypeId: id(1) },
        ],
        labour: range,
      }),
    ).toBe(false);
  });
});

describe('isMechanicsSection under hostile input', () => {
  it.each([null, undefined, 'x', 3, [], [{ name: 'Ion' }]])(
    'refuses %j',
    (value) => {
      expect(isMechanicsSection(value)).toBe(false);
    },
  );

  it('takes the empty section, an empty list and the switch alone', () => {
    expect(isMechanicsSection({})).toBe(true);
    expect(isMechanicsSection({ mechanics: [] })).toBe(true);
    expect(isMechanicsSection({ onProfile: false })).toBe(true);
  });

  it.each([
    ['a string switch', { onProfile: 'true' }],
    ['a numeric switch', { onProfile: 1 }],
    ['a null switch', { onProfile: null }],
    ['mechanics as an object', { mechanics: {} }],
    ['mechanics as null', { mechanics: null }],
    ['a card without a name', { mechanics: [{ speciality: 'x' }] }],
    ['a card with a null name', { mechanics: [{ name: null }] }],
    ['a card with a numeric name', { mechanics: [{ name: 5 }] }],
    [
      'a card with a null speciality',
      { mechanics: [{ name: 'Ion', speciality: null }] },
    ],
    [
      'a card with an extra key',
      { mechanics: [{ accountId: id(1), name: 'Ion' }] },
    ],
    [
      'a card with an on-profile key',
      { mechanics: [{ name: 'Ion', onProfile: true }] },
    ],
    ['a card that is a string', { mechanics: ['Ion'] }],
    ['a name of 61 characters', { mechanics: [{ name: 'n'.repeat(61) }] }],
    [
      'a speciality of 81 characters',
      { mechanics: [{ name: 'Ion', speciality: 's'.repeat(81) }] },
    ],
    ['an extra key on the section', { accountId: id(1), mechanics: [] }],
  ])('refuses %s', (_, section) => {
    expect(isMechanicsSection(section)).toBe(false);
  });

  it('takes a name of exactly 60 and a speciality of exactly 80', () => {
    expect(
      isMechanicsSection({
        mechanics: [{ name: 'n'.repeat(60), speciality: 's'.repeat(80) }],
      }),
    ).toBe(true);
  });

  it('takes 30 cards and refuses 31', () => {
    const cards = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ name: `Mecanic ${i}` }));
    expect(isMechanicsSection({ mechanics: cards(30) })).toBe(true);
    expect(isMechanicsSection({ mechanics: cards(31) })).toBe(false);
  });
});

describe('mechanicsComplete at the edges', () => {
  it('is complete for nothing at all', () => {
    expect(mechanicsComplete({})).toBe(true);
    expect(mechanicsComplete({ mechanics: [] })).toBe(true);
    expect(mechanicsComplete({ onProfile: true })).toBe(true);
  });

  it.each([
    ['', false],
    [' ', false],
    ['a', false],
    [' a ', false],
    ['ab', true],
    [' ab ', true],
    ['\t\n', false],
    ['n'.repeat(60), true],
    [` ${'n'.repeat(60)} `, true],
    ['n'.repeat(61), false],
  ])('judges a mechanic named %j', (name, expected) => {
    expect(mechanicsComplete({ mechanics: [{ name }] })).toBe(expected);
  });

  it('is incomplete when any one card of several has a short name', () => {
    expect(
      mechanicsComplete({
        mechanics: [{ name: 'Ion Marin' }, { name: 'A' }, { name: 'Ana Pop' }],
      }),
    ).toBe(false);
  });

  it('does not judge the speciality', () => {
    expect(
      mechanicsComplete({ mechanics: [{ name: 'Ion', speciality: '' }] }),
    ).toBe(true);
  });
});
