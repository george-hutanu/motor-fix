import { checkListing, stepOf } from './listing-check';
import { hoursComplete } from '../garage-hours';
import { declarationDone } from '../legal-documents/legal-documents';
import { hasConfirmedPhoto } from '../listing-photos/listing-photos';
import {
  detailsComplete,
  type ListingDraftData,
  mechanicsComplete,
  pricesComplete,
} from '../listing-sections';
import { isValidCui, RAR_NUMBER_MIN } from '../listing-verification';
import type { BrandsSection } from '../marked-brands';
import { placeComplete, radiusAllowed } from '../place-section';
import { leiToBani as lei } from '../price-range';

const BRAND = '6d3b3a0e-2f8e-4b1f-8c2a-1d4e5f6a7b8c';
const OTHER_BRAND = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
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
      knownFor: 'Frâne și distribuție',
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

// The complete draft with one step's section replaced or extended.
const withStep = <K extends keyof Steps>(
  key: K,
  section: Steps[K],
  data: ListingDraftData = complete(),
): ListingDraftData => ({ ...data, steps: { ...data.steps, [key]: section } });

const step = <K extends keyof Steps>(key: K) =>
  complete().steps?.[key] as NonNullable<Steps[K]>;

const errorsOf = (data: ListingDraftData, email?: string) =>
  checkListing({ data, ...(email !== undefined && { email }) }).errors;

const warningsOf = (data: ListingDraftData) => checkListing({ data }).warnings;

describe('a complete listing', () => {
  // @traces 115-listing-checklist-FR-001
  it('has no error and no warning', () => {
    expect(checkListing({ data: complete(), email: 'ana@service.ro' })).toEqual(
      { errors: [], warnings: [] },
    );
  });
});

describe('an empty listing', () => {
  // @traces 115-listing-checklist-FR-002
  it('lists every required value once, in step order', () => {
    expect(errorsOf({}, '')).toEqual([
      { code: 'required', field: 'email' },
      { code: 'required', field: 'steps.1.name' },
      { code: 'required', field: 'steps.1.phone' },
      { code: 'required', field: 'steps.1.knownFor' },
      { code: 'required', field: 'steps.1.businessKind' },
      { code: 'required', field: 'steps.2.brands' },
      { code: 'required', field: 'steps.3.labour.from' },
      { code: 'required', field: 'steps.3.labour.to' },
      { code: 'required', field: 'steps.3.jobs' },
      { code: 'required', field: 'files' },
      { code: 'required', field: 'steps.5.place.address' },
      { code: 'required', field: 'steps.5.place.lat' },
      { code: 'required', field: 'steps.5.payments' },
      { code: 'required', field: 'steps.6.cui' },
      { code: 'required', field: 'steps.6.rarNumber' },
      { code: 'required', field: 'declaration' },
    ]);
  });

  // @traces 115-listing-checklist-FR-005
  it('warns of the two missing documents', () => {
    expect(warningsOf({})).toEqual([
      { code: 'document_missing', field: 'documents.onrc_certificate' },
      { code: 'document_missing', field: 'documents.rar_authorisation' },
    ]);
  });
});

