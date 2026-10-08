import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { currentStep, jumpTarget, keepsTapped, STEPS } from './steps';

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

describe('a tapped step', () => {
  const bottom = 720;

  it('stays current while its heading is on screen below the line, as the short sections at the end of the page leave it', () => {
    expect(keepsTapped(2, 3, 170, bottom)).toBe(true);
    expect(keepsTapped(1, 3, 719, bottom)).toBe(true);
  });

  it('gives way once its heading has left the screen below', () => {
    expect(keepsTapped(2, 3, 720, bottom)).toBe(false);
    expect(keepsTapped(2, 3, 900, bottom)).toBe(false);
  });

  it('gives way to the scroll once the scroll reaches it or a later step', () => {
    expect(keepsTapped(3, 3, -10, bottom)).toBe(false);
    expect(keepsTapped(6, 3, 170, bottom)).toBe(false);
  });
});

describe('where a jump to a heading takes the page', () => {
  // A 3000 px page in a 720 px window: it scrolls from 0 to 2280.
  const target = (top: number, margin: number, scrollY: number) =>
    jumpTarget(top, margin, scrollY, 3000, 720);

  it('brings the heading to the top, short of its scroll margin', () => {
    expect(target(900, 44, 100)).toBe(956);
    expect(target(-300, 16, 1000)).toBe(684);
  });

  it('stops at the end of the page when the heading is too near it', () => {
    expect(target(2000, 16, 1000)).toBe(2280);
  });

  it('stops at the top of the page', () => {
    expect(target(10, 44, 0)).toBe(0);
  });

  it('goes nowhere on a page shorter than the window', () => {
    expect(jumpTarget(400, 16, 0, 600, 720)).toBe(0);
  });
});
