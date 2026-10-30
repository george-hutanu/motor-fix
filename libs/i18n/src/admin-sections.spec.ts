import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Language = 'ro' | 'en';
type Texts = Record<string, unknown>;

// Read from the files, not through I18n.t, which falls back to Romanian and
// would hide a text missing in English.
const bundle = (language: Language): Texts =>
  JSON.parse(
    readFileSync(join(__dirname, 'admin', `${language}.json`), 'utf8'),
  );

const at = (texts: Texts, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>((node, key) => (node as Texts | undefined)?.[key], texts);

const KEYS = ['numbers', 'verification', 'growth', 'demand', 'log'];
const PATHS = [
  'title',
  'line',
  'button',
  'count',
  'empty',
  'done',
  'saveFailed',
  'reset',
  'moveUp',
  'moveDown',
  'hide',
  ...KEYS.flatMap((key) => [`name.${key}`, `description.${key}`]),
].map((path) => `panel.sections.${path}`);

// @traces 1391-admin-dashboard-customise-FR-018
describe('the admin dashboard customise texts', () => {
  it.each(
    (['ro', 'en'] as const).flatMap((language) =>
      PATHS.map((path) => [language, path] as const),
    ),
  )('%s has %s', (language, path) => {
    const text = at(bundle(language), path);
    expect(typeof text).toBe('string');
    expect((text as string).trim()).not.toBe('');
  });

  it('names the same keys in both languages', () => {
    const keys = (language: Language) =>
      JSON.stringify(at(bundle(language), 'panel.sections'), (_, value) =>
        typeof value === 'string'
          ? ''
          : value && typeof value === 'object'
            ? Object.fromEntries(Object.entries(value).sort())
            : value,
      );
    expect(at(bundle('ro'), 'panel.sections')).toBeDefined();
    expect(keys('en')).toBe(keys('ro'));
  });
});

// @traces 1391-admin-dashboard-customise-FR-002 1391-admin-dashboard-customise-FR-003 1391-admin-dashboard-customise-FR-007
describe('the admin dashboard customise wording', () => {
  it.each([
    [
      'ro',
      'line',
      'Oprește secțiunile de care nu ai nevoie și mută‑le în ordinea în care lucrezi. Se salvează în contul tău.',
    ],
    ['ro', 'button', 'Personalizează panoul'],
    ['en', 'button', 'Customise the dashboard'],
    ['ro', 'title', 'Alege ce vezi pe panou'],
    ['en', 'title', 'Choose what the dashboard shows'],
    ['ro', 'count', '{x} din {y} secțiuni afișate'],
    ['en', 'count', '{x} of {y} sections shown'],
    ['ro', 'reset', 'Revino la varianta implicită'],
    ['en', 'reset', 'Back to the default'],
    ['ro', 'moveUp', 'Mută mai sus: {name}'],
    ['en', 'moveUp', 'Move up: {name}'],
    ['ro', 'moveDown', 'Mută mai jos: {name}'],
    ['en', 'moveDown', 'Move down: {name}'],
    ['ro', 'hide', 'Ascunde: {name}'],
    ['en', 'hide', 'Hide: {name}'],
    ['ro', 'saveFailed', 'Nu am putut salva. Încearcă din nou.'],
    ['en', 'saveFailed', 'Could not save. Try again.'],
    ['ro', 'name.numbers', 'Cifrele platformei'],
    ['en', 'name.numbers', 'Platform numbers'],
    ['ro', 'name.verification', 'Service‑uri de verificat'],
    ['en', 'name.verification', 'Garages to verify'],
    ['ro', 'name.growth', 'Creștere, ultimele 12 luni'],
    ['en', 'name.growth', 'Growth, last 12 months'],
    ['ro', 'name.demand', 'Cereri pe marcă, 30 de zile'],
    ['en', 'name.demand', 'Requests by brand, 30 days'],
    ['ro', 'name.log', 'Jurnal'],
    ['en', 'name.log', 'Log'],
    ['ro', 'description.verification', 'Dosarele care așteaptă o decizie'],
    ['ro', 'description.log', 'Ce s‑a întâmplat azi pe platformă'],
  ] as const)('%s %s reads as the spec gives it', (language, path, text) => {
    expect(at(bundle(language), `panel.sections.${path}`)).toBe(text);
  });

  it('ends the English line with where it is saved', () => {
    expect(at(bundle('en'), 'panel.sections.line')).toMatch(
      /It is saved in your account\.$/,
    );
  });
});
