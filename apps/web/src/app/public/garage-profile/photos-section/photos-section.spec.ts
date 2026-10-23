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
  facilities: [],
  hours: {},
  id: 'g-1',
  jobTypes: [],
  name: 'Atelier Dinamo',
  paymentMethods: { card: false, cash: false, transfer: false },
  photos: [photo(1), photo(2), photo(3)],
  prices: [],
  rating: null,
  refusalPhrase: null,
  responseRate: { state: 'new' },
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
    [reads]="reads()"
    (reread)="rereads = rereads + 1"
  ></section>`,
})
class Host {
  readonly garage = signal(GARAGE);
  readonly reads = signal(1);
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

  it('names a failed tile as a photo that could not load', async () => {
    imageOf(tiles()[1]).dispatchEvent(new Event('error'));
    await settle();

    expect(
      tiles()[1].querySelector('.placeholder')?.getAttribute('aria-label'),
    ).toBe(
      'Fotografie 2 din 3 · Atelier Dinamo · Fotografia nu s‑a putut încărca',
    );
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

  it('shows the placeholder when the re-read brings back the same address', async () => {
    tiles()[1].click();
    await settle();
    viewImage()?.dispatchEvent(new Event('error'));
    await settle();

    await show({ photos: [photo(1), photo(2), photo(3)] });

    expect(fixture.componentInstance.rereads).toBe(1);
    const stage = view()?.querySelector('[data-slot="viewer-stage"]');
    expect(stage?.getAttribute('data-failed')).toBe('true');
    expect(
      stage?.querySelector('.placeholder')?.getAttribute('aria-label'),
    ).toBe(
      'Fotografie 2 din 3 · Atelier Dinamo · Fotografia nu s‑a putut încărca',
    );
    await closeView();
  });

  it('shows the placeholder when the re-read returns the very same profile', async () => {
    tiles()[1].click();
    await settle();
    viewImage()?.dispatchEvent(new Event('error'));
    await settle();

    fixture.componentInstance.reads.update((n) => n + 1);
    await settle();

    expect(fixture.componentInstance.rereads).toBe(1);
    expect(
      view()
        ?.querySelector('[data-slot="viewer-stage"]')
        ?.getAttribute('data-failed'),
    ).toBe('true');
    await closeView();
  });

  it('shows the placeholder when the photo fails again from the fresh address', async () => {
    tiles()[1].click();
    await settle();
    for (const n of [1, 2]) {
      viewImage()?.dispatchEvent(new Event('error'));
      await settle();
      await show({
        photos: [
          photo(1),
          { ...photo(2), displayUrl: `https://s/2.fresh${n}` },
          photo(3),
        ],
      });
    }
    viewImage()?.dispatchEvent(new Event('error'));
    await settle();

    expect(fixture.componentInstance.rereads).toBe(1);
    expect(
      view()
        ?.querySelector('[data-slot="viewer-stage"]')
        ?.getAttribute('data-failed'),
    ).toBe('true');
    await closeView();
  });
});

// @traces 1192-FR-009
describe('the photos section with responsive variants', () => {
  const BASE = '/api/v1/images/g/d-1';
  const PREVIEW = 'WSoDBYCHiIh4h3eAeHd3cXeIcIgI';
  const responsive = (n: number) => ({
    ...photo(n),
    imageBase: `${BASE}/${n}`,
    thumbhash: PREVIEW,
  });
  const listed = (base: string, format: string) =>
    [320, 640, 960, 1600].map((w) => `${base}/${w}.${format} ${w}w`).join(', ');
  const COVER_SIZES = '(max-width: 639px) calc(100vw - 32px), min(66vw, 840px)';
  const TILE_SIZES = '(max-width: 639px) calc(100vw - 32px), min(33vw, 420px)';
  const avifOf = (tile: HTMLElement) =>
    tile.querySelector<HTMLSourceElement>(
      'picture > source[type="image/avif"]',
    );

  beforeEach(() => show({ photos: [responsive(1), responsive(2), photo(3)] }));

  it('offers every AVIF width first and lets the browser pick by the tile width', () => {
    const [cover, second] = tiles();

    expect(avifOf(cover)?.getAttribute('srcset')).toBe(
      listed(`${BASE}/1`, 'avif'),
    );
    expect(avifOf(cover)?.getAttribute('sizes')).toBe(COVER_SIZES);
    expect(avifOf(second)?.getAttribute('srcset')).toBe(
      listed(`${BASE}/2`, 'avif'),
    );
    expect(avifOf(second)?.getAttribute('sizes')).toBe(TILE_SIZES);
  });

  it('falls back to the WebP widths in the image itself', () => {
    const [cover, second] = tiles();

    expect(imageOf(cover).getAttribute('srcset')).toBe(
      listed(`${BASE}/1`, 'webp'),
    );
    expect(imageOf(cover).getAttribute('sizes')).toBe(COVER_SIZES);
    expect(imageOf(cover).getAttribute('src')).toBe(`${BASE}/1/1600.webp`);
    // A lazy image may size itself from its laid-out width first.
    expect(imageOf(second).getAttribute('sizes')).toBe(`auto, ${TILE_SIZES}`);
  });

  it('fetches the cover first and the other tiles only when near', () => {
    const [cover, second] = tiles();

    expect(imageOf(cover).getAttribute('fetchpriority')).toBe('high');
    expect(imageOf(cover).getAttribute('loading')).not.toBe('lazy');
    expect(imageOf(second).getAttribute('fetchpriority')).not.toBe('high');
    expect(imageOf(second).getAttribute('loading')).toBe('lazy');
  });

  it('paints the blurred preview in the tile while the photo loads', () => {
    const [cover, , plain] = tiles();

    expect(cover.style.backgroundImage).toContain('data:image/png;base64,');
    expect(plain.style.backgroundImage).toBe('');
  });

  it('keeps the signed copies for a photo without variants', () => {
    const third = tiles()[2];

    expect(avifOf(third)).toBeNull();
    expect(imageOf(third).getAttribute('src')).toBe('https://s/3.thumb');
    expect(imageOf(third).hasAttribute('srcset')).toBe(false);
  });
});
