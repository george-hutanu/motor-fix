import {
  checkSummary,
  lamp,
  VERIFICATION_CHECK_KINDS,
  VERIFICATION_CHECK_RESULTS,
  type VerificationCheckKind,
  type VerificationCheckResult,
} from './verification-checks';

// @traces 300-FR-008 300-FR-009

type Recorded = Partial<
  Record<VerificationCheckKind, [VerificationCheckResult, string?]>
>;

// The file's 8 checks, `not_run` unless named.
const checks = (recorded: Recorded = {}) =>
  VERIFICATION_CHECK_KINDS.map((kind) => {
    const [result, detail] = recorded[kind] ?? ['not_run'];
    return { detail: detail ?? null, kind, result };
  });

const both = (recorded: Recorded) => [
  checkSummary(checks(recorded), 'ro'),
  checkSummary(checks(recorded), 'en'),
];

describe('verification check kinds and results', () => {
  it('lists the 8 kinds in the order the summary reads them', () => {
    expect([...VERIFICATION_CHECK_KINDS]).toEqual([
      'company',
      'caen',
      'rar',
      'activities',
      'representative',
      'address',
      'photos',
      'documents',
    ]);
    expect([...VERIFICATION_CHECK_RESULTS]).toEqual([
      'not_run',
      'ok',
      'warning',
      'failed',
    ]);
  });
});

describe('lamp', () => {
  it.each([
    ['ok', 'green'],
    ['warning', 'amber'],
    ['failed', 'red'],
    ['not_run', 'grey'],
  ] as const)('shows %s as %s', (result, colour) => {
    expect(lamp(result)).toBe(colour);
  });
});

describe('checkSummary', () => {
  it('names both register checks when both are ok', () => {
    expect(both({ company: ['ok'], rar: ['ok'] })).toEqual([
      'CUI și autorizație RAR verificate',
      'Company ID and RAR licence checked',
    ]);
  });

  it('agrees with the one register check that is ok', () => {
    expect(both({ company: ['ok'] })).toEqual([
      'CUI verificat',
      'Company ID checked',
    ]);
    expect(both({ rar: ['ok', 'găsită'] })).toEqual([
      'Autorizație RAR verificată',
      'RAR licence checked',
    ]);
  });

  it('reads a failed rar as the licence missing', () => {
    expect(both({ rar: ['failed', 'nu apare în registru'] })).toEqual([
      'Lipsește autorizația RAR',
      'RAR licence missing',
    ]);
    expect(both({ company: ['ok'], rar: ['failed', 'x'] })).toEqual([
      'CUI verificat · lipsește autorizația RAR',
      'Company ID checked · RAR licence missing',
    ]);
  });

  it('adds the problem as the kind and its detail as typed', () => {
    expect(both({ company: ['ok'], photos: ['warning', 'neclare'] })).toEqual([
      'CUI verificat · fotografii neclare',
      'Company ID checked · photos neclare',
    ]);
  });

  it('reads Neverificat with nothing recorded', () => {
    expect(both({})).toEqual(['Neverificat', 'Not checked']);
  });

  it('reads Neverificat when only checks outside the registers are ok', () => {
    expect(both({ address: ['ok'], photos: ['ok'] })).toEqual([
      'Neverificat',
      'Not checked',
    ]);
  });

  it('puts a failure before a warning, whatever the kind', () => {
    expect(
      both({ caen: ['warning', 'lipsă'], documents: ['failed', 'ilizibile'] }),
    ).toEqual(['Documente ilizibile', 'Documents ilizibile']);
  });

  it('puts rar before any other kind of the same severity', () => {
    expect(
      checkSummary(
        checks({ company: ['warning', 'inactiv'], rar: ['warning', 'expiră'] }),
        'ro',
      ),
    ).toBe('Autorizație RAR expiră');
  });

  it('otherwise names the first kind in order', () => {
    expect(
      both({
        address: ['warning', 'diferită'],
        caen: ['warning', 'secundar'],
        representative: ['warning', 'altul'],
      }),
    ).toEqual(['Cod CAEN secundar', 'CAEN code secundar']);
  });

  it('names each kind in both languages', () => {
    const named = (kind: VerificationCheckKind) => [
      checkSummary(checks({ [kind]: ['warning', 'd'] }), 'ro'),
      checkSummary(checks({ [kind]: ['warning', 'd'] }), 'en'),
    ];
    expect(VERIFICATION_CHECK_KINDS.map(named)).toEqual([
      ['CUI d', 'Company ID d'],
      ['Cod CAEN d', 'CAEN code d'],
      ['Autorizație RAR d', 'RAR licence d'],
      ['Activități d', 'Activities d'],
      ['Reprezentant d', 'Representative d'],
      ['Adresă d', 'Address d'],
      ['Fotografii d', 'Photos d'],
      ['Documente d', 'Documents d'],
    ]);
  });

  it('counts a kind missing from the list as not run', () => {
    expect(
      checkSummary([{ detail: null, kind: 'company', result: 'ok' }], 'ro'),
    ).toBe('CUI verificat');
    expect(checkSummary([], 'en')).toBe('Not checked');
  });
});
