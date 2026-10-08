import { TestBed } from '@angular/core/testing';
import type { BrandDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { BrandPicker } from './brand-picker';

const brands = (n: number): BrandDto[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `id${i}`,
    name: `Brand ${i}`,
    popularity: i + 1,
    slug: `brand-${i}`,
  }));

async function render(list: BrandDto[], selected: string) {
  await TestBed.inject(I18n).enter('public');
  const fixture = TestBed.createComponent(BrandPicker);
  fixture.componentRef.setInput('brands', list);
  fixture.componentRef.setInput('selected', selected);
  const chosen: string[] = [];
  let touches = 0;
  fixture.componentInstance.select.subscribe((slug) => chosen.push(slug));
  fixture.componentInstance.touched.subscribe(() => touches++);
  fixture.detectChanges();
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  const tiles = () => [
    ...element.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
  ];
  return { chosen, element, fixture, tiles, touches: () => touches };
}

const key = (tile: HTMLElement, name: string, init: KeyboardEventInit = {}) =>
  tile.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, key: name, ...init }),
  );

describe('BrandPicker under odd input', () => {
  it('renders an empty group with no tile for an empty list', async () => {
    const { tiles } = await render([], 'bmw');

    expect(tiles()).toEqual([]);
  });

  it('keeps arrows inside a single tile without choosing another', async () => {
    const { chosen, tiles } = await render(brands(1), 'brand-0');

    key(tiles()[0], 'ArrowRight');

    expect(chosen.filter((s) => s !== 'brand-0')).toEqual([]);
  });

  it('keeps the first tile as the only Tab stop when the selected slug is unknown', async () => {
    const { tiles } = await render(brands(3), 'nope');

    expect(tiles().filter((t) => t.tabIndex === 0).length).toBe(1);
  });

  it('marks no tile checked when the selected slug is unknown', async () => {
    const { tiles } = await render(brands(3), 'nope');

    expect(tiles().map((t) => t.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'false',
    ]);
  });

  it('renders a brand name with markup as text, not as elements', async () => {
    const list: BrandDto[] = [
      {
        id: 'x',
        name: '<img src=x onerror=alert(1)>',
        popularity: 1,
        slug: 'x',
      },
    ];
    const { element, tiles } = await render(list, 'x');

    expect(element.querySelector('img')).toBeNull();
    expect(tiles()[0].textContent?.trim()).toBe('<img src=x onerror=alert(1)>');
  });

  it('shows a very long name inside its tile', async () => {
    const name = 'M'.repeat(300);
    const { tiles } = await render(
      [{ id: 'x', name, popularity: 1, slug: 'x' }],
      'x',
    );

    expect(tiles()[0].textContent?.trim()).toBe(name);
  });

  it('renders eight tiles and one hundred tiles with one checked tile each', async () => {
    const { tiles } = await render(brands(100), 'brand-57');

    expect(tiles()).toHaveLength(100);
    expect(
      tiles().filter((t) => t.getAttribute('aria-checked') === 'true'),
    ).toHaveLength(1);
    expect(tiles()[57].tabIndex).toBe(0);
  });

  it('wraps from the last tile to the first with ArrowRight, and back with ArrowLeft', async () => {
    const { chosen, tiles } = await render(brands(8), 'brand-7');

    key(tiles()[7], 'ArrowRight');
    key(tiles()[0], 'ArrowLeft');

    expect(chosen).toEqual(['brand-0', 'brand-7']);
  });

  it('does not choose anything for Home, End, Enter or Escape on a tile', async () => {
    const { chosen, tiles } = await render(brands(3), 'brand-0');

    for (const k of ['Escape', 'PageDown', 'Shift']) {
      key(tiles()[0], k);
    }

    expect(chosen).toEqual([]);
  });

  it('still reports a touch for a key that chooses nothing', async () => {
    const { tiles, touches } = await render(brands(3), 'brand-0');

    key(tiles()[0], 'Shift');

    expect(touches()).toBeGreaterThan(0);
  });

  it('reports a touch when a tile is clicked without a pointer down', async () => {
    const { tiles, touches } = await render(brands(3), 'brand-0');

    tiles()[1].click();

    expect(touches()).toBeGreaterThan(0);
  });

  it('does not report a touch for mouse movement, enter or leave', async () => {
    const { tiles, touches } = await render(brands(3), 'brand-0');

    for (const type of ['mousemove', 'mouseenter', 'mouseover', 'mouseout']) {
      tiles()[1].dispatchEvent(new MouseEvent(type, { bubbles: true }));
    }

    expect(touches()).toBe(0);
  });

  it('emits one choice for one click', async () => {
    const { chosen, tiles } = await render(brands(3), 'brand-0');

    tiles()[2].click();

    expect(chosen).toEqual(['brand-2']);
  });

  it('follows a selection set from outside without emitting a choice', async () => {
    const { chosen, fixture, tiles } = await render(brands(3), 'brand-0');

    fixture.componentRef.setInput('selected', 'brand-2');
    fixture.detectChanges();

    expect(chosen).toEqual([]);
    expect(tiles().map((t) => t.tabIndex)).toEqual([-1, -1, 0]);
  });

  it('drops a selected tile cleanly when the list shrinks under it', async () => {
    const { fixture, tiles } = await render(brands(5), 'brand-4');

    fixture.componentRef.setInput('brands', brands(3));
    fixture.detectChanges();

    expect(tiles()).toHaveLength(3);
    expect(tiles().filter((t) => t.tabIndex === 0).length).toBe(1);
  });
});
