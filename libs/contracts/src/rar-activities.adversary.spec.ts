import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  checkSummary,
  RecordVerificationCheckDto,
  type VerificationCheckKind,
  type VerificationCheckResult,
} from './verification-checks';
import { CorrectRarNumberDto } from './verification-file.dto';
import { coversJob, uncoveredJobs } from './verification-target';

type Check = {
  kind: VerificationCheckKind;
  result: VerificationCheckResult;
  detail: string | null;
};
const c = (
  kind: VerificationCheckKind,
  result: VerificationCheckResult,
  detail: string | null = null,
): Check => ({ detail, kind, result });

const LICENCE = ['rar_authorisation'];

// @traces 204-FR-004
describe('which jobs the ticked activities cover', () => {
  it('covers a job whose mapped activity is the empty string', () => {
    expect(coversJob('', ['brakes'])).toBe(true);
  });

  it('matches activity codes exactly, case and spaces included', () => {
    expect(coversJob('brakes', ['Brakes'])).toBe(false);
    expect(coversJob('brakes', ['brakes '])).toBe(false);
    expect(coversJob(' ', ['brakes'])).toBe(false);
  });

  it('covers every job when the list is empty, mapped or not', () => {
    expect(coversJob('paintwork', [])).toBe(true);
    expect(coversJob(null, [])).toBe(true);
  });

  it('does not treat an object property name as a ticked activity', () => {
    expect(coversJob('constructor', ['brakes'])).toBe(false);
    expect(coversJob('__proto__', ['brakes'])).toBe(false);
  });

  it('keeps the jobs in their order with their own fields and leaves the input alone', () => {
    const jobs = [
      { id: 'a', rarActivity: 'paintwork' },
      { id: 'b', rarActivity: null },
      { id: 'c', rarActivity: 'air_con' },
      { id: 'd', rarActivity: 'brakes' },
    ];
    const frozen = Object.freeze(jobs.map((j) => Object.freeze({ ...j })));
    const ticked = Object.freeze(['brakes', 'brakes']);

    const out = uncoveredJobs(frozen, ticked);

    expect(out).toEqual([jobs[0], jobs[2]]);
    expect(out[0]).toBe(frozen[0]);
  });

  it('answers an empty list for no jobs, and judges ten thousand jobs', () => {
    expect(uncoveredJobs([], ['brakes'])).toEqual([]);
    const many = Array.from({ length: 10_000 }, (_, i) => ({
      rarActivity: i % 2 ? 'brakes' : 'paintwork',
    }));
    expect(uncoveredJobs(many, ['brakes'])).toHaveLength(5_000);
  });
});

// @traces 204-FR-010
describe('the summary line with the file documents', () => {
  it('reads the licence missing when the file holds no documents at all, with nothing recorded', () => {
    expect(checkSummary([], 'ro', [])).toBe('Lipsește autorizația RAR');
    expect(checkSummary([], 'en', [])).toBe('RAR licence missing');
  });

  it('reads the licence missing for an ok rar when the document is absent', () => {
    expect(checkSummary([c('rar', 'ok')], 'en', [])).toBe(
      'RAR licence missing',
    );
    expect(checkSummary([c('rar', 'ok')], 'ro', ['id_card'])).toBe(
      'Lipsește autorizația RAR',
    );
  });

  it('does not count an ok rar as checked beside an ok company without the document', () => {
    const line = checkSummary([c('company', 'ok'), c('rar', 'ok')], 'en', []);
    expect(line).toBe('Company ID checked · RAR licence missing');
  });

  it('puts the missing licence before a failed check of another kind', () => {
    const line = checkSummary(
      [c('caen', 'failed', 'nu e 4520'), c('rar', 'ok')],
      'en',
      [],
    );
    expect(line).toBe('RAR licence missing');
  });

  it('puts the missing licence before a warning, and drops a failed rar detail', () => {
    const line = checkSummary(
      [c('photos', 'warning', 'neclare'), c('rar', 'failed', 'nu apare')],
      'ro',
      [],
    );
    expect(line).toBe('Lipsește autorizația RAR');
  });

  it('reads the licence checked only with the document and an ok rar', () => {
    expect(checkSummary([c('rar', 'ok')], 'en', LICENCE)).toBe(
      'RAR licence checked',
    );
    expect(checkSummary([c('rar', 'ok')], 'ro', ['x', ...LICENCE])).toBe(
      'Autorizație RAR verificată',
    );
  });

  it('reads Not checked with the document and a rar not run', () => {
    expect(checkSummary([c('rar', 'not_run')], 'en', LICENCE)).toBe(
      'Not checked',
    );
  });

  it('matches the document kind exactly', () => {
    for (const near of [
      'RAR_AUTHORISATION',
      'rar_authorisation ',
      'rar_authorisation_copy',
      'rar',
    ]) {
      expect(checkSummary([c('rar', 'ok')], 'en', [near])).toBe(
        'RAR licence missing',
      );
    }
  });

  it('gives the same line when called twice and leaves the checks alone', () => {
    const checks = Object.freeze([
      Object.freeze(c('company', 'ok')),
      Object.freeze(c('rar', 'ok')),
    ]);
    const first = checkSummary(checks, 'ro', []);
    expect(checkSummary(checks, 'ro', [])).toBe(first);
    expect(checks).toHaveLength(2);
  });
});

