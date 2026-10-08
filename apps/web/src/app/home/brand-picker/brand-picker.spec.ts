import { TestBed } from '@angular/core/testing';
import type { BrandDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { BrandPicker } from './brand-picker';

const BRANDS: BrandDto[] = [
  { id: 'b1', name: 'BMW', popularity: 1, slug: 'bmw' },
  { id: 'b2', name: 'Mercedes-Benz', popularity: 3, slug: 'mercedes-benz' },
  { id: 'b3', name: 'Dacia', popularity: 7, slug: 'dacia' },
];

async function render(selected = 'bmw') {
  await TestBed.inject(I18n).enter('public');
  const fixture = TestBed.createComponent(BrandPicker);
  fixture.componentRef.setInput('brands', BRANDS);
  fixture.componentRef.setInput('selected', selected);
  const chosen: string[] = [];
  let touches = 0;
  fixture.componentInstance.select.subscribe((slug) => {
    chosen.push(slug);
    fixture.componentRef.setInput('selected', slug);
  });
  fixture.componentInstance.touched.subscribe(() => touches++);
  fixture.detectChanges();
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  const tiles = () => [
    ...element.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
  ];
  return { chosen, element, fixture, tiles, touches: () => touches };
}

const key = (tile: HTMLElement, name: string) =>
  tile.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, key: name }),
  );

describe('BrandPicker', () => {
  it('is one radio group named for the car brand, a button per brand', async () => {
    const { element, tiles } = await render();

    const group = element.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute('aria-label')).toBe('Marca mașinii');
    expect(tiles().map((t) => [t.tagName, t.textContent?.trim()])).toEqual([
      ['BUTTON', 'BMW'],
      ['BUTTON', 'Mercedes-Benz'],
      ['BUTTON', 'Dacia'],
    ]);
  });

  it('marks only the selected tile as checked and the only Tab stop', async () => {
    const { tiles } = await render('dacia');

    expect(tiles().map((t) => t.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'true',
    ]);
    expect(tiles().map((t) => t.tabIndex)).toEqual([-1, -1, 0]);
  });

  it('chooses the brand a tile is clicked for', async () => {
    const { chosen, fixture, tiles } = await render();

    tiles()[2].click();
    fixture.detectChanges();

    expect(chosen).toEqual(['dacia']);
    expect(tiles()[2].getAttribute('aria-checked')).toBe('true');
    expect(tiles()[0].getAttribute('aria-checked')).toBe('false');
  });

  it('moves the selection and the focus with the arrow keys, wrapping at both ends', async () => {
    const { chosen, fixture, tiles } = await render();

    key(tiles()[0], 'ArrowRight');
    fixture.detectChanges();
    expect(document.activeElement).toBe(tiles()[1]);
    key(tiles()[1], 'ArrowDown');
    fixture.detectChanges();
    key(tiles()[2], 'ArrowRight');
    fixture.detectChanges();
    key(tiles()[0], 'ArrowLeft');
    fixture.detectChanges();
    key(tiles()[2], 'ArrowUp');
    fixture.detectChanges();

    expect(chosen).toEqual([
      'mercedes-benz',
      'dacia',
      'bmw',
      'dacia',
      'mercedes-benz',
    ]);
    expect(tiles().map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('chooses nothing for a key that is not an arrow', async () => {
    const { chosen, tiles } = await render();

    key(tiles()[0], 'a');

    expect(chosen).toEqual([]);
  });

  it.each([
    [
      'a pointer down',
      (t: HTMLElement) =>
        t.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })),
    ],
    ['a key press', (t: HTMLElement) => key(t, 'Tab')],
    [
      'keyboard focus',
      (t: HTMLElement) =>
        t.dispatchEvent(new FocusEvent('focusin', { bubbles: true })),
    ],
  ])('reports the first touch on %s', async (_, touch) => {
    const { tiles, touches } = await render();

    touch(tiles()[1]);

    expect(touches()).toBeGreaterThan(0);
  });

  it('does not count the mouse passing over as a touch', async () => {
    const { tiles, touches } = await render();

    tiles()[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

    expect(touches()).toBe(0);
  });

  it('names the group in English when the page is English', async () => {
    const { element, fixture } = await render();

    await TestBed.inject(I18n).use('en');
    fixture.detectChanges();

    expect(
      element.querySelector('[role="radiogroup"]')?.getAttribute('aria-label'),
    ).toBe('Car brand');
  });
});
