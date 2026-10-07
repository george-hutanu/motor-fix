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

describe('the current step at the edges', () => {
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
  it.each(['ro', 'en'])('keep the bar placeholders in %s', (language) => {
    const bar = catalogue(language).listing?.['bar'] ?? '';

    expect(bar).toContain('{n}');
    expect(bar).toContain('{label}');
  });
});
