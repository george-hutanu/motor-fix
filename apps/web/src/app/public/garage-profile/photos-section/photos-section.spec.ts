import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { PublicGarageDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { PhotosSection } from './photos-section';

// @traces 310-FR-004 310-FR-005 310-FR-006 310-FR-007 310-FR-010 310-FR-011 310-FR-012

const photo = (n: number) => ({
  displayUrl: `https://s/${n}.display`,
  height: 900,
  id: `p-${n}`,
  thumbnailUrl: `https://s/${n}.thumb`,
  width: 1200,
});

const GARAGE: PublicGarageDto = {
  brandNote: null,
  doesNotTake: [],
  id: 'g-1',
  jobTypes: [],
  name: 'Atelier Dinamo',
  paymentMethods: { card: false, cash: false, transfer: false },
  photos: [photo(1), photo(2), photo(3)],
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

async function closeView() {
  (document.activeElement as HTMLElement).dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
  );
  await settle();
}

describe('the photos section', () => {
  it('shows the first photo large from its display copy, eagerly, and the rest as lazy thumbnails in order', () => {
    const [cover, second, third] = tiles();

    expect(tiles()).toHaveLength(3);
    expect(cover.classList).toContain('cover');
    expect(imageOf(cover).getAttribute('src')).toBe('https://s/1.display');
    expect(imageOf(cover).getAttribute('loading')).toBe('eager');
    expect(imageOf(second).getAttribute('src')).toBe('https://s/2.thumb');
    expect(imageOf(second).getAttribute('loading')).toBe('lazy');
    expect(imageOf(third).getAttribute('src')).toBe('https://s/3.thumb');
    expect(second.classList).not.toContain('cover');
  });

  it('labels itself as the photos', () => {
    expect(section().getAttribute('aria-label')).toBe('Fotografii');
  });

  it('renders nothing for a garage with no photos, so the slot stays hidden', async () => {
    await show({ photos: [] });

    expect(tiles()).toHaveLength(0);
    expect(section().textContent?.trim()).toBe('');
    expect(section().children).toHaveLength(0);
  });

  it('makes every tile a button named with its place and the garage', () => {
    expect(tiles().map((tile) => tile.type)).toEqual([
      'button',
      'button',
      'button',
    ]);
    expect(imageOf(tiles()[1]).alt).toBe('Fotografie 2 din 3 · Atelier Dinamo');
  });

  it('names the tiles and the section in English', async () => {
    await TestBed.inject(I18n).use('en');
    await settle();

    expect(section().getAttribute('aria-label')).toBe('Photos');
    expect(imageOf(tiles()[0]).alt).toBe('Photo 1 of 3 · Atelier Dinamo');
  });

  it('keeps a tile a grey surface until its image has loaded', async () => {
    const [cover] = tiles();
    expect(cover.dataset['loaded']).toBe('false');

    imageOf(cover).dispatchEvent(new Event('load'));
    await settle();

    expect(cover.dataset['loaded']).toBe('true');
  });

  it('holds each tile at the design geometry before any image arrives', () => {
    const css = readFileSync(join(__dirname, 'photos-section.css'), 'utf8');

    expect(css).toMatch(/clamp\(\s*220px,\s*28vw,\s*340px\s*\)/);
  });

  it('shows a placeholder for a tile whose image fails and keeps the others', async () => {
    const [, second, third] = tiles();

    imageOf(second).dispatchEvent(new Event('error'));
    await settle();

    expect(second.dataset['failed']).toBe('true');
    expect(second.querySelector('img')).toBeNull();
    expect(third.dataset['failed']).toBe('false');
    expect(imageOf(third)).not.toBeNull();
  });
});

describe('opening a photo from the section', () => {
  it('opens the view on the photo of the tile clicked', async () => {
    tiles()[1].click();
    await settle();

    expect(viewImage()?.getAttribute('src')).toBe('https://s/2.display');
    expect(view()?.textContent).toContain('2 / 3');
    await closeView();
  });

  it('returns focus to the tile that opened the view when it closes', async () => {
    const tile = tiles()[2];
    tile.focus();
    tile.click();
    await settle();

    expect(viewImage()?.getAttribute('src')).toBe('https://s/3.display');
    await closeView();
    expect(document.activeElement).toBe(tiles()[2]);
  });
});

describe('the photos section kept live', () => {
  it('shows the new order and set after a re-read', async () => {
    await show({ photos: [photo(3), photo(1)] });

    expect(tiles().map((tile) => imageOf(tile).getAttribute('src'))).toEqual([
      'https://s/3.display',
      'https://s/1.thumb',
    ]);
  });

  it('gives focus to the first remaining tile when the opening tile is gone', async () => {
    tiles()[1].click();
    await settle();

    await show({ photos: [photo(1), photo(3)] });
    await closeView();

    expect(document.activeElement).toBe(tiles()[0]);
  });

  it('reads the profile again once when a photo fails in the view', async () => {
    tiles()[1].click();
    await settle();

    viewImage()?.dispatchEvent(new Event('error'));
    await settle();

    expect(fixture.componentInstance.rereads).toBe(1);
    await closeView();
  });

  it('shows the placeholder on a second failure of the same photo and reads nothing more', async () => {
    tiles()[1].click();
    await settle();
    viewImage()?.dispatchEvent(new Event('error'));
    await settle();
    viewImage()?.dispatchEvent(new Event('error'));
    await settle();

    expect(fixture.componentInstance.rereads).toBe(1);
    expect(
      view()
        ?.querySelector('[data-slot="viewer-stage"]')
        ?.getAttribute('data-failed'),
    ).toBe('true');
    view()
      ?.querySelector<HTMLButtonElement>('button[aria-label="Următoarea"]')
      ?.click();
    await settle();
    expect(viewImage()?.getAttribute('src')).toBe('https://s/3.display');
    await closeView();
  });

  it('retries a photo again once a re-read has brought fresh addresses', async () => {
    tiles()[1].click();
    await settle();
    viewImage()?.dispatchEvent(new Event('error'));
    await settle();

    await show({
      photos: [
        photo(1),
        { ...photo(2), displayUrl: 'https://s/2.fresh' },
        photo(3),
      ],
    });
    viewImage()?.dispatchEvent(new Event('error'));
    await settle();

    expect(fixture.componentInstance.rereads).toBe(2);
    await closeView();
  });

  it('stops reading again after two fresh addresses for the same photo', async () => {
    tiles()[1].click();
    await settle();
    for (const n of [1, 2, 3]) {
      await show({
        photos: [
          photo(1),
          { ...photo(2), displayUrl: `https://s/2.fresh${n}` },
          photo(3),
        ],
      });
      viewImage()?.dispatchEvent(new Event('error'));
      await settle();
    }

    expect(fixture.componentInstance.rereads).toBe(2);
    expect(
      view()
        ?.querySelector('[data-slot="viewer-stage"]')
        ?.getAttribute('data-failed'),
    ).toBe('true');
    await closeView();
  });
});
