import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CAR_SYSTEMS } from './car-systems';
import {
  ApproveCatalogueJobDto,
  RejectCatalogueJobDto,
} from './catalogue-job-decisions.dto';

const strict = { forbidNonWhitelisted: true, whitelist: true };
const problemsOf = async (type: new () => object, plain: unknown) =>
  (await validate(plainToInstance(type, plain as object), strict)).map(
    (error) => error.property,
  );

const base = {
  carSystem: 'engine',
  nameEn: 'Injector reconditioning',
  nameRo: 'Recondiționare injectoare',
};
const approve = (values: object) =>
  problemsOf(ApproveCatalogueJobDto, { ...base, ...values });
const reject = (reason: unknown) =>
  problemsOf(RejectCatalogueJobDto, { reason });

const EMOJI = '\u{1F600}';

// @traces 414-FR-003
describe('the approval body under hostile names', () => {
  it('counts an emoji as one character, so 80 emoji pass', async () => {
    expect(await approve({ nameRo: EMOJI.repeat(80) })).toEqual([]);
  });

  it('refuses 81 emoji as over 80 characters', async () => {
    expect(await approve({ nameRo: EMOJI.repeat(81) })).toEqual(['nameRo']);
  });

  it('refuses two emoji as under 3 characters', async () => {
    expect(await approve({ nameEn: EMOJI.repeat(2) })).toEqual(['nameEn']);
  });

  it('takes three emoji as exactly 3 characters', async () => {
    expect(await approve({ nameEn: EMOJI.repeat(3) })).toEqual([]);
  });

  it.each([
    ['spaces', '          '],
    ['non-breaking spaces', '    '],
    ['an ideographic space', '　　　　'],
    ['a line separator', '    '],
  ])('refuses a name of only %s', async (_, name) => {
    expect(await approve({ nameEn: name, nameRo: name })).toEqual([
      'nameRo',
      'nameEn',
    ]);
  });

  it.each([
    ['a tab', 'Ulei\tmotor'],
    ['a newline', 'Ulei\nmotor'],
    ['a NUL', 'Ulei\u0000motor'],
    ['a DEL', 'Ulei\u007fmotor'],
    ['a C1 control', 'Ulei\u0085motor'],
  ])('refuses a name with %s inside', async (_, name) => {
    expect(await approve({ nameRo: name })).toEqual(['nameRo']);
  });

  it('refuses a name made only of zero-width spaces', async () => {
    expect(await approve({ nameRo: '​​​​' })).toEqual(['nameRo']);
  });

  it.each([null, ['Abc'], { a: 1 }, true, 12345])(
    'refuses the name %j that is not text',
    async (value) => {
      expect(await approve({ nameEn: value, nameRo: value })).toEqual([
        'nameRo',
        'nameEn',
      ]);
    },
  );

  it('measures after trimming, so 80 characters padded with spaces pass', async () => {
    expect(await approve({ nameRo: `   ${'a'.repeat(80)}   ` })).toEqual([]);
  });
});

// @traces 414-FR-003
describe('the approval body under hostile systems and activities', () => {
  it.each([
    'Engine',
    ' engine',
    'engine ',
    'engine\n',
    'ENGINE',
    '',
    'constructor',
    '__proto__',
    'toString',
    'hasOwnProperty',
    'tyres-wheels',
    'motor',
  ])('refuses the system %j', async (carSystem) => {
    expect(await approve({ carSystem })).toEqual(['carSystem']);
  });

  it.each([null, ['engine'], { 0: 'engine' }, 0, true])(
    'refuses the system %j that is not a key',
    async (carSystem) => {
      expect(await approve({ carSystem })).toEqual(['carSystem']);
    },
  );

  it('takes a RAR activity of exactly 120 characters and refuses 121', async () => {
    expect(await approve({ rarActivity: 'r'.repeat(120) })).toEqual([]);
    expect(await approve({ rarActivity: 'r'.repeat(121) })).toEqual([
      'rarActivity',
    ]);
  });

  it.each([
    ['an array', ['mechanical']],
    ['an object', { code: 'm' }],
    ['a boolean', false],
  ])('refuses a RAR activity given as %s', async (_, rarActivity) => {
    expect(await approve({ rarActivity })).toEqual(['rarActivity']);
  });

  it('refuses a null RAR activity, as absent is the only way to say none', async () => {
    expect(await approve({ rarActivity: null })).toEqual(['rarActivity']);
  });

  it('refuses extra fields beside the four', async () => {
    expect(await approve({ decidedBy: 'x', status: 'approved' })).toEqual([
      'decidedBy',
      'status',
    ]);
  });

  it('refuses an empty body with every required field named', async () => {
    expect(await problemsOf(ApproveCatalogueJobDto, {})).toEqual([
      'nameRo',
      'nameEn',
      'carSystem',
    ]);
  });

  it('keeps the nine keys the dialog and the contract share', () => {
    expect(CAR_SYSTEMS).toHaveLength(9);
    expect(new Set(CAR_SYSTEMS).size).toBe(9);
  });
});

// @traces 414-FR-004
describe('the rejection body under hostile reasons', () => {
  it('counts an emoji as one character, so 500 emoji pass and 501 do not', async () => {
    expect(await reject(EMOJI.repeat(500))).toEqual([]);
    expect(await reject(EMOJI.repeat(501))).toEqual(['reason']);
  });

  it('takes ten emoji as exactly 10 characters and refuses nine', async () => {
    expect(await reject(EMOJI.repeat(10))).toEqual([]);
    expect(await reject(EMOJI.repeat(9))).toEqual(['reason']);
  });

  it('measures after trimming at both ends of the range', async () => {
    expect(await reject(`  ${'a'.repeat(500)}  `)).toEqual([]);
    expect(await reject(`  ${'a'.repeat(9)}  `)).toEqual(['reason']);
  });

  it.each([
    ['spaces', ' '.repeat(600)],
    ['tabs and newlines', '\t\n\r '.repeat(10)],
    ['non-breaking spaces', ' '.repeat(20)],
    ['ideographic spaces', '　'.repeat(20)],
  ])('refuses a reason of only %s', async (_, reason) => {
    expect(await reject(reason)).toEqual(['reason']);
  });

  it('refuses a reason of only zero-width spaces', async () => {
    expect(await reject('​'.repeat(20))).toEqual(['reason']);
  });

  it('takes a reason that runs over several lines', async () => {
    expect(await reject('Prima linie.\nA doua linie.')).toEqual([]);
  });

  it('refuses a reason holding a NUL, which the database cannot store', async () => {
    expect(await reject('Motiv valid\u0000 cu NUL inauntru')).toEqual([
      'reason',
    ]);
  });

  it.each([null, ['Un motiv destul de lung'], { a: 1 }, true])(
    'refuses the reason %j that is not text',
    async (reason) => {
      expect(await reject(reason)).toEqual(['reason']);
    },
  );

  it('refuses extra fields beside the reason', async () => {
    expect(
      await problemsOf(RejectCatalogueJobDto, {
        reason: 'Un motiv destul de lung',
        status: 'approved',
      }),
    ).toEqual(['status']);
  });
});
