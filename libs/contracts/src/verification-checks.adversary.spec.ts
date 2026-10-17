import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  checkSummary,
  lamp,
  RecordVerificationCheckDto,
  VERIFICATION_CHECK_KINDS,
  type VerificationCheckKind,
  type VerificationCheckResult,
} from './verification-checks';

// @traces 300-FR-008 300-FR-009 300-FR-010

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

// The file holds its RAR licence, so the licence line follows the checks.
const summary = (checks: readonly Check[], language: 'ro' | 'en') =>
  checkSummary(checks, language, ['rar_authorisation']);

const errorsFor = async (plain: unknown) =>
  validate(plainToInstance(RecordVerificationCheckDto, plain));

describe('lamp', () => {
  it('maps every result to its colour', () => {
    expect(lamp('ok')).toBe('green');
    expect(lamp('warning')).toBe('amber');
    expect(lamp('failed')).toBe('red');
    expect(lamp('not_run')).toBe('grey');
  });
});

describe('checkSummary', () => {
  it('reads Neverificat for an empty list', () => {
    expect(summary([], 'ro')).toBe('Neverificat');
    expect(summary([], 'en')).toBe('Not checked');
  });

  it('reads Neverificat when all eight are not_run', () => {
    const all = VERIFICATION_CHECK_KINDS.map((k) => c(k, 'not_run'));
    expect(summary(all, 'ro')).toBe('Neverificat');
  });

  it('counts a missing kind as not_run', () => {
    expect(summary([c('rar', 'ok')], 'ro')).toBe('Autorizație RAR verificată');
    expect(summary([c('company', 'ok')], 'en')).toBe('Company ID checked');
  });

  it('gives the four Romanian examples exactly', () => {
    expect(summary([c('company', 'ok'), c('rar', 'ok')], 'ro')).toBe(
      'CUI și autorizație RAR verificate',
    );
    expect(summary([c('rar', 'failed')], 'ro')).toBe(
      'Lipsește autorizația RAR',
    );
    expect(
      summary([c('company', 'ok'), c('photos', 'warning', 'neclare')], 'ro'),
    ).toBe('CUI verificat · fotografii neclare');
  });

  it('gives the English examples exactly', () => {
    expect(summary([c('company', 'ok'), c('rar', 'ok')], 'en')).toBe(
      'Company ID and RAR licence checked',
    );
    expect(summary([c('rar', 'failed')], 'en')).toBe('RAR licence missing');
    expect(summary([c('rar', 'ok')], 'en')).toBe('RAR licence checked');
    expect(summary([c('photos', 'warning', 'neclare')], 'en')).toBe(
      'photos neclare'.replace(/^./, (x) => x.toUpperCase()),
    );
  });

  it('ignores ok on kinds other than company and rar', () => {
    const ok = VERIFICATION_CHECK_KINDS.filter(
      (k) => k !== 'company' && k !== 'rar',
    ).map((k) => c(k, 'ok', 'fine'));
    expect(summary(ok, 'ro')).toBe('Neverificat');
  });

  it('capitalises a lone problem part that starts lowercase', () => {
    expect(summary([c('photos', 'warning', 'neclare')], 'ro')).toBe(
      'Fotografii neclare',
    );
  });

  it('capitalises a unicode first letter', () => {
    expect(summary([c('address', 'warning', 'ă')], 'ro')).toMatch(/^A/);
  });

  it('puts failed before warning whatever the kind order', () => {
    const out = summary(
      [c('company', 'warning', 'nepotrivit'), c('photos', 'failed', 'lipsesc')],
      'ro',
    );
    expect(out).toBe('Fotografii lipsesc');
  });

  it('names rar before other kinds of the same severity', () => {
    const out = summary(
      [c('company', 'warning', 'x'), c('rar', 'warning', 'expirată')],
      'ro',
    );
    expect(out.startsWith('Autorizație RAR expirată')).toBe(true);
  });

  it('names the earlier kind first among equal-severity non-rar problems', () => {
    const out = summary(
      [c('photos', 'warning', 'b'), c('caen', 'warning', 'a')],
      'ro',
    );
    expect(out.toLowerCase()).toContain('a');
    expect(out).not.toContain('fotografii');
  });

  it('keeps at most two parts joined with a middle dot', () => {
    const all = VERIFICATION_CHECK_KINDS.map((k) => c(k, 'failed', 'x'));
    const out = summary([...all, c('company', 'ok')].slice(1), 'ro');
    expect(out.split(' · ').length).toBeLessThanOrEqual(2);
  });

  it('does not depend on the order of the input', () => {
    const a = [c('company', 'ok'), c('rar', 'ok'), c('photos', 'warning', 'z')];
    const b = [...a].reverse();
    expect(summary(b, 'ro')).toBe(summary(a, 'ro'));
  });

  it('does not mutate its input', () => {
    const input = [c('rar', 'ok'), c('company', 'ok')];
    const copy = JSON.parse(JSON.stringify(input));
    summary(input, 'ro');
    expect(input).toEqual(copy);
  });

  it('returns the same text when called twice', () => {
    const input = [c('company', 'ok'), c('photos', 'warning', 'neclare')];
    expect(summary(input, 'en')).toBe(summary(input, 'en'));
  });

  it('keeps the detail as typed, including unicode and inner spacing', () => {
    expect(summary([c('photos', 'warning', 'încă  neclare ț')], 'ro')).toBe(
      'Fotografii încă  neclare ț',
    );
  });

  it('shows a problem alone when the detail is null', () => {
    expect(summary([c('photos', 'warning', null)], 'ro').trim()).not.toBe(
      'Neverificat',
    );
  });

  it('shows rar failed text even when detail is present', () => {
    expect(summary([c('rar', 'failed', 'orice')], 'ro')).toBe(
      'Lipsește autorizația RAR',
    );
  });

  it('puts the rar failed text after company ok', () => {
    expect(summary([c('company', 'ok'), c('rar', 'failed')], 'ro')).toBe(
      'CUI verificat · lipsește autorizația RAR',
    );
  });

  it('does not report rar as verified when it is a warning', () => {
    const out = summary([c('rar', 'warning', 'expiră')], 'ro');
    expect(out).not.toContain('verificat');
  });

  it('handles duplicate kinds without throwing a wrong result for the clean case', () => {
    const out = summary([c('company', 'ok'), c('company', 'ok')], 'ro');
    expect(out).toBe('CUI verificat');
  });

  it('handles ten thousand checks', () => {
    const many = Array.from({ length: 10000 }, () => c('company', 'ok'));
    expect(summary(many, 'en')).toBe('Company ID checked');
  });
});

