import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Odometer } from './odometer';

@Component({
  imports: [Odometer],
  template: `<mf-odometer [from]="from()" [cells]="cells()" />`,
})
class Host {
  readonly from = signal<unknown>(0);
  readonly cells = signal<number>(5);
}

function render(from: unknown, cells = 5) {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.from.set(from);
  fixture.componentInstance.cells.set(cells);
  fixture.detectChanges();
  const part = (fixture.nativeElement as HTMLElement).querySelector(
    'mf-odometer',
  ) as HTMLElement;
  const digits = () => [
    ...part.querySelectorAll<HTMLElement>('.mf-odometer-digit'),
  ];
  return {
    dim: () => digits().map((d) => d.classList.contains('mf-odometer-dim')),
    fixture,
    part,
    text: () =>
      digits()
        .map((d) => d.textContent)
        .join(''),
  };
}

// @traces 356-FR-004
describe('Odometer in cells, at the edges', () => {
  it.each([
    [0, '00000'],
    [49, '00000'],
    [50, '00001'],
    [99, '00001'],
    [9_999_900, '99999'],
    [9_999_949, '99999'],
    [9_999_950, '100000'],
    [10_000_000, '100000'],
  ])('shows %p bani as %p', (bani, expected) => {
    expect(render(bani).text()).toBe(expected);
  });

  it('shows a very large amount as plain digits, never in exponent notation', () => {
    const { part, text } = render(1e26);

    expect(text()).toMatch(/^\d+$/);
    expect(part.textContent).not.toMatch(/e\+/i);
  });

  it('shows no minus sign and no NaN for an amount below zero', () => {
    const { part } = render(-15_000);

    expect(part.textContent).not.toContain('-');
    expect(part.textContent).not.toContain('NaN');
  });

  it.each([
    ['infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['text', 'abc'],
    ['an object', {}],
    ['a list', [15_000]],
  ])('shows the dash for %s', (_, value) => {
    const { part, text } = render(value);

    expect(text()).toBe('');
    expect(part.textContent?.trim()).toBe('—');
  });

  it('never prints NaN or undefined for a numeric string', () => {
    const { part } = render('15000');

    expect(part.textContent).not.toMatch(/NaN|undefined|null/);
  });

  it('dims all but the last cell of a zero, and nothing when every cell is a digit', () => {
    expect(render(0, 3).dim()).toEqual([true, true, false]);
    expect(render(10_000, 3).dim()).toEqual([false, false, false]);
    expect(render(0, 1).dim()).toEqual([false]);
  });

  it('dims the zeros before a thousand but not the zeros inside it', () => {
    expect(render(100_000).dim()).toEqual([true, false, false, false, false]);
  });

  it('does not dim the zeros added by growing past the cells asked for', () => {
    expect(render(10_000_000).dim()).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('shows the digits as they are for fewer cells than the amount needs', () => {
    expect(render(15_000, 1).text()).toBe('150');
  });

  it('does not throw for cells of zero and shows the plain digits', () => {
    expect(render(15_000, 0).text()).toBe('150');
    expect(render(0, 0).text()).toBe('0');
  });

  it('shows enough cells for twenty places', () => {
    expect(render(15_000, 20).text()).toBe('00000000000000000150');
  });

  it('pads again when the cells asked for change', () => {
    const { fixture, text } = render(15_000, 5);

    fixture.componentInstance.cells.set(7);
    fixture.detectChanges();

    expect(text()).toBe('0000150');
  });

  it('keeps one cell per digit, each carrying its digit, through many changes', () => {
    const { fixture, part } = render(0);

    for (const bani of [104_000, 15_000, 9_999_900, 0, 12_345_600, 7]) {
      fixture.componentInstance.from.set(bani);
      fixture.detectChanges();
    }

    expect(
      [...part.querySelectorAll<HTMLElement>('.mf-odometer-digit')].map((d) =>
        d.style.getPropertyValue('--mf-digit'),
      ),
    ).toEqual(['0', '0', '0', '0', '0']);
  });
});
