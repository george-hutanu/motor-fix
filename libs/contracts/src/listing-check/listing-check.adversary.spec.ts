import { checkListing, stepOf } from './listing-check';
import type { ListingDraftData } from '../listing-sections';
import { leiToBani as lei } from '../price-range';

const BRAND = '6d3b3a0e-2f8e-4b1f-8c2a-1d4e5f6a7b8c';
const JOB = '0b9f3c1e-6a43-4c55-9d1c-6f3f1b7d2a10';
const PAGE = 'listing-documents/3f1b7d2a-6a43-4c55-9d1c-6f3f1b7d2a10/p1';
const PHOTO = 'garage-photos/3f1b7d2a-6a43-4c55-9d1c-6f3f1b7d2a10/p1';

type Steps = NonNullable<ListingDraftData['steps']>;

const complete = (): ListingDraftData => ({
  declaredAt: '2026-10-11T10:00:00.000Z',
  declaredByName: 'Ion Popescu',
  documents: {
    onrc_certificate: { pages: [PAGE] },
    rar_authorisation: { pages: [PAGE] },
  },
  files: [PHOTO],
  steps: {
    '1': {
      businessKind: 'company',
      knownFor: 'Frâne',
      name: 'Service Popescu',
      phone: '0722 123 456',
    },
    '2': { brands: [{ brandId: BRAND, name: 'Dacia', stance: 'works_on' }] },
    '3': {
      jobs: [{ fromBani: lei(150), jobTypeId: JOB, toBani: lei(300) }],
      labour: { fromBani: lei(120), toBani: lei(200) },
    },
    '4': {},
    '5': {
      payments: ['cash'],
      place: { address: 'Str. Lungă 1, Brașov', lat: 45.65, lng: 25.6 },
    },
    '6': { cui: '18547290', rarNumber: 'BV-123' },
  },
});

const withStep = <K extends keyof Steps>(
  key: K,
  section: Steps[K] | Record<string, unknown>,
  data: ListingDraftData = complete(),
): ListingDraftData =>
  ({
    ...data,
    steps: { ...data.steps, [key]: section },
  }) as ListingDraftData;

const step = (key: keyof Steps) =>
  complete().steps?.[key] as Record<string, unknown>;

const patched = (key: keyof Steps, patch: Record<string, unknown>) =>
  withStep(key, { ...step(key), ...patch });

const errorsOf = (data: unknown, email?: string) =>
  checkListing({
    data: data as ListingDraftData,
    ...(email !== undefined && { email }),
  }).errors;

const hostile = (data: unknown) => data as ListingDraftData;

const mobile = (place: Record<string, unknown>) =>
  withStep(
    '5',
    { ...step('5'), place },
    patched('1', { businessKind: 'mobile', mobileLegalForm: 'pfa' }),
  );

const SEAT = { address: 'Str. Lungă 1, Brașov', lat: 45.65, lng: 25.6 };

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
};

describe('hostile shapes', () => {
  // @traces 115-FR-001
  it.each([
    ['null steps', { steps: null }],
    [
      'null sections',
      {
        steps: {
          '1': null,
          '2': null,
          '3': null,
          '4': null,
          '5': null,
          '6': null,
        },
      },
    ],
    ['string sections', { steps: { '1': 'x', '3': 'y', '5': 'z' } }],
    [
      'null lists',
      {
        documents: null,
        files: null,
        steps: {
          '2': { brands: null },
          '3': { jobs: null },
          '4': { mechanics: null },
        },
      },
    ],
    [
      'null list entries',
      {
        files: [null],
        steps: {
          '2': { brands: [null] },
          '3': { jobs: [null] },
          '4': { mechanics: [null] },
        },
      },
    ],
    [
      'numbers as strings',
      {
        steps: {
          '1': { knownFor: {}, name: 5, phone: 722123456 },
          '6': { cui: 18547290, rarNumber: 12345 },
        },
      },
    ],
  ])('answers %s with a list of errors instead of throwing', (_, data) => {
    const result = checkListing({ data: hostile(data) });
    expect(Array.isArray(result.errors)).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.every((e) => typeof e.field === 'string')).toBe(true);
  });

  // @traces 115-FR-001
  it('does not change the data it judges and answers twice the same', () => {
    const data = deepFreeze(complete());
    const first = checkListing({ data, email: ' ana@service.ro ' });
    expect(checkListing({ data, email: ' ana@service.ro ' })).toEqual(first);
    expect(data).toEqual(complete());
  });

  // @traces 115-FR-001
  it('ignores extra fields on the draft', () => {
    const data = { ...complete(), surprise: { deep: [1] } };
    expect(errorsOf(data)).toEqual([]);
  });
});

