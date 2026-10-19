import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  RECHECK_DUE_AFTER_DAYS,
  RECHECK_MAX_AGE_DAYS,
  RecordRecheckDto,
} from './rechecks.dto';

const problems = (dto: object) =>
  validateSync(dto, { forbidNonWhitelisted: true, whitelist: true })
    .map((e) => e.property)
    .sort();

const ok = {
  activities: ['mechanics'],
  checkedOn: '2026-10-01',
  lastCheckedOn: '2026-09-01',
  result: 'ok',
};
const failed = {
  checkedOn: '2026-10-01',
  detail: 'not in the register',
  failure: 'expired',
  lastCheckedOn: null,
  result: 'failed',
};
const dto = (body: Record<string, unknown>) =>
  plainToInstance(RecordRecheckDto, body);
const without = (body: Record<string, unknown>, key: string) => {
  const { [key]: _gone, ...rest } = body;
  return rest;
};

// @traces 1351-FR-001
describe('the due thresholds', () => {
  it('are 28 and 31 days', () => {
    expect([RECHECK_DUE_AFTER_DAYS, RECHECK_MAX_AGE_DAYS]).toEqual([28, 31]);
  });
});

// @traces 1351-FR-004
describe('RecordRecheckDto under hostile input', () => {
  it('accepts a plain valid and a plain failed re-check', () => {
    expect(problems(dto(ok))).toEqual([]);
    expect(problems(dto(failed))).toEqual([]);
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['upper case', 'OK'],
    ['unknown', 'pending'],
    ['a number', 1],
    ['an array', ['ok']],
  ])('refuses a result that is %s', (_, result) => {
    expect(problems(dto({ ...ok, result }))).toContain('result');
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['an empty string', ''],
    ['a month 13', '2026-13-01'],
    ['a 30 February', '2026-02-30'],
    ['a day 00', '2026-10-00'],
    ['unpadded', '2026-1-1'],
    ['a timestamp', '2026-10-01T00:00:00Z'],
    ['padded with a space', ' 2026-10-01'],
    ['a number', 20261001],
    ['an array', ['2026-10-01']],
  ])('refuses a date checked that is %s', (_, checkedOn) => {
    expect(problems(dto({ ...ok, checkedOn }))).toContain('checkedOn');
  });

  it('accepts 29 February of a leap year and refuses it otherwise', () => {
    expect(problems(dto({ ...ok, checkedOn: '2028-02-29' }))).toEqual([]);
    expect(problems(dto({ ...ok, checkedOn: '2027-02-29' }))).toEqual([
      'checkedOn',
    ]);
  });

  it.each([
    ['missing', undefined],
    ['an empty string', ''],
    ['a malformed day', '2026-02-30'],
    ['a number', 0],
  ])('refuses a carried date of last check that is %s', (_, lastCheckedOn) => {
    expect(problems(dto({ ...ok, lastCheckedOn }))).toEqual(['lastCheckedOn']);
  });

  it('accepts a null carried date of last check', () => {
    expect(problems(dto({ ...ok, lastCheckedOn: null }))).toEqual([]);
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['unknown', 'revoked'],
    ['upper case', 'EXPIRED'],
    ['an array', ['expired']],
  ])('refuses a failure that is %s on a failed result', (_, failure) => {
    expect(problems(dto({ ...failed, failure }))).toContain('failure');
  });

  it.each(['expired', 'suspended', 'withdrawn'])(
    'accepts the failure %s',
    (failure) => {
      expect(problems(dto({ ...failed, failure }))).toEqual([]);
    },
  );

  it('refuses a failure sent with a valid result', () => {
    expect(problems(dto({ ...ok, failure: 'expired' }))).toContain('failure');
  });

  it('refuses a null failure sent with a valid result', () => {
    expect(problems(dto({ ...ok, failure: null }))).toContain('failure');
  });

  it('refuses activities sent with a failed result, even an empty list', () => {
    expect(problems(dto({ ...failed, activities: [] }))).toContain(
      'activities',
    );
    expect(problems(dto({ ...failed, activities: ['mechanics'] }))).toContain(
      'activities',
    );
  });

  it('requires activities on a valid result', () => {
    expect(problems(dto(without(ok, 'activities')))).toContain('activities');
  });

  it.each([
    ['null', null],
    ['a string', 'mechanics'],
    ['an object', { 0: 'mechanics' }],
    ['numbers', [1]],
    ['null entries', [null]],
    ['an empty code', ['']],
    ['a 41 character code', ['x'.repeat(41)]],
    ['a nested list', [['mechanics']]],
  ])('refuses activities that are %s', (_, activities) => {
    expect(problems(dto({ ...ok, activities }))).toContain('activities');
  });

  it('accepts a 40 character code', () => {
    expect(problems(dto({ ...ok, activities: ['x'.repeat(40)] }))).toEqual([]);
  });

  it('trims the detail', () => {
    expect(dto({ ...failed, detail: '  gone  ' }).detail).toBe('gone');
  });

  it.each([
    ['a newline', 'line one\nline two'],
    ['a tab', 'a\tb'],
    ['a null byte', 'a\u0000b'],
    ['an escape', 'a\u001bb'],
    ['a carriage return', 'a\rb'],
  ])('refuses a detail holding %s', (_, detail) => {
    expect(problems(dto({ ...failed, detail }))).toContain('detail');
  });

  it.each([
    ['a number', 7],
    ['null', null],
    ['an array', ['x']],
    ['an object', { a: 1 }],
  ])('refuses a detail that is %s', (_, detail) => {
    expect(problems(dto({ ...failed, detail }))).toContain('detail');
  });

  it('accepts a Romanian and an emoji detail', () => {
    expect(
      problems(dto({ ...failed, detail: 'Autorizație retrasă țșăîâ 🚗' })),
    ).toEqual([]);
  });

  it.each(['automatic', 'recordedBy', 'id', 'garageId', 'status'])(
    'refuses the extra field %s',
    (extra) => {
      expect(problems(dto({ ...ok, [extra]: true }))).toContain(extra);
    },
  );

  it('keeps a __proto__ key from reaching the result', () => {
    const parsed = dto(
      JSON.parse(
        `{"__proto__":{"result":"failed"},"result":"ok","checkedOn":"2026-10-01","lastCheckedOn":null,"activities":["a"]}`,
      ),
    );
    expect(parsed.result).toBe('ok');
    expect(problems(parsed)).toEqual([]);
  });
});
