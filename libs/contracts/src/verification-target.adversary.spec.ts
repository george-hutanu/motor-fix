import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import type { VerificationCheckResult } from './verification-checks';
import { VerificationDecisionDto } from './verification-file.dto';
import {
  approvalGaps,
  queueLamp,
  VERIFICATION_NOTE_MAX,
  VERIFICATION_QUEUE_PAGE,
  VERIFICATION_QUEUE_PANEL,
  VERIFICATION_TARGET_WORKING_DAYS,
} from './verification-target';

// @traces 301-FR-002
const checks = (...results: VerificationCheckResult[]) =>
  results.map((result) => ({ result }));

describe('the queue constants', () => {
  it('hold the numbers the spec names', () => {
    expect(VERIFICATION_TARGET_WORKING_DAYS).toBe(2);
    expect(VERIFICATION_QUEUE_PAGE).toBe(20);
    expect(VERIFICATION_QUEUE_PANEL).toBe(5);
  });
});

describe('the queue lamp', () => {
  it('is grey with no checks and not flagged', () => {
    expect(queueLamp([], false)).toBe('grey');
  });

  it('is amber with no checks and flagged', () => {
    expect(queueLamp([], true)).toBe('amber');
  });

  it('is grey when every check is not run', () => {
    expect(queueLamp(checks('not_run', 'not_run'), false)).toBe('grey');
  });

  it('is amber when every check is not run and flagged', () => {
    expect(queueLamp(checks('not_run'), true)).toBe('amber');
  });

  it('is green when one check is ok and the rest are not run', () => {
    expect(queueLamp(checks('ok', 'not_run', 'not_run'), false)).toBe('green');
  });

  it('is amber when a warning sits beside ok checks', () => {
    expect(queueLamp(checks('ok', 'warning', 'ok'), false)).toBe('amber');
  });

  it('is amber when flagged even if every check is ok', () => {
    expect(queueLamp(checks('ok', 'ok'), true)).toBe('amber');
  });

  it('is red when a check failed and the file is not flagged', () => {
    expect(queueLamp(checks('ok', 'failed'), false)).toBe('red');
  });

  it('is red when a check failed and the file is flagged', () => {
    expect(queueLamp(checks('failed', 'warning'), true)).toBe('red');
  });

  it('is red for a single failed check among eight', () => {
    const eight = checks(
      'ok',
      'ok',
      'warning',
      'not_run',
      'ok',
      'ok',
      'failed',
      'ok',
    );
    expect(queueLamp(eight, true)).toBe('red');
    expect(queueLamp(eight, false)).toBe('red');
  });

  it('does not depend on the order of the checks', () => {
    const forward = checks('ok', 'warning', 'failed');
    expect(queueLamp([...forward].reverse(), false)).toBe(
      queueLamp(forward, false),
    );
  });

  it('does not change the checks it is given', () => {
    const input = checks('ok', 'failed');
    queueLamp(input, true);
    expect(input).toEqual([{ result: 'ok' }, { result: 'failed' }]);
  });

  it('answers green for ten thousand ok checks', () => {
    const many = checks(...Array<VerificationCheckResult>(10_000).fill('ok'));
    expect(queueLamp(many, false)).toBe('green');
  });
});

const KINDS = [
  'company',
  'caen',
  'rar',
  'activities',
  'representative',
  'address',
  'photos',
  'documents',
];
const allOk = KINDS.map((kind) => ({ kind, result: 'ok' as const }));
const both = ['onrc_certificate', 'rar_authorisation'];