describe('step 1', () => {
  const details = (patch: Record<string, unknown>) =>
    withStep('1', { ...step('1'), ...patch });

  // @traces 115-listing-checklist-FR-002
  it.each([
    [{ name: '   ' }, 'required', 'steps.1.name'],
    [{ name: ' A ' }, 'invalid', 'steps.1.name'],
    [{ name: 'A'.repeat(81) }, 'invalid', 'steps.1.name'],
    [{ phone: '' }, 'required', 'steps.1.phone'],
    [{ phone: '0722' }, 'invalid', 'steps.1.phone'],
    [{ phone: '+44 20 7946 0958' }, 'invalid', 'steps.1.phone'],
    [{ knownFor: '  ' }, 'required', 'steps.1.knownFor'],
    [{ knownFor: 'x'.repeat(161) }, 'invalid', 'steps.1.knownFor'],
    [{ businessKind: undefined }, 'required', 'steps.1.businessKind'],
  ])('refuses %j with %s on %s', (patch, code, field) => {
    expect(errorsOf(details(patch))).toEqual([{ code, field }]);
  });

  it.each([
    [{ name: 'Ab' }],
    [{ name: `  ${'A'.repeat(80)}  ` }],
    [{ knownFor: 'x'.repeat(160) }],
    [{ phone: '+40 722 123 456' }],
  ])('takes %j', (patch) => {
    expect(errorsOf(details(patch))).toEqual([]);
  });

  it.each([
    ['', 'required'],
    ['   ', 'required'],
    ['ana', 'invalid'],
    ['ana@service', 'invalid'],
    [`${'a'.repeat(250)}@x.ro`, 'invalid'],
  ])('refuses the e-mail %j with %s', (email, code) => {
    expect(errorsOf(complete(), email)).toEqual([{ code, field: 'email' }]);
  });

  it('takes an e-mail typed with spaces around it', () => {
    expect(errorsOf(complete(), ' ana@service.ro ')).toEqual([]);
  });

  it('leaves the e-mail alone when none is passed', () => {
    expect(errorsOf(complete())).toEqual([]);
  });

  // @traces 115-listing-checklist-FR-003
  it('asks a mobile mechanic for the legal form', () => {
    expect(errorsOf(details({ businessKind: 'mobile' }))).toContainEqual({
      code: 'required',
      field: 'steps.1.mobileLegalForm',
    });
  });

  it('refuses a legal form kept for a business that is not mobile', () => {
    expect(errorsOf(details({ mobileLegalForm: 'pfa' }))).toEqual([
      { code: 'invalid', field: 'steps.1.mobileLegalForm' },
    ]);
  });
});

describe('step 2', () => {
  // @traces 115-listing-checklist-FR-002
  it.each<[string, BrandsSection]>([
    ['no brand', { brands: [] }],
    [
      'only refused brands',
      { brands: [{ brandId: BRAND, name: 'Dacia', stance: 'does_not_take' }] },
    ],
  ])('asks for a taken brand with %s', (_, section) => {
    expect(errorsOf(withStep('2', section))).toEqual([
      { code: 'required', field: 'steps.2.brands' },
    ]);
  });

  // @traces 115-listing-checklist-FR-005
  it('warns once for a taken brand with every fuel unticked', () => {
    const data = withStep('2', {
      brands: [
        { brandId: OTHER_BRAND, name: 'Audi', stance: 'does_not_take' },
        { brandId: BRAND, fuels: [], name: 'Dacia', stance: 'works_on' },
      ],
    });
    expect(checkListing({ data })).toEqual({
      errors: [],
      warnings: [{ code: 'no_requests', field: 'steps.2.brands[1]' }],
    });
  });

  it('warns for a taken brand with every job unticked', () => {
    const data = withStep('2', {
      brands: [
        { brandId: BRAND, name: 'Dacia', stance: 'works_on', unticked: [JOB] },
      ],
    });
    expect(checkListing({ data })).toEqual({
      errors: [],
      warnings: [{ code: 'no_requests', field: 'steps.2.brands[0]' }],
    });
  });

  it('does not warn while one job stays ticked', () => {
    const data = withStep(
      '2',
      {
        brands: [
          {
            brandId: BRAND,
            name: 'Dacia',
            stance: 'works_on',
            unticked: [JOB],
          },
        ],
      },
      withStep('3', {
        ...step('3'),
        jobs: [
          { fromBani: lei(150), jobTypeId: JOB, toBani: lei(300) },
          { fromBani: lei(400), name: 'Schimb ambreiaj', toBani: lei(900) },
        ],
      }),
    );
    expect(warningsOf(data)).toEqual([]);
  });

  it('does not warn of jobs before step 3 lists any', () => {
    const data = withStep('3', { labour: step('3').labour });
    expect(warningsOf(data)).toEqual([]);
  });
});

