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

@Component({
  imports: [Odometer],
  template: `<mf-odometer [from]="from()" [to]="to()" [cells]="cells()" />`,
})
class GroupHost {
  readonly from = signal<unknown>(125000);
  readonly to = signal<unknown>(160000);
  readonly cells = signal<number | undefined>(undefined);
}

function renderGroups(from: unknown, to?: unknown, cells?: number) {
  const fixture = TestBed.createComponent(GroupHost);
  fixture.componentInstance.from.set(from);
  fixture.componentInstance.to.set(to);
  fixture.componentInstance.cells.set(cells);
  fixture.detectChanges();
  const part = (fixture.nativeElement as HTMLElement).querySelector(
    'mf-odometer',
  ) as HTMLElement;
  return {
    fixture,
    groups: () =>
      [...part.querySelectorAll<HTMLElement>('.mf-odometer-group')].map((g) =>
        g.textContent?.trim(),
      ),
    part,
    spoken: () => part.querySelector('[aria-live]')?.textContent?.trim(),
  };
}

// @traces 466-FR-001
describe('the odometer groups at the edges', () => {
  it('collapses equal ends to one group', () => {
    expect(renderGroups(125000, 125000).groups()).toEqual(['1.250 lei']);
  });

  it('keeps a reversed range as two whole groups', () => {
    expect(renderGroups(160000, 125000).groups()).toEqual([
      '1.600–',
      '1.250 lei',
    ]);
  });

  it('keeps a seven-digit range as two groups', () => {
    expect(renderGroups(100_000_000, 250_000_000).groups()).toEqual([
      '1.000.000–',
      '2.500.000 lei',
    ]);
  });

  it('keeps a zero start and a zero end whole', () => {
    expect(renderGroups(0, 0).groups()).toEqual(['0 lei']);
    expect(renderGroups(0, 160000).groups()).toEqual(['0–', '1.600 lei']);
  });

  it('shows one dash and no group when nothing is a number', () => {
    const { groups, part } = renderGroups(undefined, undefined);

    expect(groups()).toEqual(['—']);
    expect(part.textContent).toContain('—');
  });

  it('never nests a group inside a group', () => {
    const { part } = renderGroups(125000, 160000);

    expect(
      part.querySelectorAll('.mf-odometer-group .mf-odometer-group'),
    ).toHaveLength(0);
  });

  it('keeps every digit cell in exactly one group and the groups inside the value', () => {
    const { part } = renderGroups(125000, 160000);

    for (const group of part.querySelectorAll('.mf-odometer-group'))
      expect(group.parentElement?.classList).toContain('mf-odometer-value');
    expect(part.querySelectorAll('.mf-odometer-digit')).toHaveLength(8);
  });
});

// @traces 466-FR-004
describe('the odometer groups beside the other modes', () => {
  it('leaves the spoken text a single complete value after the groups are in', () => {
    const { part, spoken } = renderGroups(125000, 160000);

    expect(spoken()).toBe('1.250–1.600 lei');
    expect(part.querySelectorAll('[aria-live]')).toHaveLength(1);
    expect(
      part.querySelector('.mf-odometer-value')?.getAttribute('aria-hidden'),
    ).toBe('true');
  });

  it('shows one cells group with no unit even when an end is also given', () => {
    const { groups, part } = renderGroups(125000, 160000, 5);

    expect(groups().length).toBeGreaterThan(0);
    expect(part.textContent).not.toContain('lei');
  });

  it('regroups when a single price becomes a range and back', () => {
    const { fixture, groups } = renderGroups(125000, undefined);

    expect(groups()).toEqual(['1.250 lei']);
    fixture.componentInstance.to.set(160000);
    fixture.detectChanges();
    expect(groups()).toEqual(['1.250–', '1.600 lei']);
    fixture.componentInstance.to.set(undefined);
    fixture.detectChanges();
    expect(groups()).toEqual(['1.250 lei']);
  });

  it('rolls the same digit cells in place when the range changes', () => {
    const { fixture, part } = renderGroups(125000, 160000);
    const before = [...part.querySelectorAll('.mf-odometer-digit')];

    fixture.componentInstance.from.set(135000);
    fixture.detectChanges();
    const after = [...part.querySelectorAll('.mf-odometer-digit')];

    expect(after).toEqual(before);
    expect(
      after.map((d) => (d as HTMLElement).style.getPropertyValue('--mf-digit')),
    ).toEqual(['1', '3', '5', '0', '1', '6', '0', '0']);
  });

  it('shows no group for infinity and no Infinity text', () => {
    const { part } = renderGroups(Number.POSITIVE_INFINITY, 160000);

    expect(part.textContent).not.toMatch(/infinity|nan|undefined/i);
  });

  it('shows no NaN or undefined for a hostile range', () => {
    for (const [a, b] of [
      ['abc', {}],
      [[], '1'],
      [125000, Number.NaN],
    ] as const)
      expect(renderGroups(a, b).part.textContent).not.toMatch(
        /nan|undefined|\[object/i,
      );
  });
});