describe('whitespace and unicode', () => {
  // @traces 115-FR-002
  it.each([
    ['cui', '   ', 'required', 'steps.6.cui'],
    ['cui', '\t\n', 'required', 'steps.6.cui'],
    ['rarNumber', '   ', 'required', 'steps.6.rarNumber'],
  ])('refuses step 6 %s %j with %s', (key, value, code, field) => {
    expect(errorsOf(patched('6', { [key]: value }))).toEqual([{ code, field }]);
  });

  // @traces 115-FR-002
  it('refuses a declared name of spaces', () => {
    expect(errorsOf({ ...complete(), declaredByName: '    ' })).toHaveLength(1);
    expect(errorsOf({ ...complete(), declaredByName: '    ' })[0].field).toBe(
      'declaration',
    );
  });

  // @traces 115-FR-002
  it('counts the name by characters after trimming, accents included', () => {
    expect(errorsOf(patched('1', { name: 'Ș'.repeat(80) }))).toEqual([]);
    expect(errorsOf(patched('1', { name: 'Ș'.repeat(81) }))).toEqual([
      { code: 'invalid', field: 'steps.1.name' },
    ]);
  });

  // @traces 115-FR-002
  it.each([
    ['fullwidth digits', '０７２２１２３４５６'],
    ['letters inside', '0722 12A 456'],
    ['a trailing null', '0722123456\u0000'],
    ['Arabic-Indic digits', '٠٧٢٢١٢٣٤٥٦'],
  ])('refuses a phone with %s', (_, phone) => {
    expect(errorsOf(patched('1', { phone }))).toEqual([
      { code: 'invalid', field: 'steps.1.phone' },
    ]);
  });

  // @traces 115-FR-002
  it('takes a Romanian phone in the three usual spellings', () => {
    for (const phone of ['0722123456', '+40722123456', '0040722123456'])
      expect(errorsOf(patched('1', { phone }))).toEqual([]);
  });

  // @traces 115-FR-002
  it('judges the e-mail at its 254 limit', () => {
    expect(errorsOf(complete(), `${'a'.repeat(249)}@x.ro`)).toEqual([]);
    expect(errorsOf(complete(), `${'a'.repeat(250)}@x.ro`)).toEqual([
      { code: 'invalid', field: 'email' },
    ]);
  });

  // @traces 115-FR-002
  it.each(['ana@@x.ro', 'ana @x.ro', '@x.ro'])(
    'refuses the e-mail %j',
    (email) => {
      expect(errorsOf(complete(), email)).toEqual([
        { code: 'invalid', field: 'email' },
      ]);
    },
  );
});

describe('unknown business kinds', () => {
  // @traces 115-FR-002
  it.each(['spaceship', '', 'MOBILE', ' mobile', null, 7])(
    'refuses the kind %j on its field',
    (kind) => {
      const fields = errorsOf(patched('1', { businessKind: kind })).map(
        (e) => e.field,
      );
      expect(fields).toContain('steps.1.businessKind');
    },
  );

  // @traces 115-FR-003
  it('does not treat a lookalike of mobile as mobile', () => {
    const data = withStep(
      '5',
      { ...step('5'), place: { ...SEAT, radiusKm: 9999 } },
      patched('1', { businessKind: 'Mobile' }),
    );
    expect(errorsOf(data).map((e) => e.field)).not.toContain(
      'steps.5.place.radiusKm',
    );
  });

  // @traces 115-FR-003
  it('refuses an unknown legal form for a mobile mechanic', () => {
    const data = patched('1', {
      businessKind: 'mobile',
      mobileLegalForm: 'sa',
    });
    expect(errorsOf(data).map((e) => e.field)).toContain(
      'steps.1.mobileLegalForm',
    );
  });
});