describe('RecordVerificationCheckDto', () => {
  it('accepts a bare ok result', async () => {
    expect(await errorsFor({ result: 'ok' })).toEqual([]);
  });

  // @traces 302-FR-007
  it('accepts a bare not_run result, as an untick sends', async () => {
    expect(await errorsFor({ result: 'not_run' })).toEqual([]);
  });

  it.each(['OK', '', null, 1, undefined])(
    'refuses result %p',
    async (result) => {
      const errors = await errorsFor({ result });
      expect(errors.map((e) => e.property)).toEqual(['result']);
    },
  );

  it('accepts a detail of exactly 200 characters', async () => {
    expect(
      await errorsFor({ detail: 'a'.repeat(200), result: 'warning' }),
    ).toEqual([]);
  });

  it('refuses a detail of 201 characters', async () => {
    const errors = await errorsFor({
      detail: 'a'.repeat(201),
      result: 'warning',
    });
    expect(errors.map((e) => e.property)).toEqual(['detail']);
  });

  it('trims the detail before counting its length', async () => {
    const dto = plainToInstance(RecordVerificationCheckDto, {
      detail: `  ${'a'.repeat(200)}  `,
      result: 'warning',
    });
    expect(dto.detail).toBe('a'.repeat(200));
    expect(await validate(dto)).toEqual([]);
  });

  it('refuses a detail of 201 characters after trimming', async () => {
    const errors = await errorsFor({
      detail: ` ${'a'.repeat(201)} `,
      result: 'warning',
    });
    expect(errors.map((e) => e.property)).toEqual(['detail']);
  });

  it('counts a long unicode detail by characters', async () => {
    expect(
      await errorsFor({ detail: 'ă'.repeat(200), result: 'warning' }),
    ).toEqual([]);
  });

  it('refuses a whitespace-only detail', async () => {
    const errors = await errorsFor({ detail: '   ', result: 'warning' });
    expect(errors.map((e) => e.property)).toEqual(['detail']);
  });

  it('refuses an empty detail', async () => {
    const errors = await errorsFor({ detail: '', result: 'ok' });
    expect(errors.map((e) => e.property)).toEqual(['detail']);
  });

  it('refuses a detail with control characters', async () => {
    const errors = await errorsFor({ detail: 'a\u0000b', result: 'warning' });
    expect(errors.map((e) => e.property)).toEqual(['detail']);
  });

  it.each([42, true, ['x'], { a: 1 }, null])(
    'refuses a non-string detail %p',
    async (detail) => {
      const errors = await errorsFor({ detail, result: 'ok' });
      expect(errors.map((e) => e.property)).toContain('detail');
    },
  );

  it('accepts a missing detail', async () => {
    expect(await errorsFor({ result: 'ok' })).toEqual([]);
  });

  it('accepts an empty activities list', async () => {
    expect(await errorsFor({ activities: [], result: 'ok' })).toEqual([]);
  });

  it('accepts a list of catalogue-shaped codes', async () => {
    expect(
      await errorsFor({ activities: ['mechanics', 'air_con'], result: 'ok' }),
    ).toEqual([]);
  });

  it.each([
    'mechanics',
    42,
    { 0: 'mechanics' },
    [1, 2],
    [null],
    [''],
    ['a'.repeat(41)],
    null,
  ])('refuses activities %p', async (activities) => {
    const errors = await errorsFor({ activities, result: 'ok' });
    expect(errors.map((e) => e.property)).toEqual(['activities']);
  });

  it('refuses a list of more than 50 activities', async () => {
    const errors = await errorsFor({
      activities: Array.from({ length: 51 }, () => 'mechanics'),
      result: 'ok',
    });
    expect(errors.map((e) => e.property)).toEqual(['activities']);
  });

  it('accepts a list of exactly 50 activities', async () => {
    expect(
      await errorsFor({
        activities: Array.from({ length: 50 }, () => 'mechanics'),
        result: 'ok',
      }),
    ).toEqual([]);
  });

  it('strips extra fields when validating with a whitelist', async () => {
    const dto = plainToInstance(RecordVerificationCheckDto, {
      kind: 'rar',
      recordedBy: 'someone',
      result: 'ok',
    });
    const errors = await validate(dto, { whitelist: true });
    expect(errors).toEqual([]);
    expect(dto).not.toHaveProperty('recordedBy');
    expect(dto).not.toHaveProperty('kind');
  });
});
