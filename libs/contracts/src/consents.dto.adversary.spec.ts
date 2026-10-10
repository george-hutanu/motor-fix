import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { ANALYTICS_CONSENT_VERSION } from './consent';
import { RecordConsentDto } from './consents.dto';

const failed = (body: Record<string, unknown>) =>
  validateSync(plainToInstance(RecordConsentDto, body), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).map((error) => error.property);

const valid = {
  at: '2026-10-10T09:30:00.000Z',
  browserConsentId: '0b9f3c1e-6a43-4c55-9d1c-6f3f1b7d2a10',
  decision: 'granted',
  language: 'ro',
  textVersion: ANALYTICS_CONSENT_VERSION,
};

describe('RecordConsentDto under hostile input', () => {
  // @traces 244-FR-009
  it.each([
    ['null', null],
    ['a number', 7],
    ['an array', ['granted']],
    ['an object', { v: 'granted' }],
    ['upper case', 'GRANTED'],
    ['padded', ' granted'],
    ['empty', ''],
  ])('refuses a decision that is %s', (_, decision) => {
    expect(failed({ ...valid, decision })).toEqual(['decision']);
  });

  // @traces 244-FR-009
  it.each([
    ['upper case', 'RO'],
    ['padded', 'ro '],
    ['null', null],
    ['an array', ['ro']],
    ['a locale tag', 'ro-RO'],
    ['empty', ''],
  ])('refuses a language that is %s', (_, language) => {
    expect(failed({ ...valid, language })).toEqual(['language']);
  });

  // @traces 244-FR-009
  it.each([
    ['padded', ` ${ANALYTICS_CONSENT_VERSION}`],
    ['a prefix', ANALYTICS_CONSENT_VERSION.slice(0, 7)],
    ['a suffix', `${ANALYTICS_CONSENT_VERSION}x`],
    ['an array holding it', [ANALYTICS_CONSENT_VERSION]],
    ['null', null],
    ['a number', 20261010],
  ])('refuses a text version that is %s', (_, textVersion) => {
    expect(failed({ ...valid, textVersion })).toEqual(['textVersion']);
  });

  // @traces 244-FR-009
  it.each([
    ['braced', '{0b9f3c1e-6a43-4c55-9d1c-6f3f1b7d2a10}'],
    ['no dashes', '0b9f3c1e6a434c559d1c6f3f1b7d2a10'],
    ['padded', ' 0b9f3c1e-6a43-4c55-9d1c-6f3f1b7d2a10'],
    ['sql', "'; DROP TABLE consent_record;--"],
    ['an array', ['0b9f3c1e-6a43-4c55-9d1c-6f3f1b7d2a10']],
    ['null', null],
    ['a number', 1],
    ['256 characters', 'a'.repeat(256)],
  ])('refuses a browser id that is %s', (_, browserConsentId) => {
    expect(failed({ ...valid, browserConsentId })).toEqual([
      'browserConsentId',
    ]);
  });

  // @traces 244-FR-009
  it.each([
    ['an impossible day', '2026-02-30T09:00:00.000Z'],
    ['an hour 25', '2026-10-10T25:00:00.000Z'],
    ['an epoch number', 1_760_000_000_000],
    ['null', null],
    ['an array holding a date', ['2026-10-10T09:30:00.000Z']],
    ['a Date object string with words', 'Sat Oct 10 2026 09:30:00 GMT+0000'],
    ['a date only', '2026-10-10'],
    ['a time without a date', '09:30:00Z'],
    ['no zone', '2026-10-10T09:30:00'],
    ['a week date', '2026-W41-6T09:30:00Z'],
    ['an ordinal date', '2026-283T09:30:00Z'],
  ])('refuses a time that is %s', (_, at) => {
    expect(failed({ ...valid, at })).toEqual(['at']);
  });

  // @traces 244-FR-009
  it('refuses a body whose browser id uses a fullwidth digit look-alike', () => {
    expect(
      failed({
        ...valid,
        browserConsentId: '０b9f3c1e-6a43-4c55-9d1c-6f3f1b7d2a10',
      }),
    ).toEqual(['browserConsentId']);
  });

  // @traces 244-FR-009
  it('refuses every field at once with one error per field', () => {
    expect(failed({}).sort()).toEqual(
      ['at', 'browserConsentId', 'decision', 'language', 'textVersion'].sort(),
    );
  });

  // @traces 244-FR-009
  it.each(['accountId', 'kind', 'id', 'ip', 'subjectId'])(
    'refuses an extra %s field',
    (field) => {
      expect(failed({ ...valid, [field]: 'x' })).toEqual([field]);
    },
  );
});