describe('mobile mechanic against workshop', () => {
  // @traces 115-FR-003
  it.each([
    0,
    -5,
    0.5,
    100.5,
    101,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])('refuses a mobile radius of %s', (radiusKm) => {
    expect(errorsOf(mobile({ ...SEAT, radiusKm }))).toEqual([
      { code: 'invalid', field: 'steps.5.place.radiusKm' },
    ]);
  });

  // @traces 115-FR-003
  it('takes a mobile radius of 50 and an absent radius', () => {
    expect(errorsOf(mobile({ ...SEAT, radiusKm: 50 }))).toEqual([]);
    expect(errorsOf(mobile({ ...SEAT }))).toEqual([]);
  });

  // @traces 115-FR-003
  it('refuses a radius typed as text for a mobile mechanic', () => {
    expect(
      errorsOf(mobile({ ...SEAT, radiusKm: '50' })).map((e) => e.field),
    ).toEqual(['steps.5.place.radiusKm']);
  });

  // @traces 115-FR-003
  it.each([0, -1, Number.NaN, 1e9])(
    'does not judge a radius of %s on a workshop',
    (radiusKm) => {
      expect(
        errorsOf(withStep('5', { ...step('5'), place: { ...SEAT, radiusKm } })),
      ).toEqual([]);
    },
  );

  // @traces 115-FR-003
  it('stops asking for the radius when the kind goes back to a workshop, keeping the seat', () => {
    const seat = { ...SEAT, radiusKm: 500 };
    const asMobile = withStep(
      '5',
      { ...step('5'), place: seat },
      patched('1', { businessKind: 'mobile', mobileLegalForm: 'pfa' }),
    );
    expect(errorsOf(asMobile).map((e) => e.field)).toEqual([
      'steps.5.place.radiusKm',
    ]);
    const back = withStep(
      '5',
      { ...step('5'), place: seat },
      patched('1', { businessKind: 'company', mobileLegalForm: 'pfa' }),
    );
    expect(errorsOf(back).map((e) => e.field)).not.toContain(
      'steps.5.place.radiusKm',
    );
  });
});

describe('places outside Romania', () => {
  const place = (lat: unknown, lng: unknown) =>
    withStep('5', { ...step('5'), place: { address: 'Undeva', lat, lng } });

  // @traces 115-FR-002
  it.each([
    ['null island', 0, 0],
    ['Bucharest latitude, Paris longitude', 44.4, 2.35],
    ['Romanian longitude, Sahara latitude', 20, 25],
    ['swapped lat and lng', 25.6, 45.65],
    ['past the poles', 91, 25],
    ['Infinity', Number.POSITIVE_INFINITY, 25],
    ['NaN', Number.NaN, Number.NaN],
  ])('refuses %s', (_, lat, lng) => {
    const fields = errorsOf(place(lat, lng)).map((e) => e.field);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toBe('steps.5.place.lat');
  });

  // @traces 115-FR-002
  it('refuses a position typed as text', () => {
    expect(errorsOf(place('45.65', '25.6')).map((e) => e.field)).toEqual([
      'steps.5.place.lat',
    ]);
  });

  // @traces 115-FR-002
  it('takes Constanța and Timișoara', () => {
    expect(errorsOf(place(44.18, 28.63))).toEqual([]);
    expect(errorsOf(place(45.75, 21.23))).toEqual([]);
  });
});

describe('odd numbers in prices', () => {
  const labour = (fromBani: unknown, toBani: unknown) =>
    patched('3', { labour: { fromBani, toBani } });

  // @traces 115-FR-002
  it.each([
    ['NaN bottom', Number.NaN, lei(200)],
    ['Infinity top', lei(100), Number.POSITIVE_INFINITY],
    ['negative bottom', -100, lei(200)],
    ['float bani', 12_345.5, lei(200)],
    ['zero bottom', 0, lei(200)],
    ['text prices', '12000', '20000'],
  ])('flags the labour range with %s', (_, from, to) => {
    const fields = errorsOf(labour(from, to)).map((e) => e.field);
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.every((f) => f.startsWith('steps.3.labour.'))).toBe(true);
  });

  // @traces 115-FR-002
  it('gives a float top the integer code', () => {
    expect(errorsOf(labour(lei(100), lei(200) + 0.5))).toEqual([
      { code: 'integer', field: 'steps.3.labour.to' },
    ]);
  });

  // @traces 115-FR-002
  it('takes a range from exactly 1 to exactly 100,000 lei and refuses one past it', () => {
    expect(errorsOf(labour(lei(1), lei(100_000)))).toEqual([]);
    expect(errorsOf(labour(lei(1), lei(100_000) + 1))).toEqual([
      { code: 'max', field: 'steps.3.labour.to' },
    ]);
  });

  // @traces 115-FR-002
  it('names the job row for a NaN or negative price', () => {
    const data = patched('3', {
      jobs: [
        { fromBani: lei(100), jobTypeId: JOB, toBani: lei(200) },
        { fromBani: Number.NaN, jobTypeId: JOB, toBani: lei(200) },
        { fromBani: lei(100), name: 'Schimb', toBani: -5 },
      ],
    });
    const fields = errorsOf(data).map((e) => e.field);
    expect(fields.some((f) => f.startsWith('steps.3.jobs[1]'))).toBe(true);
    expect(fields.some((f) => f.startsWith('steps.3.jobs[2]'))).toBe(true);
    expect(fields.some((f) => f.startsWith('steps.3.jobs[0]'))).toBe(false);
  });

  // @traces 115-FR-005
  it('warns only past exactly three times the bottom', () => {
    const warns = (to: number) =>
      checkListing({
        data: patched('3', { labour: { fromBani: lei(100), toBani: to } }),
      });
    expect(warns(lei(300))).toEqual({ errors: [], warnings: [] });
    expect(warns(lei(300) + 1)).toEqual({
      errors: [],
      warnings: [{ code: 'wide_range', field: 'steps.3.labour.to' }],
    });
  });

  // @traces 115-FR-005
  it('does not warn of a wide range that is also an error', () => {
    const result = checkListing({
      data: patched('3', { labour: { fromBani: lei(200), toBani: lei(100) } }),
    });
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([
      { code: 'below_from', field: 'steps.3.labour.to' },
    ]);
  });

  // @traces 115-FR-002
  it('treats a job with a brand only as no job', () => {
    const data = patched('3', {
      jobs: [{ brandId: BRAND, fromBani: lei(1), name: 'x y', toBani: lei(2) }],
    });
    expect(errorsOf(data)).toEqual([
      { code: 'required', field: 'steps.3.jobs' },
    ]);
  });

  // @traces 115-FR-002
  it('counts an empty price list once even with a bad labour range', () => {
    const data = patched('3', {
      jobs: [],
      labour: { fromBani: Number.NaN, toBani: Number.NaN },
    });
    expect(
      errorsOf(data).filter((e) => e.field === 'steps.3.jobs'),
    ).toHaveLength(1);
  });

  // @traces 115-FR-002
  it('names a typed job name of 80 and 81 characters', () => {
    const job = (name: string) =>
      patched('3', { jobs: [{ fromBani: lei(100), name, toBani: lei(200) }] });
    expect(errorsOf(job('J'.repeat(80)))).toEqual([]);
    expect(errorsOf(job('J'.repeat(81)))).toEqual([
      { code: 'invalid', field: 'steps.3.jobs[0].name' },
    ]);
    expect(errorsOf(job('   '))).toHaveLength(1);
  });
});