describe('step 3', () => {
  const prices = (patch: Record<string, unknown>) =>
    withStep('3', { ...step('3'), ...patch });

  // @traces 115-listing-checklist-FR-002
  it('asks for both ends of the labour range', () => {
    expect(errorsOf(prices({ labour: {} }))).toEqual([
      { code: 'required', field: 'steps.3.labour.from' },
      { code: 'required', field: 'steps.3.labour.to' },
    ]);
  });

  it.each([
    [{ fromBani: 50, toBani: lei(200) }, 'min', 'steps.3.labour.from'],
    [
      { fromBani: lei(200), toBani: lei(100) },
      'below_from',
      'steps.3.labour.to',
    ],
    [{ fromBani: lei(120), toBani: lei(100_001) }, 'max', 'steps.3.labour.to'],
  ])('reuses the range code for the labour %j', (labour, code, field) => {
    expect(errorsOf(prices({ labour }))).toEqual([{ code, field }]);
  });

  it('asks for a job without a brand', () => {
    expect(
      errorsOf(
        prices({
          jobs: [
            {
              brandId: BRAND,
              fromBani: lei(1),
              jobTypeId: JOB,
              toBani: lei(2),
            },
          ],
        }),
      ),
    ).toEqual([{ code: 'required', field: 'steps.3.jobs' }]);
  });

  it('counts an empty price list once', () => {
    expect(errorsOf(prices({ jobs: undefined }))).toEqual([
      { code: 'required', field: 'steps.3.jobs' },
    ]);
  });

  it('asks for the top of a job by its row', () => {
    expect(
      errorsOf(
        prices({
          jobs: [
            ...step('3').jobs!,
            { fromBani: lei(400), name: 'Schimb ambreiaj' },
          ],
        }),
      ),
    ).toEqual([{ code: 'required', field: 'steps.3.jobs[1].to' }]);
  });

  it('refuses a job row out of range and a short job name', () => {
    expect(
      errorsOf(
        prices({
          jobs: [
            { fromBani: lei(150), jobTypeId: JOB, toBani: lei(100) },
            { fromBani: lei(400), name: ' X ', toBani: lei(900) },
          ],
        }),
      ),
    ).toEqual([
      { code: 'below_from', field: 'steps.3.jobs[0].to' },
      { code: 'invalid', field: 'steps.3.jobs[1].name' },
    ]);
  });

  // @traces 115-listing-checklist-FR-005
  it('warns of a wide range without refusing it', () => {
    expect(
      checkListing({
        data: prices({
          jobs: [{ fromBani: lei(100), jobTypeId: JOB, toBani: lei(301) }],
          labour: { fromBani: lei(100), toBani: lei(400) },
        }),
      }),
    ).toEqual({
      errors: [],
      warnings: [
        { code: 'wide_range', field: 'steps.3.labour.to' },
        { code: 'wide_range', field: 'steps.3.jobs[0].to' },
      ],
    });
  });
});

describe('step 4', () => {
  // @traces 115-listing-checklist-FR-004
  it('is complete when empty', () => {
    expect(errorsOf(withStep('4', {}))).toEqual([]);
    expect(errorsOf(withStep('4', { mechanics: [] }))).toEqual([]);
  });

  it('refuses a mechanic name outside 2 to 60 letters, by its card', () => {
    expect(
      errorsOf(
        withStep('4', {
          mechanics: [
            { name: 'Ion Marin' },
            { name: ' I ' },
            { name: 'x'.repeat(61) },
          ],
        }),
      ),
    ).toEqual([
      { code: 'invalid', field: 'steps.4.mechanics[1].name' },
      { code: 'invalid', field: 'steps.4.mechanics[2].name' },
    ]);
  });
});

