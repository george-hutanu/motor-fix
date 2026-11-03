import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { flatten, type Texts } from './files';

const driver = (language: 'ro' | 'en') =>
  flatten(
    'driver',
    JSON.parse(
      readFileSync(join(__dirname, 'driver', `${language}.json`), 'utf8'),
    ) as Texts,
  );

const story = (texts: Record<string, string>) =>
  Object.keys(texts)
    .filter((k) => /^driver\.(empty|panel)\./.test(k))
    .sort();

describe('the empty-state texts of a new account', () => {
  // @traces 030-FR-010
  it('has every key in Romanian and in English, and none of them empty', () => {
    const ro = driver('ro');
    const en = driver('en');

    expect(story(ro)).toEqual(story(en));
    expect(story(ro)).toEqual(
      expect.arrayContaining([
        'driver.empty.addFirstCar',
        'driver.empty.cars',
        'driver.empty.findGarage',
        'driver.empty.findGarageForCar',
        'driver.empty.findOthers',
        'driver.empty.quotes',
        'driver.empty.repairs',
        'driver.empty.requests',
        'driver.empty.reviews',
        'driver.empty.saved',
        'driver.panel.activeRequest',
        'driver.panel.quotes',
        'driver.panel.repairs',
      ]),
    );
    for (const key of story(ro)) {
      expect(ro[key].trim()).not.toBe('');
      expect(en[key].trim()).not.toBe('');
    }
  });
});

const area = (name: 'garage' | 'shell', language: 'ro' | 'en') =>
  flatten(
    name,
    JSON.parse(
      readFileSync(join(__dirname, name, `${language}.json`), 'utf8'),
    ) as Texts,
  );

describe('the verification page texts', () => {
  // @traces 101-FR-011
  it('has the page’s keys in Romanian and in English, none empty, and the old check line gone', () => {
    const keys = [
      'garage.verification.checkIn',
      'garage.verification.contact',
      'garage.verification.loadFailed',
      'garage.verification.title',
    ];
    for (const language of ['ro', 'en'] as const) {
      const texts = area('garage', language);
      for (const key of keys) expect(texts[key]?.trim()).toBeTruthy();
      expect(
        area('shell', language)['shell.frame.verification'],
      ).toBeUndefined();
    }
    expect(area('garage', 'ro')['garage.verification.title']).toBe(
      'Profilul tău e în verificare',
    );
    expect(area('garage', 'en')['garage.verification.title']).toBe(
      'Your profile is being checked',
    );
  });
});

describe("the texts of today's numbers on Panou", () => {
  const keys = [
    'garage.daily.error',
    'garage.daily.label.bookings',
    'garage.daily.label.estimate',
    'garage.daily.label.rating',
    'garage.daily.label.requests',
    'garage.daily.label.work',
    'garage.daily.note.fewer',
    'garage.daily.note.more',
    'garage.daily.note.noReviews',
    'garage.daily.note.noSlots',
    'garage.daily.note.review',
    'garage.daily.note.reviews',
    'garage.daily.note.same',
    'garage.daily.note.slot',
    'garage.daily.note.slots',
    'garage.daily.note.today',
    'garage.daily.note.work',
    'garage.daily.retry',
  ];
  const daily = (texts: Record<string, string>) =>
    Object.keys(texts)
      .filter((key) => key.startsWith('garage.daily.'))
      .sort();

  // @traces 1431-FR-006
  it('has the same keys in Romanian and in English, none empty', () => {
    const ro = area('garage', 'ro');
    const en = area('garage', 'en');

    expect(daily(ro)).toEqual(keys);
    expect(daily(en)).toEqual(keys);
    for (const key of keys) {
      expect(ro[key].trim()).not.toBe('');
      expect(en[key].trim()).not.toBe('');
    }
  });

  // @traces 1431-FR-006
  it('writes Romanian with comma-below diacritics', () => {
    const ro = area('garage', 'ro');
    for (const key of keys) expect(ro[key]).not.toMatch(/[şţŞŢ]/);
    expect(ro['garage.daily.label.bookings']).toBe('Programări săptămâna asta');
    expect(ro['garage.daily.note.work']).toBe(
      'lei, din prețuri finale și oferte acceptate',
    );
  });

  // @traces 1431-FR-006
  it('no longer holds the empty sentence of the section', () => {
    for (const language of ['ro', 'en'] as const)
      expect(area('garage', language)['garage.home.empty.kpi']).toBeUndefined();
  });
});