describe('courtesy car price', () => {
  const car = (pricePerDayBani: unknown) =>
    patched('5', {
      courtesyCar: { paid: true, pricePerDayBani },
      facilities: ['courtesy_car'],
    });

  // @traces 115-FR-002
  it.each([lei(1), lei(1000), lei(2000)])('takes %i bani a day', (bani) => {
    expect(errorsOf(car(bani))).toEqual([]);
  });

  // @traces 115-FR-002
  it.each([
    [0],
    [-100],
    [lei(2000) + 1],
    [lei(2001)],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    ['5000'],
  ])('refuses %p a day', (bani) => {
    expect(errorsOf(car(bani)).map((e) => e.field)).toEqual([
      'steps.5.courtesyCar.pricePerDayBani',
    ]);
  });
});

describe('mechanics', () => {
  const mechanic = (name: unknown) => withStep('4', { mechanics: [{ name }] });

  // @traces 115-FR-004
  it.each([[2], [60]])('takes a name of %i characters', (n) => {
    expect(errorsOf(mechanic('M'.repeat(n)))).toEqual([]);
  });

  // @traces 115-FR-004
  it.each([[''], ['   '], ['M'], ['M'.repeat(61)], [null], [42]])(
    'refuses the name %j',
    (name) => {
      expect(errorsOf(mechanic(name))).toEqual([
        { code: 'invalid', field: 'steps.4.mechanics[0].name' },
      ]);
    },
  );

  // @traces 115-FR-004
  it('names the ninth card of many', () => {
    const mechanics = Array.from({ length: 12 }, (_, i) => ({
      name: i === 9 ? '' : 'Ion Marin',
    }));
    expect(errorsOf(withStep('4', { mechanics }))).toEqual([
      { code: 'invalid', field: 'steps.4.mechanics[9].name' },
    ]);
  });
});

describe('photos, hours and payments', () => {
  // @traces 115-FR-002
  it.each([[['']], [['   ']], [[null]]])(
    'does not count %j as a confirmed photo',
    (files) => {
      expect(errorsOf({ ...complete(), files })).toEqual([
        { code: 'required', field: 'files' },
      ]);
    },
  );

  // @traces 115-FR-002
  it('takes one open day among six closed ones', () => {
    const hours = {
      fri: [],
      mon: [],
      sat: [],
      sun: [],
      thu: [],
      tue: [],
      wed: [{ from: '08:00', to: '17:00' }],
    };
    expect(errorsOf(patched('5', { hours }))).toEqual([]);
  });

  // @traces 115-FR-002
  it('asks for a payment method when payments is not a list', () => {
    expect(errorsOf(patched('5', { payments: null }))).toEqual([
      { code: 'required', field: 'steps.5.payments' },
    ]);
  });
});