describe('step 5', () => {
  const five = (patch: Record<string, unknown>) =>
    withStep('5', { ...step('5'), ...patch });

  // @traces 115-listing-checklist-FR-002
  it('asks for a confirmed photo', () => {
    expect(errorsOf({ ...complete(), files: [] })).toEqual([
      { code: 'required', field: 'files' },
    ]);
  });

  it('asks for the address and the position', () => {
    expect(errorsOf(five({ place: { address: '  ' } }))).toEqual([
      { code: 'required', field: 'steps.5.place.address' },
      { code: 'required', field: 'steps.5.place.lat' },
    ]);
  });

  it('refuses a position outside Romania', () => {
    expect(
      errorsOf(five({ place: { address: 'Wien', lat: 48.2, lng: 16.37 } })),
    ).toEqual([{ code: 'invalid', field: 'steps.5.place.lat' }]);
  });

  it('does not judge a radius for a workshop', () => {
    expect(
      errorsOf(five({ place: { ...step('5').place, radiusKm: 500 } })),
    ).toEqual([]);
  });

  it('asks for at least one open day', () => {
    const hours = {
      fri: [],
      mon: [],
      sat: [],
      sun: [],
      thu: [],
      tue: [],
      wed: [],
    };
    expect(errorsOf(five({ hours }))).toEqual([
      { code: 'required', field: 'steps.5.hours' },
    ]);
  });

  it('asks for a payment method', () => {
    expect(errorsOf(five({ payments: [] }))).toEqual([
      { code: 'required', field: 'steps.5.payments' },
    ]);
  });

  it.each([
    [{ paid: true }, 'required'],
    [{ paid: true, pricePerDayBani: 150 }, 'invalid'],
  ])('asks a paid courtesy car %j for its price', (courtesyCar, code) => {
    expect(
      errorsOf(five({ courtesyCar, facilities: ['courtesy_car'] })),
    ).toEqual([{ code, field: 'steps.5.courtesyCar.pricePerDayBani' }]);
  });

  it('asks nothing of a free or unlisted courtesy car', () => {
    expect(
      errorsOf(
        five({ courtesyCar: { paid: false }, facilities: ['courtesy_car'] }),
      ),
    ).toEqual([]);
    expect(errorsOf(five({ courtesyCar: { paid: true } }))).toEqual([]);
  });

  describe('for a mobile mechanic', () => {
    const mobile = (place: Record<string, unknown>) =>
      withStep(
        '5',
        { ...step('5'), place },
        withStep('1', {
          ...step('1'),
          businessKind: 'mobile',
          mobileLegalForm: 'pfa',
        }),
      );

    // @traces 115-listing-checklist-FR-003
    it('asks for the seat, and lets the default radius stand in for none', () => {
      expect(errorsOf(mobile({}))).toEqual([
        { code: 'required', field: 'steps.5.place.address' },
        { code: 'required', field: 'steps.5.place.lat' },
      ]);
    });

    it('takes a seat with a radius of 1 to 100 km', () => {
      const seat = step('5').place;
      expect(errorsOf(mobile({ ...seat, radiusKm: 1 }))).toEqual([]);
      expect(errorsOf(mobile({ ...seat, radiusKm: 100 }))).toEqual([]);
      expect(errorsOf(mobile({ ...seat, radiusKm: 101 }))).toEqual([
        { code: 'invalid', field: 'steps.5.place.radiusKm' },
      ]);
    });
  });
});

describe('step 6', () => {
  const six = (patch: Record<string, unknown>) =>
    withStep('6', { ...step('6'), ...patch });

  // @traces 115-listing-checklist-FR-002
  it.each([
    [{ cui: undefined }, 'required', 'steps.6.cui'],
    [{ cui: '18547291' }, 'invalid', 'steps.6.cui'],
    [{ rarNumber: undefined }, 'required', 'steps.6.rarNumber'],
    [{ rarNumber: 'BV' }, 'invalid', 'steps.6.rarNumber'],
  ])('refuses %j with %s', (patch, code, field) => {
    expect(errorsOf(six(patch))).toEqual([{ code, field }]);
  });

  it('takes a RAR number of three characters', () => {
    expect(errorsOf(six({ rarNumber: 'X'.repeat(RAR_NUMBER_MIN) }))).toEqual(
      [],
    );
  });

  it('asks for the declaration, then a whole declared name', () => {
    const { declaredAt: _, ...unticked } = complete();
    expect(errorsOf(unticked)).toEqual([
      { code: 'required', field: 'declaration' },
    ]);
    expect(errorsOf({ ...complete(), declaredByName: ' I ' })).toEqual([
      { code: 'invalid', field: 'declaration' },
    ]);
  });

  // @traces 115-listing-checklist-FR-005
  it('warns of a missing upload and still sends', () => {
    const data = {
      ...complete(),
      documents: { onrc_certificate: { pages: [PAGE] } },
    };
    expect(checkListing({ data })).toEqual({
      errors: [],
      warnings: [
        { code: 'document_missing', field: 'documents.rar_authorisation' },
      ],
    });
  });
});

