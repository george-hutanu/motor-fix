import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  RECHECK_DUE_AFTER_DAYS,
  RECHECK_MAX_AGE_DAYS,
  RecordRecheckDto,
} from './rechecks.dto';

// @traces 1351-FR-002 1351-FR-004

const OK = {
  activities: ['mechanics', 'brakes'],
  checkedOn: '2026-10-01',
  lastCheckedOn: '2026-09-03',
  result: 'ok',
};
const FAILED = {
  checkedOn: '2026-10-01',
  detail: 'expirată pe 12 sept. 2026',
  failure: 'expired',
  lastCheckedOn: '2026-09-03',
  result: 'failed',
};

const read = (plain: unknown) => plainToInstance(RecordRecheckDto, plain);
const errorsFor = (plain: unknown) => validate(read(plain));
const fields = async (plain: unknown) =>
  (await errorsFor(plain)).map((e) => e.property);

describe('the re-check rule constants', () => {
  it('make a garage due after 28 days and overdue after 31', () => {
    expect(RECHECK_DUE_AFTER_DAYS).toBe(28);
    expect(RECHECK_MAX_AGE_DAYS).toBe(31);
  });
});

describe('RecordRecheckDto', () => {
  it('accepts a valid re-check with its date and activities', async () => {
    expect(await errorsFor(OK)).toEqual([]);
  });

  it('accepts a valid re-check that narrows to no activity', async () => {
    expect(await errorsFor({ ...OK, activities: [] })).toEqual([]);
  });

  it('accepts a garage that never had a date of last check', async () => {
    expect(await errorsFor({ ...OK, lastCheckedOn: null })).toEqual([]);
  });

  it.each(['expired', 'suspended', 'withdrawn'])(
    'accepts a failure %s with a detail',
    async (failure) => {
      expect(await errorsFor({ ...FAILED, failure })).toEqual([]);
    },
  );

  it.each([
    ['one character', 'a'],
    ['200 characters', 'ș'.repeat(200)],
  ])('accepts a detail of %s on a failure', async (_, detail) => {
    expect(await errorsFor({ ...FAILED, detail })).toEqual([]);
  });

  it('trims the detail', () => {
    expect(read({ ...FAILED, detail: '  expirată \n' }).detail).toBe(
      'expirată',
    );
  });

  // Whether a detail belongs, and its length, are the use case's 422.
  it.each([
    ['a detail on a valid result', { ...OK, detail: 'totul în regulă' }],
    ['a failure without a detail', { ...FAILED, detail: undefined }],
    ['a failure with an empty detail', { ...FAILED, detail: '' }],
    ['a detail of 201 characters', { ...FAILED, detail: 'a'.repeat(201) }],
  ])('leaves %s to the use case', async (_, body) => {
    expect(await fields(body)).not.toContain('detail');
  });

  it('refuses a detail that is not text', async () => {
    expect(await fields({ ...FAILED, detail: 42 })).toContain('detail');
  });

  it('refuses a failure kind sent with a valid result', async () => {
    expect(await fields({ ...OK, failure: 'expired' })).toContain('failure');
  });

  it.each([
    ['no failure kind', { ...FAILED, failure: undefined }, 'failure'],
    ['an unknown failure kind', { ...FAILED, failure: 'lost' }, 'failure'],
    [
      'a control character',
      { ...FAILED, detail: 'RAR\u0007 expirat' },
      'detail',
    ],
    ['activities', { ...FAILED, activities: ['brakes'] }, 'activities'],
  ])('refuses a failure with %s', async (_, body, field) => {
    expect(await fields(body)).toContain(field);
  });

  it.each([
    ['no result', { ...OK, result: undefined }, 'result'],
    ['an unknown result', { ...OK, result: 'warning' }, 'result'],
    ['no activities', { ...OK, activities: undefined }, 'activities'],
    ['an activity that is not text', { ...OK, activities: [42] }, 'activities'],
    ['an empty activity code', { ...OK, activities: [''] }, 'activities'],
    [
      'an activity code over 40 characters',
      { ...OK, activities: ['a'.repeat(41)] },
      'activities',
    ],
  ])('refuses a valid result with %s', async (_, body, field) => {
    expect(await fields(body)).toContain(field);
  });

  it.each([
    ['no date', undefined],
    ['a day that does not exist', '2026-02-30'],
    ['a month that does not exist', '2026-13-01'],
    ['a day without its leading zero', '2026-10-1'],
    ['the Romanian order', '01.10.2026'],
    ['a date with a time', '2026-10-01T09:00:00Z'],
    ['a number', 20261001],
  ])('refuses %s as the date checked', async (_, checkedOn) => {
    expect(await fields({ ...OK, checkedOn })).toContain('checkedOn');
  });

  it.each([
    ['a day that does not exist', '2026-02-30'],
    ['a date with a time', '2026-09-03T00:00:00Z'],
    ['no field at all', undefined],
  ])(
    'refuses %s as the date of last check the row showed',
    async (_, lastCheckedOn) => {
      expect(await fields({ ...OK, lastCheckedOn })).toContain('lastCheckedOn');
    },
  );
});
