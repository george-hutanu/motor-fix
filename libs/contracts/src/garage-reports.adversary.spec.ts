import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  CreateGarageReportDto,
  GARAGE_REPORT_TEXT_MAX,
  GARAGE_REPORT_TEXT_MIN,
} from './garage-reports';

// @traces 312-FR-005

const errorsFor = (plain: unknown) =>
  validate(plainToInstance(CreateGarageReportDto, plain));

describe('CreateGarageReportDto', () => {
  it('keeps the rule at 20 to 1,000 characters', () => {
    expect([GARAGE_REPORT_TEXT_MIN, GARAGE_REPORT_TEXT_MAX]).toEqual([
      20, 1000,
    ]);
  });

  it.each([
    ['20 characters', 'a'.repeat(20)],
    ['1,000 characters', 'ș'.repeat(1000)],
    ['19 letters and a trailing space', `${'a'.repeat(19)} `],
    ['only whitespace', ' '.repeat(25)],
  ])('accepts %s', async (_, text) => {
    expect(await errorsFor({ text })).toEqual([]);
  });

  it.each([
    ['19 characters', 'a'.repeat(19)],
    ['1,001 characters', 'a'.repeat(1001)],
    ['an empty text', ''],
    ['a number', 1234567890],
    ['an array', ['a'.repeat(30)]],
    ['null', null],
  ])('refuses %s', async (_, text) => {
    const errors = await errorsFor({ text });

    expect(errors.map((e) => e.property)).toEqual(['text']);
  });

  it('refuses a body with no text', async () => {
    expect((await errorsFor({})).map((e) => e.property)).toEqual(['text']);
  });
});