describe('one error per field', () => {
  // @traces 115-listing-checklist-FR-002
  it('never names a field twice', () => {
    const data = withStep('3', {
      jobs: [{ fromBani: 1.5, jobTypeId: JOB, toBani: 0.5 }],
      labour: { fromBani: 1.5, toBani: 0.5 },
    });
    const fields = errorsOf(data).map((problem) => problem.field);
    expect(new Set(fields).size).toBe(fields.length);
  });
});

describe('stepOf', () => {
  // @traces 115-listing-checklist-FR-008
  it.each([
    ['email', 1],
    ['steps.1.name', 1],
    ['steps.2.brands', 2],
    ['steps.2.brands[3]', 2],
    ['steps.3.jobs[2].to', 3],
    ['steps.4.mechanics[0].name', 4],
    ['files', 5],
    ['steps.5.courtesyCar.pricePerDayBani', 5],
    ['steps.6.cui', 6],
    ['documents.onrc_certificate', 6],
    ['declaration', 6],
  ])('puts %s in step %i', (field, n) => {
    expect(stepOf(field)).toBe(n);
  });

  it.each(['steps.7.x', 'survey', ''])('refuses %j', (field) => {
    expect(() => stepOf(field)).toThrow(RangeError);
  });
});

describe('the completeness functions', () => {
  const sections = (data: ListingDraftData) => data.steps ?? {};
  const complete5 = (data: ListingDraftData) => {
    const five = sections(data)['5'] ?? {};
    const place = five.place ?? {};
    return (
      placeComplete(place) &&
      hoursComplete(five) &&
      hasConfirmedPhoto(data) &&
      (sections(data)['1']?.businessKind !== 'mobile' ||
        place.radiusKm === undefined ||
        radiusAllowed(place.radiusKm))
    );
  };
  const judged: Record<number, (data: ListingDraftData) => boolean> = {
    1: (data) => detailsComplete(sections(data)['1'] ?? {}),
    2: (data) =>
      (sections(data)['2']?.brands ?? []).some((b) => b.stance === 'works_on'),
    3: (data) => pricesComplete(sections(data)['3'] ?? {}),
    4: (data) => mechanicsComplete(sections(data)['4'] ?? {}),
    5: complete5,
    6: (data) =>
      isValidCui(sections(data)['6']?.cui ?? '') &&
      (sections(data)['6']?.rarNumber ?? '').length >= RAR_NUMBER_MIN &&
      declarationDone(data),
  };

  const drafts: Array<[string, ListingDraftData]> = [
    ['complete', complete()],
    ['empty', {}],
    ['no name', withStep('1', { ...step('1'), name: '' })],
    ['a foreign phone', withStep('1', { ...step('1'), phone: '+4420794609' })],
    [
      'mobile without its form',
      withStep('1', { ...step('1'), businessKind: 'mobile' }),
    ],
    ['refused brands', withStep('2', { brands: [] })],
    [
      'an unpriced job',
      withStep('3', { ...step('3'), jobs: [{ jobTypeId: JOB }] }),
    ],
    ['a bad mechanic', withStep('4', { mechanics: [{ name: 'I' }] })],
    ['no photo', { ...complete(), files: [] }],
    [
      'a closed week',
      withStep('5', {
        ...step('5'),
        hours: {
          fri: [],
          mon: [],
          sat: [],
          sun: [],
          thu: [],
          tue: [],
          wed: [],
        },
      }),
    ],
    [
      'mobile without a radius',
      withStep('1', {
        ...step('1'),
        businessKind: 'mobile',
        mobileLegalForm: 'company',
      }),
    ],
    ['a bad CUI', withStep('6', { ...step('6'), cui: '123' })],
    ['no declaration', { ...complete(), declaredByName: '' }],
  ];

  // @traces 115-listing-checklist-FR-001
  it.each(drafts)('agree with the rule set on a %s draft', (_, data) => {
    const errors = errorsOf(data);
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const clean = !errors.some((problem) => stepOf(problem.field) === n);
      expect([n, clean]).toEqual([n, judged[n](data)]);
    }
  });
});
