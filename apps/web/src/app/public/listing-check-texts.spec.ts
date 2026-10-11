import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { FieldProblem } from '@motor-fix/contracts';

import { textKey } from './listing-check-texts';

const texts = (language: 'ro' | 'en'): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      join(__dirname, `../../../../../libs/i18n/src/public/${language}.json`),
      'utf8',
    ),
  );

// The text under `public.<key>`, or undefined.
function lookUp(tree: Record<string, unknown>, key: string): unknown {
  return key
    .replace(/^public\./, '')
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      tree,
    );
}

// Every (field, code) of the data model's field table.
const PROBLEMS: FieldProblem[] = [
  ['email', 'required'],
  ['email', 'invalid'],
  ['steps.1.name', 'required'],
  ['steps.1.name', 'invalid'],
  ['steps.1.phone', 'required'],
  ['steps.1.phone', 'invalid'],
  ['steps.1.knownFor', 'required'],
  ['steps.1.knownFor', 'invalid'],
  ['steps.1.businessKind', 'required'],
  ['steps.1.mobileLegalForm', 'required'],
  ['steps.1.mobileLegalForm', 'invalid'],
  ['steps.2.brands', 'required'],
  ['steps.2.brands[0]', 'no_requests'],
  ...['labour', 'jobs[3]'].flatMap((row) =>
    ['from', 'to'].flatMap((end) =>
      ['required', 'integer', 'min', 'max', 'below_from', 'wide_range'].map(
        (code) => [`steps.3.${row}.${end}`, code],
      ),
    ),
  ),
  ['steps.3.jobs', 'required'],
  ['steps.3.jobs[1].name', 'invalid'],
  ['steps.4.mechanics[0].name', 'invalid'],
  ['files', 'required'],
  ['steps.5.place.address', 'required'],
  ['steps.5.place.lat', 'required'],
  ['steps.5.place.lat', 'invalid'],
  ['steps.5.place.radiusKm', 'invalid'],
  ['steps.5.hours', 'required'],
  ['steps.5.payments', 'required'],
  ['steps.5.courtesyCar.pricePerDayBani', 'required'],
  ['steps.5.courtesyCar.pricePerDayBani', 'invalid'],
  ['steps.6.cui', 'required'],
  ['steps.6.cui', 'invalid'],
  ['steps.6.cui', 'cui_in_use'],
  ['steps.6.rarNumber', 'required'],
  ['steps.6.rarNumber', 'invalid'],
  ['documents.onrc_certificate', 'document_missing'],
  ['documents.rar_authorisation', 'document_missing'],
  ['declaration', 'required'],
  ['declaration', 'invalid'],
].map(([field, code]) => ({ code, field }) as FieldProblem);

describe('textKey', () => {
  // @traces 115-listing-checklist-FR-012
  it.each(['ro', 'en'] as const)(
    'gives every field problem a text in %s',
    (language) => {
      const tree = texts(language);
      const missing = [false, true].flatMap((mobile) =>
        PROBLEMS.map((problem) => textKey(problem, mobile)).filter(
          (key) => typeof lookUp(tree, key) !== 'string',
        ),
      );

      expect(missing).toEqual([]);
    },
  );

  // @traces 115-listing-checklist-FR-006
  it('keeps the texts the steps already show', () => {
    const key = (field: string, code: string) => textKey({ code, field });

    expect(key('steps.1.phone', 'invalid')).toBe(
      'public.listing.details.phoneRomanian',
    );
    expect(key('steps.6.cui', 'invalid')).toBe('public.listing.cuiInvalid');
    expect(key('steps.6.rarNumber', 'invalid')).toBe('public.listing.rarShort');
    expect(key('steps.5.place.lat', 'invalid')).toBe(
      'public.listing.place.outside',
    );
    expect(key('steps.5.payments', 'required')).toBe(
      'public.listing.hours.payment.needed',
    );
    expect(key('steps.2.brands[4]', 'no_requests')).toBe(
      'public.listing.brands.noRequests',
    );
  });

  // @traces 115-listing-checklist-FR-012
  it('reads a row by its pattern, whatever its index', () => {
    expect(textKey({ code: 'below_from', field: 'steps.3.jobs[12].to' })).toBe(
      'public.listing.prices.errors.below_from',
    );
    expect(textKey({ code: 'wide_range', field: 'steps.3.labour.to' })).toBe(
      'public.listing.prices.wideRange',
    );
    expect(
      textKey({ code: 'invalid', field: 'steps.4.mechanics[7].name' }),
    ).toBe('public.listing.mechanics.nameNeeded');
  });

  // @traces 115-listing-checklist-FR-012
  it('falls back to the code for a field it does not know', () => {
    expect(textKey({ code: 'required', field: 'steps.9.new' })).toBe(
      'public.listing.check.required',
    );
    expect(textKey({ code: 'odd', field: 'steps.9.new' })).toBe(
      'public.listing.check.invalid',
    );
  });

  // @traces 115-listing-checklist-FR-003
  it('names the registered seat for a mobile mechanic', () => {
    const address = { code: 'required', field: 'steps.5.place.address' };

    expect(textKey(address, true)).toBe(
      'public.listing.check.seatAddressNeeded',
    );
    expect(textKey(address)).toBe('public.listing.check.addressNeeded');
  });
});
