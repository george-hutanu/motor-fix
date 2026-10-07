import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { currentStep } from './steps';

const catalogue = (language: string) =>
  JSON.parse(
    readFileSync(
      join(
        __dirname,
        '../../../../../libs/i18n/src/public',
        `${language}.json`,
      ),
      'utf8',
    ),
  ) as { listing?: Record<string, string> };

const KEYS = [
  'label',
  'heading',
  'intro',
  'steps',
  'step1',
  'step2',
  'step3',
  'step4',
  'step5',
  'step6',
  'optional',
  'required',
  'bar',
];

describe('the current step at the edges', () => {
  const tops = [100, 700, 1300, 1900, 2500, 3100];

  it('is the step whose heading sits exactly on the line', () => {
    expect(currentStep(tops, 1300, false)).toBe(3);
    expect(currentStep(tops, 1299, false)).toBe(2);
  });

  it('is step 6 at the end of the page whatever the headings say', () => {
    expect(currentStep([5000, 6000, 7000, 8000, 9000, 9500], 0, true)).toBe(6);
  });

  it('is step 1 when every heading is far below the line', () => {
    expect(currentStep([9000, 9100, 9200, 9300, 9400, 9500], 0, false)).toBe(1);
  });

  it('is step 6 when every heading is far above the line', () => {
    expect(currentStep([-9, -8, -7, -6, -5, -4], 0, false)).toBe(6);
  });
});

describe('the listing texts', () => {
  it.each(['ro', 'en'])(
    'hold every listing key in %s, none empty',
    (language) => {
      const listing = catalogue(language).listing ?? {};

      expect(Object.keys(listing).sort()).toEqual([...KEYS].sort());
      for (const key of KEYS) expect(listing[key].trim()).not.toBe('');
    },
  );

  it.each(['ro', 'en'])('keep the bar placeholders in %s', (language) => {
    const bar = catalogue(language).listing?.['bar'] ?? '';

    expect(bar).toContain('{n}');
    expect(bar).toContain('{label}');
  });
});
