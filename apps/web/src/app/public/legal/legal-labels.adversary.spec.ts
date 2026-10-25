import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LEGAL_TEXTS } from '../legal-texts';

const load = (language: 'ro' | 'en') =>
  JSON.parse(
    readFileSync(
      join(
        __dirname,
        `../../../../../../libs/i18n/src/public/${language}.json`,
      ),
      'utf8',
    ),
  ).legal as {
    version: string;
    terms: { title: string };
    privacy: { title: string };
  };

describe.each(['ro', 'en'] as const)('the %s legal page keys', (language) => {
  // @traces 1204-FR-011
  it.each(['terms', 'privacy'] as const)(
    'the %s title is the document title then " · MotorFix"',
    (kind) => {
      expect(load(language)[kind].title).toBe(
        `${LEGAL_TEXTS[language][kind].title} · MotorFix`,
      );
    },
  );

  // @traces 1204-FR-010
  it('holds a version label with no date or placeholder in it', () => {
    expect(load(language).version).toMatch(/^[A-Za-zăîșțâ]+$/u);
  });

  // @traces 1204-FR-010
  it('holds no legal text in the interface file', () => {
    expect(Object.keys(load(language)).sort()).toEqual([
      'privacy',
      'terms',
      'version',
    ]);
  });
});

describe('legal labels', () => {
  // @traces 1204-FR-010
  it('are not exported from the legal texts module any more', () => {
    expect(Object.keys(jest.requireActual('../legal-texts'))).not.toContain(
      'LEGAL_LABELS',
    );
  });
});
