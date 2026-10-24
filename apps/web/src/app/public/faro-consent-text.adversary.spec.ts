import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ANALYTICS_CONSENT_VERSION,
  PRIVACY_VERSION,
  TERMS_VERSION,
} from '@motor-fix/contracts/consent';

import { LEGAL_TEXTS } from './legal-texts';

const load = (lang: string) =>
  JSON.parse(
    readFileSync(
      join(__dirname, `../../../../../libs/i18n/src/consent/${lang}.json`),
      'utf8',
    ),
  );
const en = load('en');
const ro = load('ro');

const paths = (value: unknown, prefix = ''): string[] =>
  value && typeof value === 'object'
    ? Object.entries(value).flatMap(([k, v]) => paths(v, `${prefix}.${k}`))
    : [prefix];

describe('the analytics consent texts', () => {
  // @traces 947-FR-004
  it('holds the same keys in both languages', () => {
    expect(paths(ro).sort()).toEqual(paths(en).sort());
  });

  // @traces 947-FR-004
  it.each([
    ['en', en],
    ['ro', ro],
  ])('names Plausible and Grafana Faro in the %s bar and dialog', (_, t) => {
    for (const line of [t.bar.text, t.dialog.line]) {
      if (line === t.bar.text) {
        expect(line).toContain('Plausible');
      }
      expect(line).toContain('Faro');
    }
  });

  // @traces 947-FR-004
  it.each([
    ['en', en, /without identifying you|no cookies and/i],
    ['ro', ro, /fără a te identifica/i],
  ])('no longer claims the %s visitor is not identified', (_, t, stale) => {
    expect(t.dialog.line).not.toMatch(stale);
    expect(t.bar.text).not.toMatch(stale);
  });

  // @traces 947-FR-004
  it('says in neither language that replay or recording happens', () => {
    const text = JSON.stringify([en, ro]);

    expect(text).not.toMatch(/replay|record(s|ed|ing)\b|înregistr/i);
  });

  // @traces 947-FR-004
  it('leaves no empty string in either language', () => {
    for (const t of [en, ro]) {
      for (const [, v] of Object.entries(JSON.parse(JSON.stringify(t))) as [
        string,
        Record<string, string>,
      ][])
        for (const s of Object.values(v))
          expect(s.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('the versions after the text change', () => {
  // @traces 947-FR-004
  it('asks the visitor who accepted the previous text again', () => {
    expect(ANALYTICS_CONSENT_VERSION).toBe('2026-10-24');
    expect(ANALYTICS_CONSENT_VERSION).not.toBe('2026-10-10');
  });

  // @traces 947-FR-005
  it('dates the privacy notice with the new version in both languages', () => {
    expect(PRIVACY_VERSION).toBe('2026-10-24');
    expect(LEGAL_TEXTS.en.privacy.version).toBe(PRIVACY_VERSION);
    expect(LEGAL_TEXTS.ro.privacy.version).toBe(PRIVACY_VERSION);
    expect(LEGAL_TEXTS.en.terms.version).toBe(TERMS_VERSION);
    expect(LEGAL_TEXTS.ro.terms.version).toBe(TERMS_VERSION);
  });

  // @traces 947-FR-005
  it('keeps both privacy notices at the same sections and paragraph counts', () => {
    const shape = (lang: 'en' | 'ro') =>
      LEGAL_TEXTS[lang].privacy.sections.map((s) => s.paragraphs.length);

    expect(shape('ro')).toEqual(shape('en'));
  });

  // @traces 947-FR-005
  it.each(['en', 'ro'] as const)(
    'says in the %s notice that no replay is recorded',
    (lang) => {
      const text = LEGAL_TEXTS[lang].privacy.sections
        .flatMap((s) => s.paragraphs)
        .join(' ');

      expect(text).toMatch(
        /replay|reluar|redare|recording of (your )?screen|ecran/i,
      );
    },
  );
});
