import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { currentStep, jumpTarget } from './steps';

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

describe('the target of a jump', () => {
  it('is the heading top short of its margin, from the current position', () => {
    expect(jumpTarget(500, 80, 1000, 8000, 800)).toBe(1420);
  });

  it('never goes above the top of the page', () => {
    expect(jumpTarget(-5000, 0, 100, 8000, 800)).toBe(0);
    expect(jumpTarget(10, 500, 0, 8000, 800)).toBe(0);
  });

  it('stops at the end of the scroll range, exactly and one past it', () => {
    expect(jumpTarget(7200, 0, 0, 8000, 800)).toBe(7200);
    expect(jumpTarget(7201, 0, 0, 8000, 800)).toBe(7200);
    expect(jumpTarget(7199, 0, 0, 8000, 800)).toBe(7199);
  });

  it('is zero on a page no taller than the window', () => {
    expect(jumpTarget(300, 0, 0, 600, 800)).toBe(0);
    expect(jumpTarget(300, 0, 0, 800, 800)).toBe(0);
    expect(jumpTarget(0, 0, 0, 0, 0)).toBe(0);
  });

  it('is the current position for a heading exactly at the line', () => {
    expect(jumpTarget(80, 80, 1234, 8000, 800)).toBe(1234);
  });

  it('keeps a fractional position without rounding it', () => {
    expect(jumpTarget(0.5, 0, 10.25, 8000, 800)).toBe(10.75);
  });
});
