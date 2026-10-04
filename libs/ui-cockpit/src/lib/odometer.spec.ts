import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';

import { Odometer } from './odometer';

@Component({
  imports: [Odometer],
  template: `
    @if (range()) {
      <mf-odometer [from]="from()" [to]="to()" />
    } @else {
      <mf-odometer [from]="from()" />
    }
  `,
})
class Host {
  readonly from = signal<unknown>(125000);
  readonly to = signal<unknown>(160000);
  readonly range = signal(true);
}

function render(from: unknown, to?: unknown) {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.from.set(from);
  fixture.componentInstance.to.set(to);
  fixture.componentInstance.range.set(to !== undefined);
  fixture.detectChanges();
  const part = () =>
    (fixture.nativeElement as HTMLElement).querySelector(
      'mf-odometer',
    ) as HTMLElement;
  const live = () => part().querySelectorAll('[aria-live]');
  return {
    digits: () => [...part().querySelectorAll('.mf-odometer-digit')],
    fixture,
    live,
    part,
    shown: () =>
      part().querySelector('[aria-hidden="true"]')?.textContent?.trim(),
    spoken: () => live()[0]?.textContent?.trim(),
  };
}

describe('Odometer', () => {
  it('shows a range in whole lei in Romanian and in English', async () => {
    const { fixture, shown, spoken } = render(125000, 160000);

    expect(shown()).toBe('1.250–1.600 lei');
    expect(spoken()).toBe('1.250–1.600 lei');

    await TestBed.inject(I18n).use('en');
    fixture.detectChanges();

    expect(shown()).toBe('1,250–1,600 lei');
  });

  it('gives screen readers only the new value when it changes', () => {
    const { fixture, live, shown, spoken } = render(125000, 160000);

    fixture.componentInstance.from.set(140000);
    fixture.componentInstance.to.set(180000);
    fixture.detectChanges();

    expect(shown()).toBe('1.400–1.800 lei');
    expect(live()).toHaveLength(1);
    expect(live()[0].getAttribute('aria-live')).toBe('polite');
    expect(live()[0].getAttribute('aria-atomic')).toBe('true');
    expect(spoken()).toBe('1.400–1.800 lei');
  });

  it('is a single price when the end is left out, and a dash when the end is missing', () => {
    expect(render(125000, undefined).shown()).toBe('1.250 lei');
    expect(render(125000, null).shown()).toBe('—');
  });

  it('rounds a single price to whole lei', () => {
    expect(render(140050).shown()).toBe('1.401 lei');
    expect(render(140049).shown()).toBe('1.400 lei');
  });

  it('shows one value when both ends round to the same leu', () => {
    expect(render(80010, 79990).shown()).toBe('800 lei');
  });

  it.each([
    [undefined, undefined],
    [null, undefined],
    [Number.NaN, undefined],
    [125000, null],
  ])('shows "—" for %p to %p', (from, to) => {
    const { shown, spoken } = render(from, to);

    expect(shown()).toBe('—');
    expect(spoken()).toBe('—');
  });

  it('puts each digit in its own cell carrying the digit, and nothing else', () => {
    const { digits } = render(125000, 160000);

    expect(digits().map((d) => d.textContent)).toEqual([
      '1',
      '2',
      '5',
      '0',
      '1',
      '6',
      '0',
      '0',
    ]);
    expect(
      digits().map((d) =>
        (d as HTMLElement).style.getPropertyValue('--mf-digit'),
      ),
    ).toEqual(['1', '2', '5', '0', '1', '6', '0', '0']);
  });

  it('rolls each digit cell to its digit, and shows the plain digit in forced colours', () => {
    const odometer = readFileSync(
      join(__dirname, 'odometer.ts'),
      'utf8',
    ).replace(/\s+/g, ' ');
    // The source escapes the CSS line break once more for the template string.
    const column = [...'0123456789'].join(String.raw`\\A `);

    expect(odometer).toContain(`content: "${column}";`);
    expect(odometer).toContain(
      'translate: 0 calc(var(--mf-digit) * -1.4em); transition: translate var(--mf-motion-roll) var(--mf-motion-ease);',
    );
    expect(odometer).toMatch(
      /@media \(forced-colors: active\) \{ \.mf-odometer-digit \{ color: inherit; \} \.mf-odometer-digit::before \{ content: none; \} \}/,
    );
    expect(odometer.match(/animation|transition/g)).toHaveLength(1);
  });
});
