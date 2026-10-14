import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { FieldProblem } from '@motor-fix/contracts';

import { textKey } from './listing-check-texts';

const tree = (language: 'ro' | 'en'): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      join(__dirname, `../../../../../libs/i18n/src/public/${language}.json`),
      'utf8',
    ),
  );

const has = (root: Record<string, unknown>, key: string) =>
  key
    .replace(/^public\./, '')
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      root,
    );

const key = (field: string, code: string, mobile?: boolean) =>
  textKey({ code, field } as FieldProblem, mobile);

describe('textKey on hostile problems', () => {
  // @traces 115-FR-012
  it.each([
    ['__proto__', 'required'],
    ['constructor', 'invalid'],
    ['toString', 'required'],
    ['hasOwnProperty:x', 'required'],
    ['', 'required'],
  ])('falls back per code for the field %j', (field, code) => {
    expect(key(field, code)).toBe(
      `public.listing.check.${code === 'required' ? 'required' : 'invalid'}`,
    );
  });

  // @traces 115-FR-012
  it.each(['', 'surprise', 'constructor', '__proto__', 'REQUIRED'])(
    'reads the code %j on a known field as invalid',
    (code) => {
      expect(key('steps.1.name', code)).toBe('public.listing.check.invalid');
    },
  );

  // @traces 115-FR-012
  it('reads a multi-digit row index like a single digit', () => {
    expect(key('steps.3.jobs[123].name', 'invalid')).toBe(
      key('steps.3.jobs[0].name', 'invalid'),
    );
    expect(key('steps.4.mechanics[12].name', 'invalid')).toBe(
      key('steps.4.mechanics[0].name', 'invalid'),
    );
    expect(key('steps.2.brands[40]', 'no_requests')).toBe(
      key('steps.2.brands[0]', 'no_requests'),
    );
  });

  // @traces 115-FR-012
  it('gives each range code on a job row its own range text', () => {
    for (const code of ['integer', 'min', 'max', 'below_from', 'required'])
      expect(key('steps.3.jobs[7].to', code)).toBe(
        `public.listing.prices.errors.${code}`,
      );
    expect(key('steps.3.jobs[7].to', 'wide_range')).toBe(
      'public.listing.prices.wideRange',
    );
    expect(key('steps.3.labour.to', 'wide_range')).toBe(
      'public.listing.prices.wideRange',
    );
  });

  // @traces 115-FR-003
  it('uses the seat texts only for a mobile mechanic and only on the place', () => {
    expect(key('steps.5.place.address', 'required', true)).not.toBe(
      key('steps.5.place.address', 'required', false),
    );
    expect(key('steps.5.place.lat', 'required', true)).not.toBe(
      key('steps.5.place.lat', 'required', false),
    );
    expect(key('steps.1.name', 'required', true)).toBe(
      key('steps.1.name', 'required', false),
    );
    expect(key('steps.5.place.radiusKm', 'invalid', true)).toBe(
      key('steps.5.place.radiusKm', 'invalid', false),
    );
  });

  // @traces 115-FR-012
  it('keeps the wrong-position text for a mobile seat outside Romania', () => {
    expect(key('steps.5.place.lat', 'invalid', true)).toBe(
      'public.listing.place.outside',
    );
  });
});

describe('every key textKey can return exists in both languages', () => {
  const fields = [
    'email',
    'files',
    'declaration',
    'documents.onrc_certificate',
    'documents.rar_authorisation',
    'steps.1.name',
    'steps.1.phone',
    'steps.1.knownFor',
    'steps.1.businessKind',
    'steps.1.mobileLegalForm',
    'steps.2.brands',
    'steps.2.brands[3]',
    'steps.3.labour.from',
    'steps.3.labour.to',
    'steps.3.jobs',
    'steps.3.jobs[2].from',
    'steps.3.jobs[2].to',
    'steps.3.jobs[2].name',
    'steps.4.mechanics[11].name',
    'steps.5.place.address',
    'steps.5.place.lat',
    'steps.5.place.radiusKm',
    'steps.5.hours',
    'steps.5.payments',
    'steps.5.courtesyCar.pricePerDayBani',
    'steps.6.cui',
    'steps.6.rarNumber',
  ];
  const codes = [
    'required',
    'invalid',
    'integer',
    'min',
    'max',
    'below_from',
    'wide_range',
    'no_requests',
    'document_missing',
    'cui_in_use',
  ];
  const rangeEnd = /^steps\.3\.(labour|jobs\[\d+\])\.(from|to)$/;
  const rangeCodes = [
    'required',
    'integer',
    'min',
    'max',
    'below_from',
    'wide_range',
  ];
  const combos = fields.flatMap((field) =>
    codes
      .filter((code) => !rangeEnd.test(field) || rangeCodes.includes(code))
      .flatMap(
        (code) =>
          [
            [field, code, false],
            [field, code, true],
          ] as const,
      ),
  );

  // @traces 115-FR-012
  it.each(['ro', 'en'] as const)('in %s', (language) => {
    const root = tree(language);
    const missing = combos
      .map(([field, code, mobile]) => key(field, code, mobile))
      .filter((k) => typeof has(root, k) !== 'string');
    expect([...new Set(missing)]).toEqual([]);
  });
});
