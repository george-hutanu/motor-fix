import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { RatingDial } from './rating-dial';

@Component({
  imports: [RatingDial],
  template: `<mf-rating-dial [value]="value()" [size]="size()" />`,
})
class Host {
  readonly value = signal<unknown>(null);
  readonly size = signal<'large' | 'small'>('large');
}

function render(value: unknown, size: 'large' | 'small' = 'large') {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.value.set(value);
  fixture.componentInstance.size.set(size);
  fixture.detectChanges();
  const dial = (fixture.nativeElement as HTMLElement).querySelector(
    'mf-rating-dial',
  ) as HTMLElement;
  const set = (v: unknown) => {
    fixture.componentInstance.value.set(v);
    fixture.detectChanges();
  };
  return {
    angle: () =>
      (
        dial.querySelector('.mf-dial-needle') as SVGElement | null
      )?.style.getPropertyValue('--mf-dial-needle'),
    centre: () => dial.querySelector('.mf-dial-value')?.textContent?.trim(),
    dial,
    fixture,
    needles: () => dial.querySelectorAll('.mf-dial-needle').length,
    set,
    swing: () => dial.classList.contains('mf-dial-swing-in'),
  };
}

describe('large dial needle with hostile values', () => {
  // @traces 455-FR-001
  it.each<unknown>([
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -0,
    -1e308,
    0.049,
    '',
    ' ',
    '5',
    true,
    false,
    [],
    [4.8],
    {},
    { valueOf: () => 4.8 },
    Number.MIN_VALUE,
    BigInt(0),
    Symbol('x'),
    () => 4.8,
  ])('draws no needle and reads "—" for %p', (v) => {
    const t = render(v);

    expect(t.needles()).toBe(0);
    expect(t.centre()).toBe('—');
  });

  // @traces 455-FR-002
  it.each<[number, string]>([
    [5, '120deg'],
    [5.04, '120deg'],
    [100, '120deg'],
    [1e308, '120deg'],
    [0.05, '-115.2deg'],
    [2.5, '0deg'],
  ])('points one needle for %p at %s', (v, angle) => {
    const t = render(v);

    expect(t.needles()).toBe(1);
    expect(t.angle()).toBe(angle);
  });

  // @traces 455-FR-002
  it('points the needle at the number it shows when the value has more decimals', () => {
    const t = render(4.949);

    expect(t.centre()).toBe('4,9');
    expect(t.angle()).toBe('115.2deg');
  });

  // @traces 455-FR-002
  it('keeps the same needle angle in English', async () => {
    const t = render(4.9);
    await TestBed.inject(I18n).use('en');
    t.fixture.detectChanges();

    expect(t.centre()).toBe('4.9');
    expect(t.angle()).toBe('115.2deg');
  });

  // @traces 455-FR-001
  it('keeps exactly one needle after many rating changes', () => {
    const t = render(null);

    for (const v of [4.9, 3, null, 2, 1, NaN, 5]) t.set(v);

    expect(t.needles()).toBe(1);
    expect(t.angle()).toBe('120deg');
  });
});

describe('large dial swing-in', () => {
  // @traces 455-FR-002
  it('does not swing when a rating follows another rating', () => {
    const t = render(4.9);

    t.set(3);

    expect(t.swing()).toBe(false);
    expect(t.angle()).toBe('24deg');
  });

  // @traces 455-FR-002
  it('stops swinging once the rating changes again', () => {
    const t = render(null);

    t.set(4.9);
    expect(t.swing()).toBe(true);
    t.set(3);

    expect(t.swing()).toBe(false);
  });

  // @traces 455-FR-002
  it('swings again each time a rating follows no rating', () => {
    const t = render(null);

    t.set(4.9);
    t.set(null);
    expect(t.swing()).toBe(false);
    t.set(4.9);

    expect(t.swing()).toBe(true);
  });

  // @traces 455-FR-002
  it.each<unknown>([NaN, 0.04, -1, 'x', undefined])(
    'does not swing when no rating changes to %p',
    (v) => {
      const t = render(null);

      t.set(v);

      expect(t.swing()).toBe(false);
      expect(t.needles()).toBe(0);
    },
  );

  // @traces 455-FR-002
  it('swings when a rating follows a run of different no-rating values', () => {
    const t = render(null);

    t.set(NaN);
    t.set('4.8');
    t.set(0);
    t.set(4.9);

    expect(t.swing()).toBe(true);
    expect(t.angle()).toBe('115.2deg');
  });

  // @traces 455-FR-002
  it('does not swing for a dial first rendered with a rating of 5', () => {
    expect(render(5).swing()).toBe(false);
  });
});

describe('small dial', () => {
  // @traces 455-FR-003
  it.each<unknown>([null, 4.9, 5, 0.05, 100, NaN])(
    'has no needle and no swing for %p, also after a change',
    (v) => {
      const t = render(null, 'small');

      t.set(v);

      expect(t.needles()).toBe(0);
      expect(t.dial.getAttribute('data-size')).toBe('small');
    },
  );

  // @traces 455-FR-003
  it('gains a needle when the size changes to large and loses it going back', () => {
    const t = render(4.9, 'small');
    expect(t.needles()).toBe(0);

    t.fixture.componentInstance.size.set('large');
    t.fixture.detectChanges();
    expect(t.needles()).toBe(1);

    t.fixture.componentInstance.size.set('small');
    t.fixture.detectChanges();
    expect(t.needles()).toBe(0);
  });

  // @traces 455-FR-001
  it('has no needle after switching to large with no rating', () => {
    const t = render(null, 'small');

    t.fixture.componentInstance.size.set('large');
    t.fixture.detectChanges();

    expect(t.needles()).toBe(0);
    expect(t.centre()).toBe('—');
  });
});