function problems(body: unknown) {
  const dto = plainToInstance(RecordVerificationCheckDto, body as object);
  return validateSync(dto, { forbidNonWhitelisted: true, whitelist: true }).map(
    (e) => e.property,
  );
}

// @traces 204-FR-002
describe('the rar evidence the request may carry', () => {
  it.each([
    'rarNumber',
    'lookedUpOn',
    'uncoveredJobTypeIds',
    'certificateUploaded',
  ])('refuses %s, which the server writes', (field) => {
    expect(
      problems({ evidence: { found: true, [field]: 'x' }, result: 'ok' }),
    ).toContain('evidence');
  });

  it('refuses a null, numeric or string tick on each rar tick', () => {
    for (const tick of ['found', 'sameCompany', 'sameAddress']) {
      for (const bad of [null, 1, 'true', []]) {
        expect(problems({ evidence: { [tick]: bad }, result: 'ok' })).toContain(
          'evidence',
        );
      }
    }
  });

  it('accepts the three ticks as booleans', () => {
    expect(
      problems({
        detail: 'adresă diferită',
        evidence: { found: true, sameAddress: false, sameCompany: true },
        result: 'warning',
      }),
    ).toEqual([]);
  });

  it('accepts 50 activities and refuses 51, or one over 40 characters', () => {
    const list = (n: number) => Array.from({ length: n }, () => 'brakes');
    expect(problems({ activities: list(50), result: 'ok' })).toEqual([]);
    expect(problems({ activities: list(51), result: 'ok' })).toContain(
      'activities',
    );
    expect(problems({ activities: ['a'.repeat(41)], result: 'ok' })).toContain(
      'activities',
    );
    expect(problems({ activities: [''], result: 'ok' })).toContain(
      'activities',
    );
    expect(problems({ activities: [null], result: 'ok' })).toContain(
      'activities',
    );
  });
});

// @traces 204-FR-001
describe('the RAR number correction body', () => {
  const check = (body: unknown) =>
    validateSync(plainToInstance(CorrectRarNumberDto, body as object), {
      forbidNonWhitelisted: true,
      whitelist: true,
    }).map((e) => e.property);

  it('accepts a string of exactly 200 characters and refuses 201', () => {
    expect(check({ rarNumber: 'B'.repeat(200) })).toEqual([]);
    expect(check({ rarNumber: 'B'.repeat(201) })).toEqual(['rarNumber']);
  });

  it.each([[null], [42], [['B 1']], [{}], [true]])(
    'refuses %p as the number',
    (value) => {
      expect(check({ rarNumber: value })).toEqual(['rarNumber']);
    },
  );

  it('refuses a missing number and an extra field', () => {
    expect(check({})).toEqual(['rarNumber']);
    expect(check({ rarNumber: 'B 1234', status: 'approved' })).toEqual([
      'status',
    ]);
  });
});