describe('what an approval passes over, attacked', () => {
  // @traces 303-FR-003
  it('is empty for an all-ok file with both documents', () => {
    expect(approvalGaps(allOk, both)).toEqual([]);
  });

  // @traces 303-FR-003
  it('names every guide check and both documents for an empty file', () => {
    expect(approvalGaps([], [])).toEqual([
      { kind: 'company', result: 'not_run' },
      { kind: 'activities', result: 'not_run' },
      { kind: 'representative', result: 'not_run' },
      { kind: 'address', result: 'not_run' },
      { kind: 'photos', result: 'not_run' },
      { kind: 'documents', result: 'not_run' },
      { document: 'onrc_certificate' },
      { document: 'rar_authorisation' },
    ]);
  });

  // @traces 303-FR-003
  it('keeps the drawer order whatever order the checks arrive in', () => {
    const shuffled = [...allOk]
      .reverse()
      .map((c) =>
        c.kind === 'photos' || c.kind === 'company'
          ? { ...c, result: 'failed' as const }
          : c,
      );
    expect(approvalGaps(shuffled, both)).toEqual([
      { kind: 'company', result: 'failed' },
      { kind: 'photos', result: 'failed' },
    ]);
  });

  // @traces 303-FR-003
  it('lists documents in the contracts order whatever order the file holds them', () => {
    expect(approvalGaps(allOk, [])).toEqual([
      { document: 'onrc_certificate' },
      { document: 'rar_authorisation' },
    ]);
  });

  // @traces 303-FR-003
  it('never lists the rar and caen gates, whatever their result', () => {
    const checks = allOk.map((c) =>
      c.kind === 'rar' || c.kind === 'caen'
        ? { ...c, result: 'failed' as const }
        : c,
    );
    expect(approvalGaps(checks, both)).toEqual([]);
  });

  // @traces 303-FR-003
  it('ignores unknown check kinds and unknown document kinds', () => {
    const checks = [...allOk, { kind: 'surprise', result: 'failed' as const }];
    expect(approvalGaps(checks, [...both, 'passport'])).toEqual([]);
  });

  // @traces 303-FR-003
  it('does not count a document kind written in another case', () => {
    expect(
      approvalGaps(allOk, ['ONRC_CERTIFICATE', 'rar_authorisation']),
    ).toEqual([{ document: 'onrc_certificate' }]);
  });

  // @traces 303-FR-003
  it('is not fooled by prototype property names as kinds', () => {
    const checks = [
      ...allOk.filter((c) => c.kind !== 'photos'),
      { kind: '__proto__', result: 'ok' as const },
      { kind: 'constructor', result: 'ok' as const },
    ];
    expect(approvalGaps(checks, ['__proto__', 'toString'])).toEqual([
      { kind: 'photos', result: 'not_run' },
      { document: 'onrc_certificate' },
      { document: 'rar_authorisation' },
    ]);
  });

  // @traces 303-FR-003
  it('is the same on a second call and leaves its inputs alone', () => {
    const checks = allOk.map((c) =>
      c.kind === 'address' ? { ...c, result: 'warning' as const } : c,
    );
    const frozen = Object.freeze(checks.map((c) => Object.freeze(c)));
    const docs = Object.freeze(['rar_authorisation']);
    const first = approvalGaps(frozen, docs);
    expect(approvalGaps(frozen, docs)).toEqual(first);
    expect(first).toEqual([
      { kind: 'address', result: 'warning' },
      { document: 'onrc_certificate' },
    ]);
    expect(frozen).toHaveLength(8);
  });

  // @traces 303-FR-003
  it('holds up under ten thousand rows and judges the six guides once each', () => {
    const noise = Array.from({ length: 10_000 }, (_, i) => ({
      kind: `noise-${i}`,
      result: 'failed' as const,
    }));
    const gaps = approvalGaps([...noise, ...allOk], Array(10_000).fill('x'));
    expect(gaps).toEqual([
      { document: 'onrc_certificate' },
      { document: 'rar_authorisation' },
    ]);
  });

  // @traces 303-FR-003
  it('reports a check once even when the file repeats it with the same result', () => {
    const checks = [
      ...allOk.filter((c) => c.kind !== 'photos'),
      { kind: 'photos', result: 'warning' as const },
      { kind: 'photos', result: 'warning' as const },
    ];
    expect(approvalGaps(checks, both)).toEqual([
      { kind: 'photos', result: 'warning' },
    ]);
  });
});

describe('the decision note limit, attacked', () => {
  const errorsFor = (plain: unknown) =>
    validate(plainToInstance(VerificationDecisionDto, plain));

  // @traces 303-FR-002
  it('holds 1,000 code points', () => {
    expect(VERIFICATION_NOTE_MAX).toBe(1000);
  });

  // @traces 303-FR-002
  it('accepts exactly 1,000 characters and refuses 1,001', async () => {
    expect(
      await errorsFor({ decision: 'approved', note: 'a'.repeat(1000) }),
    ).toEqual([]);
    expect(
      (await errorsFor({ decision: 'approved', note: 'a'.repeat(1001) })).map(
        (e) => e.property,
      ),
    ).toEqual(['note']);
  });

  // @traces 303-FR-002
  it('counts an emoji as one character, as the dialog counts it', async () => {
    expect(
      await errorsFor({ decision: 'approved', note: '🚗'.repeat(1000) }),
    ).toEqual([]);
    expect(
      (await errorsFor({ decision: 'approved', note: '🚗'.repeat(1001) })).map(
        (e) => e.property,
      ),
    ).toEqual(['note']);
  });

  // @traces 303-FR-002
  it('counts the limit after trimming', async () => {
    expect(
      await errorsFor({
        decision: 'approved',
        note: `  ${'ă'.repeat(1000)}\n`,
      }),
    ).toEqual([]);
  });

  // @traces 303-FR-003
  it.each(['', '   ', '\n\t '])(
    'reads %j as no note, so the use case can ask for one',
    async (note) => {
      const dto = plainToInstance(VerificationDecisionDto, {
        decision: 'approved',
        note,
      });
      expect(await validate(dto)).toEqual([]);
      expect(dto.note).toBeUndefined();
    },
  );

  // @traces 303-FR-002
  it.each([42, true, ['a'], { a: 1 }])(
    'refuses a note that is not a string: %j',
    async (note) => {
      expect(
        (await errorsFor({ decision: 'approved', note })).map(
          (e) => e.property,
        ),
      ).toEqual(['note']);
    },
  );

  // @traces 303-FR-002
  it('refuses a note holding a NUL or other control character', async () => {
    expect(
      (await errorsFor({ decision: 'approved', note: 'ok\u0000no' })).map(
        (e) => e.property,
      ),
    ).toEqual(['note']);
  });
});
