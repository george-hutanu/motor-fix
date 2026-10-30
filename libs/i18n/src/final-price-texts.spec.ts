import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Language = 'ro' | 'en';
type Texts = Record<string, unknown>;

// Read from the files, not through I18n.t, which falls back to Romanian and
// would hide a text missing in English.
const bundle = (area: string, language: Language): Texts =>
  JSON.parse(readFileSync(join(__dirname, area, `${language}.json`), 'utf8'));

const at = (texts: Texts, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>((node, key) => (node as Texts | undefined)?.[key], texts);

// The refusals of the handover and the correction, in the words the spec
// gives them, for the Predare dialog to show by code.
// @traces 406-FR-002 406-FR-005
// @traces 1393-FR-007
describe('the final price refusals', () => {
  it.each([
    ['ro', 'job_not_done', 'Marchează întâi lucrarea ca gata'],
    ['en', 'job_not_done', 'Mark the job as done first'],
    ['ro', 'correction_window_closed', 'Prețul final nu mai poate fi corectat'],
    [
      'en',
      'correction_window_closed',
      'The final price can no longer be corrected',
    ],
    ['ro', 'already_handed_over', 'Prețul final a fost deja înregistrat'],
    ['en', 'already_handed_over', 'The final price is already recorded'],
    ['ro', 'not_handed_over', 'Lucrarea nu a fost încă predată'],
    ['en', 'not_handed_over', 'The job has not been handed over yet'],
    [
      'ro',
      'forbidden',
      'Doar proprietarul și recepția înregistrează prețul final',
    ],
    [
      'en',
      'forbidden',
      'Only the owner and the front desk record the final price',
    ],
  ] as const)('%s %s reads as the spec gives it', (language, code, text) => {
    expect(
      at(bundle('garage', language), `jobs.finalPrice.problem.${code}`),
    ).toBe(text);
  });
});

// @traces 1393-FR-003
// @traces 1393-FR-010
// @traces 1393-FR-013
// @traces 1393-FR-017
describe('the final price texts', () => {
  it.each([
    ['garage', 'jobs.finalPrice.handover', 'Predare', 'Handover'],
    ['garage', 'jobs.finalPrice.correct', 'Corectează', 'Correct'],
    [
      'garage',
      'jobs.finalPrice.correctTitle',
      'Corectează prețul final',
      'Correct the final price',
    ],
    [
      'garage',
      'jobs.finalPrice.field',
      'Preț final (lei)',
      'Final price (lei)',
    ],
    ['garage', 'jobs.finalPrice.save', 'Salvează', 'Save'],
    ['garage', 'jobs.finalPrice.cancel', 'Renunță', 'Cancel'],
    [
      'garage',
      'jobs.finalPrice.line',
      'Preț final {price}',
      'Final price {price}',
    ],
    ['driver', 'requests.closedOn', 'Încheiată pe {day}', 'Closed on {day}'],
    [
      'driver',
      'requests.finalPrice',
      'Preț final {price}',
      'Final price {price}',
    ],
    [
      'shell',
      'form.field.format',
      'Scrie suma în lei, de exemplu 4.200 sau 4.200,50.',
      'Write the amount in lei, for example 4.200 or 4.200,50.',
    ],
    [
      'shell',
      'form.field.decimals',
      'Cel mult două zecimale.',
      'Two decimals at most.',
    ],
    [
      'shell',
      'form.field.min',
      'Suma trebuie să fie mai mare de 0.',
      'The amount must be more than 0.',
    ],
    [
      'shell',
      'form.field.max',
      'Cel mult 1.000.000 lei.',
      '1,000,000 lei at most.',
    ],
  ] as const)('%s %s reads in both languages', (area, path, ro, en) => {
    expect(at(bundle(area, 'ro'), path)).toBe(ro);
    expect(at(bundle(area, 'en'), path)).toBe(en);
  });

  // Moved to the shared form texts, which every area loads: not kept twice.
  it.each(['format', 'decimals', 'min', 'max'])(
    'keeps the amount message %s only in the shared form texts',
    (code) => {
      for (const language of ['ro', 'en'] as const)
        expect(
          at(bundle('driver', language), `review.field.${code}`),
        ).toBeUndefined();
    },
  );
});