describe('brands and warnings', () => {
  // @traces 115-FR-005
  it('warns once per entry for the same brand listed twice', () => {
    const data = withStep('2', {
      brands: [
        { brandId: BRAND, fuels: [], name: 'Dacia', stance: 'works_on' },
        { brandId: BRAND, fuels: [], name: 'Dacia', stance: 'works_on' },
      ],
    });
    expect(checkListing({ data })).toEqual({
      errors: [],
      warnings: [
        { code: 'no_requests', field: 'steps.2.brands[0]' },
        { code: 'no_requests', field: 'steps.2.brands[1]' },
      ],
    });
  });

  // @traces 115-FR-005
  it('does not warn for a refused brand with no fuels', () => {
    const data = withStep('2', {
      brands: [
        { brandId: BRAND, name: 'Dacia', stance: 'works_on' },
        {
          brandId: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
          fuels: [],
          name: 'Audi',
          stance: 'does_not_take',
        },
      ],
    });
    expect(checkListing({ data })).toEqual({ errors: [], warnings: [] });
  });

  // @traces 115-FR-005
  it('warns once for a brand with both no fuel and no job ticked', () => {
    const data = withStep('2', {
      brands: [
        {
          brandId: BRAND,
          fuels: [],
          name: 'Dacia',
          stance: 'works_on',
          unticked: [JOB],
        },
      ],
    });
    expect(checkListing({ data }).warnings).toEqual([
      { code: 'no_requests', field: 'steps.2.brands[0]' },
    ]);
  });

  // @traces 115-FR-005
  it('is sendable with every warning at once', () => {
    const data = {
      ...withStep(
        '2',
        {
          brands: [
            { brandId: BRAND, fuels: [], name: 'Dacia', stance: 'works_on' },
          ],
        },
        patched('3', {
          jobs: [{ fromBani: lei(100), jobTypeId: JOB, toBani: lei(900) }],
          labour: { fromBani: lei(100), toBani: lei(900) },
        }),
      ),
      documents: {},
    };
    const result = checkListing({ data, email: 'ana@service.ro' });
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => w.code).sort()).toEqual([
      'document_missing',
      'document_missing',
      'no_requests',
      'wide_range',
      'wide_range',
    ]);
  });

  // @traces 115-FR-005
  it('warns of a document with an empty page list', () => {
    const data = {
      ...complete(),
      documents: {
        onrc_certificate: { pages: [] },
        rar_authorisation: { pages: [PAGE] },
      },
    };
    expect(checkListing({ data })).toEqual({
      errors: [],
      warnings: [
        { code: 'document_missing', field: 'documents.onrc_certificate' },
      ],
    });
  });

  // @traces 115-FR-005
  it('never raises cui_in_use itself', () => {
    const codes = checkListing({ data: complete() }).warnings.map(
      (w) => w.code,
    );
    expect(codes).not.toContain('cui_in_use');
  });
});

describe('scale', () => {
  // @traces 115-FR-002
  it('names the one bad row among ten thousand jobs', () => {
    const jobs = Array.from({ length: 10_000 }, (_, i) => ({
      fromBani: lei(100),
      name: `Lucrare ${i}`,
      toBani: i === 9_999 ? undefined : lei(200),
    }));
    expect(errorsOf(patched('3', { jobs }))).toEqual([
      { code: 'required', field: 'steps.3.jobs[9999].to' },
    ]);
  });

  // @traces 115-FR-001
  it('keeps one error at most per field across ten thousand bad mechanics', () => {
    const mechanics = Array.from({ length: 10_000 }, () => ({ name: '' }));
    const fields = errorsOf(withStep('4', { mechanics })).map((e) => e.field);
    expect(new Set(fields).size).toBe(10_000);
  });
});

describe('stepOf on hostile fields', () => {
  // @traces 115-FR-008
  it.each([
    'steps.0.name',
    'steps.10.name',
    'steps.1x.name',
    'steps.',
    'Steps.1.name',
    'steps.-1.x',
    ' email',
    'email ',
    'filesx',
    'documents',
    'declarations',
  ])('puts %j in no step', (field) => {
    expect(stepOf(field)).toBeNull();
  });

  // @traces 115-FR-008
  it.each([
    ['steps.6', 6],
    ['steps.3.jobs[10000].to', 3],
    ['documents.anything', 6],
  ])('puts %s in step %i', (field, n) => {
    expect(stepOf(field)).toBe(n);
  });
});
