import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { RatingDial } from './rating-dial';

@Component({
  imports: [RatingDial],
  template: `<mf-rating-dial [value]="value()" [size]="size()" />`,
})
class Host {
  readonly value = signal<unknown>(4.8);
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
  return {
    arc: dial.querySelector('.mf-dial-arc') as SVGElement,
    centre: () => dial.querySelector('.mf-dial-value')?.textContent?.trim(),
    dial,
    fill: () => dial.style.getPropertyValue('--mf-dial-fill'),
    fixture,
  };
}

describe('RatingDial', () => {
  it('fills 4.8/5 of the arc and reads "4,8" in Romanian, "4.8" in English', async () => {
    const { arc, centre, dial, fill, fixture } = render(4.8);

    expect(centre()).toBe('4,8');
    expect(Number(fill())).toBeCloseTo(0.96);
    expect(arc.getAttribute('stroke-dasharray')).toBe('230.4 360');
    expect(dial.getAttribute('role')).toBe('img');
    expect(dial.getAttribute('aria-label')).toBe('Rating 4,8 din 5');

    await TestBed.inject(I18n).use('en');
    fixture.detectChanges();

    expect(centre()).toBe('4.8');
    expect(dial.getAttribute('aria-label')).toBe('Rating 4.8 out of 5');
  });

  it('rounds half up to one decimal', () => {
    expect(render(4.85).centre()).toBe('4,9');
    expect(render(4.75).centre()).toBe('4,8');
    expect(render(4.749).centre()).toBe('4,7');
  });

  it('clamps a rating above 5 to a full arc', () => {
    const { centre, fill } = render(7);

    expect(centre()).toBe('5,0');
    expect(Number(fill())).toBe(1);
  });

  it.each([null, undefined, 0, 0.04, -1, Number.NaN, '4.8'])(
    'shows an empty arc and "—" for %p, never 0,0',
    async (value) => {
      const { arc, centre, dial, fill, fixture } = render(value);

      expect(centre()).toBe('—');
      // @traces 455-FR-001 455-FR-004
      expect(dial.querySelector('.mf-dial-needle')).toBeNull();
      expect(Number(fill())).toBe(0);
      expect(arc.getAttribute('stroke-dasharray')).toBe('0 360');
      expect(dial.getAttribute('aria-label')).toBe('Nicio recenzie încă');

      await TestBed.inject(I18n).use('en');
      fixture.detectChanges();
      expect(dial.getAttribute('aria-label')).toBe('No reviews yet');
    },
  );

  it('hides its drawing and its number from screen readers behind one name', () => {
    const { dial } = render(4.8);

    expect(dial.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(
      dial.querySelector('.mf-dial-value')?.getAttribute('aria-hidden'),
    ).toBe('true');
  });

  // @traces 455-FR-002 455-FR-004
  it('points the needle at the rating on the large dial', () => {
    const needle = (value: unknown) =>
      render(value).dial.querySelector('.mf-dial-needle') as SVGElement;

    expect(needle(5).style.getPropertyValue('--mf-dial-needle')).toBe('120deg');
    expect(needle(4.9).style.getPropertyValue('--mf-dial-needle')).toBe(
      '115.2deg',
    );
    expect(needle(0.1).style.getPropertyValue('--mf-dial-needle')).toBe(
      '-115.2deg',
    );
  });

  // @traces 455-FR-002
  it('swings the needle in only when a rating arrives after none', () => {
    expect(render(4.9).dial.classList.contains('mf-dial-swing-in')).toBe(false);

    const { dial, fixture } = render(null);
    expect(dial.querySelector('.mf-dial-needle')).toBeNull();
    expect(dial.classList.contains('mf-dial-swing-in')).toBe(false);

    fixture.componentInstance.value.set(4.9);
    fixture.detectChanges();
    expect(dial.classList.contains('mf-dial-swing-in')).toBe(true);
    expect(
      (
        dial.querySelector('.mf-dial-needle') as SVGElement
      ).style.getPropertyValue('--mf-dial-needle'),
    ).toBe('115.2deg');

    fixture.componentInstance.value.set(undefined);
    fixture.detectChanges();
    expect(dial.querySelector('.mf-dial-needle')).toBeNull();
    expect(dial.querySelector('.mf-dial-value')?.textContent?.trim()).toBe('—');
  });

  // @traces 455-FR-003
  it('never draws a needle on the small dial', () => {
    for (const value of [4.8, null]) {
      const { dial } = render(value, 'small');
      expect(dial.getAttribute('data-size')).toBe('small');
      expect(dial.querySelector('.mf-dial-needle')).toBeNull();
    }
  });
});

describe('the large dial figure', () => {
  it('is set with the display token, on the type scale', () => {
    const source = readFileSync(join(__dirname, 'rating-dial.ts'), 'utf8');
    expect(source).toMatch(
      /\[data-size='large'\]\) \.mf-dial-value \{[^}]*font-size: var\(--mf-size-display\)/,
    );
  });
});
