import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  checkSummary,
  coversJob,
  lamp,
  RecordCheckEvidenceDto,
  uncoveredJobs,
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

const LICENCE = ['rar_authorisation'];

const both = (recorded: Recorded, documents: readonly string[] = LICENCE) => [
  checkSummary(checks(recorded), 'ro', documents),
  checkSummary(checks(recorded), 'en', documents),
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
        LICENCE,
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
      checkSummary(checks({ [kind]: ['warning', 'd'] }), 'ro', LICENCE),
      checkSummary(checks({ [kind]: ['warning', 'd'] }), 'en', LICENCE),
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
      checkSummary(
        [{ detail: null, kind: 'company', result: 'ok' }],
        'ro',
        LICENCE,
      ),
    ).toBe('CUI verificat');
    expect(checkSummary([], 'en', LICENCE)).toBe('Not checked');
  });
});

// @traces 204-FR-010
describe("checkSummary with the file's documents", () => {
  it('names the missing licence whatever the rar result, ok included', () => {
    for (const result of ['ok', 'warning', 'failed', 'not_run'] as const) {
      expect(both({ rar: [result, 'd'] }, [])).toEqual([
        'Lipsește autorizația RAR',
        'RAR licence missing',
      ]);
    }
  });

  it('names the missing licence once, beside a register that is ok', () => {
    expect(
      both({ company: ['ok'], rar: ['ok'] }, ['onrc_certificate']),
    ).toEqual([
      'CUI verificat · lipsește autorizația RAR',
      'Company ID checked · RAR licence missing',
    ]);
  });

  it('ranks the missing licence as a failed rar, before another failure', () => {
    expect(both({ documents: ['failed', 'ilizibile'] }, [])).toEqual([
      'Lipsește autorizația RAR',
      'RAR licence missing',
    ]);
  });

  it('reads the licence verified once rar is ok and the document is there', () => {
    expect(
      both({ rar: ['ok'] }, ['onrc_certificate', 'rar_authorisation']),
    ).toEqual(['Autorizație RAR verificată', 'RAR licence checked']);
  });
});

// @traces 204-FR-004
describe('coversJob and uncoveredJobs', () => {
  it('covers a job with no mapped activity', () => {
    expect(coversJob(null, ['brakes'])).toBe(true);
  });

  it('covers every job with an empty list', () => {
    expect(coversJob('paintwork', [])).toBe(true);
  });

  it('covers a job whose activity is ticked, and no other', () => {
    expect(coversJob('brakes', ['mechanics', 'brakes'])).toBe(true);
    expect(coversJob('paintwork', ['mechanics', 'brakes'])).toBe(false);
  });

  it('returns the uncovered jobs in their order', () => {
    const jobs = [
      { id: 'a', rarActivity: 'paintwork' },
      { id: 'b', rarActivity: null },
      { id: 'c', rarActivity: 'air_con' },
      { id: 'd', rarActivity: 'brakes' },
    ];
    expect(uncoveredJobs(jobs, ['brakes']).map((j) => j.id)).toEqual([
      'a',
      'c',
    ]);
    expect(uncoveredJobs(jobs, [])).toEqual([]);
  });
});

// @traces 204-FR-002
// @traces 204-FR-011
describe('RecordCheckEvidenceDto', () => {
  const errorsFor = (plain: object) =>
    validate(plainToInstance(RecordCheckEvidenceDto, plain), {
      forbidNonWhitelisted: true,
      whitelist: true,
    });

  it('accepts the three rar ticks, each optional', async () => {
    expect(
      await errorsFor({ found: true, sameAddress: false, sameCompany: true }),
    ).toEqual([]);
    expect(await errorsFor({ found: false })).toEqual([]);
    expect(await errorsFor({})).toEqual([]);
  });

  it('refuses a tick that is not a boolean', async () => {
    const errors = await errorsFor({ found: 'yes' });
    expect(errors.map((e) => e.property)).toEqual(['found']);
  });

  it.each([
    ['rarNumber', 'B 1234/2019'],
    ['uncoveredJobTypeIds', ['x']],
    ['lookedUpOn', '2026-10-17'],
    ['certificateUploaded', true],
    ['whatever', 1],
  ])('refuses the server-owned or unknown field %s', async (field, value) => {
    const errors = await errorsFor({ [field]: value });
    expect(errors.map((e) => e.property)).toEqual([field]);
  });

  it('holds no relationship rule: a lone tick of another kind passes the shape', async () => {
    expect(
      await errorsFor({ found: true, name: 'SC Dobre SRL', onrc: true }),
    ).toEqual([]);
  });
});
