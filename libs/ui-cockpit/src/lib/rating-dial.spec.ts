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

  it('draws a needle at the value on the large dial only', () => {
    const large = render(5, 'large').dial;
    const small = render(4.8, 'small').dial;

    expect(large.getAttribute('data-size')).toBe('large');
    expect(
      large.querySelector('.mf-dial-needle')?.getAttribute('transform'),
    ).toBe('rotate(120 34 34)');
    expect(
      render(0, 'large')
        .dial.querySelector('.mf-dial-needle')
        ?.getAttribute('transform'),
    ).toBe('rotate(-120 34 34)');
    expect(small.getAttribute('data-size')).toBe('small');
    expect(small.querySelector('.mf-dial-needle')).toBeNull();
  });
});
