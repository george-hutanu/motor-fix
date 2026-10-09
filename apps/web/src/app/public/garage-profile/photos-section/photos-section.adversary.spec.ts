import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { PublicGarageDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { PhotosSection } from './photos-section';

// @traces 310-FR-004 310-FR-005 310-FR-006 310-FR-010 310-FR-011

const photo = (n: number) => ({
  displayUrl: `https://s/${n}.display`,
  height: 900,
  id: `p-${n}`,
  thumbnailUrl: `https://s/${n}.thumb`,
  width: 1200,
});

const many = (count: number) =>
  Array.from({ length: count }, (_, i) => photo(i + 1));

const GARAGE: PublicGarageDto = {
  brandNote: null,
  doesNotTake: [],
  id: 'g-1',
  jobTypes: [],
  name: 'Atelier Dinamo',
  paymentMethods: { card: false, cash: false, transfer: false },
  photos: many(3),
  rating: null,
  refusalPhrase: null,
  reviewCount: 0,
  slug: 'atelier-dinamo',
  verifiedAt: null,
  worksOn: [],
};

@Component({
  imports: [PhotosSection],
  template: `<section
    data-slot="photos"
    mf-photos-section
    [garage]="garage()"
    (reread)="rereads = rereads + 1"
  ></section>`,
})
class Host {
  readonly garage = signal(GARAGE);
  rereads = 0;
}

let fixture: ComponentFixture<Host>;

beforeEach(async () => {
  TestBed.configureTestingModule({});
  await TestBed.inject(I18n).enter('public');
  fixture = TestBed.createComponent(Host);
  await settle();
});

afterEach(() => fixture.destroy());

async function settle() {
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const section = () =>
  fixture.nativeElement.querySelector('section') as HTMLElement;
const tiles = () => [
  ...section().querySelectorAll<HTMLButtonElement>('button.tile'),
];
const imageOf = (tile: HTMLElement) =>
  tile.querySelector('img') as HTMLImageElement;
const view = () => document.querySelector<HTMLElement>('[role="dialog"]');
const viewImage = () => view()?.querySelector('img') ?? null;

async function show(garage: Partial<PublicGarageDto>) {
  fixture.componentInstance.garage.set({ ...GARAGE, ...garage });
  await settle();
}

async function press(name: string) {
  (document.activeElement as HTMLElement).dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, key: name }),
  );
  await settle();
}

describe('the photos section under hostile use', () => {
  it('shows a single photo large with no thumbnail row, numbered 1 of 1', async () => {
    await show({ photos: many(1) });

    expect(tiles()).toHaveLength(1);
    expect(tiles()[0].classList).toContain('cover');
    expect(imageOf(tiles()[0]).alt).toBe('Fotografie 1 din 1 · Atelier Dinamo');
  });

  it('lists twenty photos with only the first one eager and the last numbered 20 of 20', async () => {
    await show({ photos: many(20) });

    const loading = tiles().map((tile) =>
      imageOf(tile).getAttribute('loading'),
    );
    expect(loading[0]).toBe('eager');
    expect(loading.slice(1)).toEqual(Array(19).fill('lazy'));
    expect(imageOf(tiles()[19]).alt).toBe(
      'Fotografie 20 din 20 · Atelier Dinamo',
    );
  });

  it('puts a garage name with markup and accents into the alt text as plain text', async () => {
    await show({ name: '<b>Ăţelier</b> "Ș" 🚗' });

    expect(imageOf(tiles()[0]).alt).toBe(
      'Fotografie 1 din 3 · <b>Ăţelier</b> "Ș" 🚗',
    );
    expect(section().querySelector('b')).toBeNull();
  });

  it('numbers only the photos it shows after a re-read drops one', async () => {
    await show({ photos: [photo(1), photo(3)] });

    expect(imageOf(tiles()[1]).alt).toBe('Fotografie 2 din 2 · Atelier Dinamo');
  });

  it('closes the view and renders nothing when a re-read drops every photo while it is open', async () => {
    tiles()[1].click();
    await settle();
    expect(view()).not.toBeNull();

    await show({ photos: [] });

    expect(view()).toBeNull();
    expect(section().children).toHaveLength(0);
  });

  it('keeps the view on the same photo when a re-read puts it first', async () => {
    tiles()[1].click();
    await settle();

    await show({ photos: [photo(2), photo(1), photo(3)] });

    expect(viewImage()?.getAttribute('src')).toBe('https://s/2.display');
    expect(view()?.textContent).toContain('1 / 3');
    await press('Escape');
  });

  it('clamps the view to the last photo when the viewed last photo is deleted', async () => {
    tiles()[2].click();
    await settle();

    await show({ photos: [photo(1), photo(2)] });

    expect(viewImage()?.getAttribute('src')).toBe('https://s/2.display');
    expect(view()?.textContent).toContain('2 / 2');
    await press('Escape');
  });

  it('reads again once for each different photo that fails, not twice for one', async () => {
    tiles()[0].click();
    await settle();
    viewImage()?.dispatchEvent(new Event('error'));
    await settle();
    await press('ArrowRight');
    viewImage()?.dispatchEvent(new Event('error'));
    await settle();

    expect(fixture.componentInstance.rereads).toBe(2);
    await press('Escape');
  });

  it('emits no re-read for a tile image that fails outside the view', async () => {
    imageOf(tiles()[1]).dispatchEvent(new Event('error'));
    await settle();

    expect(fixture.componentInstance.rereads).toBe(0);
    expect(tiles()[1].querySelector('img')).toBeNull();
  });

  it('keeps a failed tile openable in the view', async () => {
    imageOf(tiles()[1]).dispatchEvent(new Event('error'));
    await settle();

    tiles()[1].click();
    await settle();

    expect(view()?.textContent).toContain('2 / 3');
    await press('Escape');
  });

  it('shows the new photos as fresh tiles when the whole set is replaced', async () => {
    await show({ photos: [photo(7), photo(8)] });

    expect(tiles().map((tile) => imageOf(tile).getAttribute('src'))).toEqual([
      'https://s/7.display',
      'https://s/8.thumb',
    ]);
  });

  it('opens the view in English with its controls named in English', async () => {
    await TestBed.inject(I18n).use('en');
    await settle();

    tiles()[0].click();
    await settle();

    expect(view()?.textContent).toContain('1 / 3');
    expect(view()?.querySelector('button[aria-label="Next"]')).not.toBeNull();
    await press('Escape');
  });

  it('opens twice on two different tiles with one view and focus back on the last opener', async () => {
    tiles()[0].click();
    await settle();
    await press('Escape');
    tiles()[2].focus();
    tiles()[2].click();
    await settle();
    await press('Escape');

    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
    expect(document.activeElement).toBe(tiles()[2]);
  });
});
