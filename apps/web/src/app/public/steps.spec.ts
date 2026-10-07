import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { currentStep, STEPS } from './steps';

describe('the six steps', () => {
  it('are numbered 1 to 6, the mechanics optional and the verification required', () => {
    expect(STEPS.map((step) => [step.n, step.mark])).toEqual([
      [1, null],
      [2, null],
      [3, null],
      [4, 'public.listing.optional'],
      [5, null],
      [6, 'public.listing.required'],
    ]);
  });

  it.each([
    [
      'ro',
      [
        'Service-ul',
        'Mărci',
        'Prețuri',
        'Mecanici',
        'Fotografii și adresă',
        'Verificare',
      ],
    ],
    [
      'en',
      [
        'The garage',
        'Brands',
        'Prices',
        'Mechanics',
        'Photos and place',
        'Verification',
      ],
    ],
  ])('are labelled in %s', async (language, labels) => {
    const i18n = TestBed.inject(I18n);
    await i18n.enter('public');
    await i18n.use(language);

    // The catalogue writes hyphens non-breaking.
    expect(STEPS.map((step) => i18n.t(step.label).replace(/‑/g, '-'))).toEqual(
      labels,
    );
  });
});

describe('the current step', () => {
  const tops = [100, 700, 1300, 1900, 2500, 3100];

  it('is the first while no heading has reached the line', () => {
    expect(currentStep(tops, 50, false)).toBe(1);
  });

  it('is the last heading that reached the line', () => {
    expect(currentStep(tops, 100, false)).toBe(1);
    expect(currentStep(tops, 1299, false)).toBe(2);
    expect(currentStep(tops, 1300, false)).toBe(3);
    expect(currentStep(tops, 2600, false)).toBe(5);
  });

  it('is the sixth at the end of the page, whatever the headings', () => {
    expect(currentStep(tops, 50, true)).toBe(6);
  });

  it('reads headings that moved above the line as reached', () => {
    expect(currentStep([-900, -300, 40, 640, 1240, 1840], 64, false)).toBe(3);
  });
});
