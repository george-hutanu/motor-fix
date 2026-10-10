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
