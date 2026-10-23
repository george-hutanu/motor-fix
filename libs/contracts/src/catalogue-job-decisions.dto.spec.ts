import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CAR_SYSTEM_LABELS, CAR_SYSTEMS } from './car-systems';
import {
  ApproveCatalogueJobDto,
  RejectCatalogueJobDto,
} from './catalogue-job-decisions.dto';

const strict = { forbidNonWhitelisted: true, whitelist: true };
const problemsOf = async (type: new () => object, plain: object) =>
  (await validate(plainToInstance(type, plain), strict)).map(
    (error) => error.property,
  );

// @traces 414-FR-003
describe('the body of an approval', () => {
  const body = {
    carSystem: 'engine',
    nameEn: 'Injector reconditioning',
    nameRo: 'Recondiționare injectoare',
  };
  const approve = (values: object) =>
    problemsOf(ApproveCatalogueJobDto, { ...body, ...values });

  it('takes both names and a system, with or without a RAR activity', async () => {
    expect(await approve({})).toEqual([]);
    expect(await approve({ rarActivity: 'mechanical' })).toEqual([]);
  });

  it('trims both names before measuring them', async () => {
    const dto = plainToInstance(ApproveCatalogueJobDto, {
      ...body,
      nameEn: '  Abc ',
      nameRo: ' Ulei  ',
    });

    expect([dto.nameRo, dto.nameEn]).toEqual(['Ulei', 'Abc']);
    expect(await validate(dto, strict)).toEqual([]);
  });

  it('takes a name of exactly 3 and of exactly 80 characters, counted in code points', async () => {
    expect(await approve({ nameEn: 'é'.repeat(80), nameRo: 'Abc' })).toEqual(
      [],
    );
  });

  it.each([
    ['nameRo', 'missing', undefined],
    ['nameRo', 'of two characters after trimming', ' Ab '],
    ['nameRo', 'over 80 characters', 'x'.repeat(81)],
    ['nameRo', 'with a control character', 'Ulei\u0007motor'],
    ['nameEn', 'missing', undefined],
    ['nameEn', 'of two characters after trimming', 'Ab'],
    ['nameEn', 'over 80 characters', 'y'.repeat(81)],
    ['nameEn', 'that is not text', 42],
  ])('refuses %s %s', async (field, _, value) => {
    expect(await approve({ [field]: value })).toEqual([field]);
  });

  it('takes every system of the list and refuses any other or none', async () => {
    for (const carSystem of CAR_SYSTEMS) {
      expect(await approve({ carSystem })).toEqual([]);
    }
    expect(await approve({ carSystem: 'rocket' })).toEqual(['carSystem']);
    expect(await approve({ carSystem: undefined })).toEqual(['carSystem']);
  });

  it('refuses a RAR activity that is not text or over 120 characters', async () => {
    expect(await approve({ rarActivity: 7 })).toEqual(['rarActivity']);
    expect(await approve({ rarActivity: 'r'.repeat(121) })).toEqual([
      'rarActivity',
    ]);
  });

  it('refuses an unknown field', async () => {
    expect(await approve({ status: 'approved' })).toEqual(['status']);
  });
});

// @traces 414-FR-004
describe('the body of a rejection', () => {
  const reject = (reason: unknown) =>
    problemsOf(RejectCatalogueJobDto, { reason });

  it('takes a reason of 10 to 500 characters after trimming', async () => {
    expect(await reject('  Nu e clar.  ')).toEqual([]);
    expect(await reject('ă'.repeat(500))).toEqual([]);
  });

  it.each([
    ['a missing reason', undefined],
    ['a reason of 9 characters after trimming', '  Prea pu  '],
    ['a reason of 501 characters', 'a'.repeat(501)],
    ['a reason that is not text', 1234567890],
  ])('refuses %s', async (_, reason) => {
    expect(await reject(reason)).toEqual(['reason']);
  });
});

// @traces 414-FR-003
describe('the car systems', () => {
  it('are the nine keys, each with a Romanian and an English label', () => {
    expect(CAR_SYSTEMS).toEqual([
      'engine',
      'transmission',
      'brakes',
      'suspension_steering',
      'electrical',
      'air_con',
      'body',
      'tyres_wheels',
      'general',
    ]);
    for (const key of CAR_SYSTEMS) {
      expect(CAR_SYSTEM_LABELS[key].ro).toEqual(expect.any(String));
      expect(CAR_SYSTEM_LABELS[key].en).toEqual(expect.any(String));
    }
  });
});
