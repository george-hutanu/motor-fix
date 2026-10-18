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

  it('spaces the digit cells on the 4 px grid', () => {
    const odometer = readFileSync(
      join(__dirname, 'odometer.ts'),
      'utf8',
    ).replace(/\s+/g, ' ');

    expect(odometer).toMatch(/\.mf-odometer-value \{[^}]*gap: 4px;/);
  });

  it('pads the digit cells on the 4 px grid, the rolling column one cell tall', () => {
    const odometer = readFileSync(
      join(__dirname, 'odometer.ts'),
      'utf8',
    ).replace(/\s+/g, ' ');

    expect(odometer).toMatch(/\.mf-odometer-digit \{[^}]*padding: 4px 0;/);
    expect(odometer).toMatch(
      /\.mf-odometer-digit::before \{[^}]*line-height: calc\(1em \+ 8px\);/,
    );
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
      'translate: 0 calc(var(--mf-digit) * -1 * (1em + 8px)); transition: translate var(--mf-motion-roll) var(--mf-motion-ease);',
    );
    expect(odometer).toMatch(
      /@media \(forced-colors: active\) \{ \.mf-odometer-digit \{ color: inherit; \} \.mf-odometer-digit::before \{ content: none; \} \}/,
    );
    expect(odometer.match(/animation|transition/g)).toHaveLength(1);
  });
});

// @traces 248-FR-007
describe('the odometer read aloud in both languages', () => {
  it('speaks the value in Romanian, then in English, the digits hidden', async () => {
    const { fixture, part, spoken } = render(125000, 160000);

    expect(spoken()).toBe('1.250–1.600 lei');

    await TestBed.inject(I18n).use('en');
    fixture.detectChanges();

    expect(spoken()).toBe('1,250–1,600 lei');
    for (const digit of part().querySelectorAll('.mf-odometer-digit'))
      expect(digit.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});

@Component({
  imports: [Odometer],
  template: `<mf-odometer [from]="from()" [cells]="5" />`,
})
class CellsHost {
  readonly from = signal<unknown>(0);
}

function renderCells(from: unknown) {
  const fixture = TestBed.createComponent(CellsHost);
  fixture.componentInstance.from.set(from);
  fixture.detectChanges();
  const part = (fixture.nativeElement as HTMLElement).querySelector(
    'mf-odometer',
  ) as HTMLElement;
  const digits = () => [
    ...part.querySelectorAll<HTMLElement>('.mf-odometer-digit'),
  ];
  return {
    digits: () =>
      digits()
        .map((d) => d.textContent)
        .join(''),
    dim: () => digits().map((d) => d.classList.contains('mf-odometer-dim')),
    fixture,
    part,
  };
}

// @traces 356-FR-004
describe('Odometer in cells', () => {
  it('pads whole lei with leading zeros to the cells asked, with no separator or unit', () => {
    const { digits, part } = renderCells(104000);

    expect(digits()).toBe('01040');
    expect(part.textContent).not.toContain('lei');
    expect(part.textContent).not.toContain('.');
  });

  it('grows past the cells asked for a larger amount', () => {
    expect(renderCells(12345600).digits()).toBe('123456');
  });

  it('rounds bani to the nearest whole leu', () => {
    expect(renderCells(15049).digits()).toBe('00150');
    expect(renderCells(15050).digits()).toBe('00151');
  });

  it('dims the leading zeros, and all but the last cell of zero', () => {
    expect(renderCells(15000).dim()).toEqual([true, true, false, false, false]);
    expect(renderCells(0).dim()).toEqual([true, true, true, true, false]);
  });

  it('keeps the cells away from assistive technology and has no live region', () => {
    const { part } = renderCells(104000);

    expect(part.querySelectorAll('[aria-live]')).toHaveLength(0);
    expect(
      part.querySelector('.mf-odometer-value')?.getAttribute('aria-hidden'),
    ).toBe('true');
  });

  it('shows the dash for an amount that is not a number', () => {
    const { digits, part } = renderCells(Number.NaN);

    expect(digits()).toBe('');
    expect(part.textContent?.trim()).toBe('—');
  });

  it('dims the leading zeros in the secondary ink, which holds contrast in both schemes', () => {
    const source = readFileSync(join(__dirname, 'odometer.ts'), 'utf8');

    expect(source).toMatch(
      /\.mf-odometer-dim::before \{\s*color: var\(--mf-text-secondary\);/,
    );
  });

  it('rolls to the new amount when it changes', () => {
    const { digits, fixture } = renderCells(104000);

    fixture.componentInstance.from.set(15000);
    fixture.detectChanges();

    expect(digits()).toBe('00150');
  });
});
