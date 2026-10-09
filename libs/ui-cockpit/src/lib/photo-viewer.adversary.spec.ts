import { Component, signal, viewChild } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';

import { PhotoViewer, type ViewerPhoto } from './photo-viewer';
import { REDUCED_MOTION } from './reduced-motion';

// @traces 310-FR-007 310-FR-008 310-FR-009 310-FR-010 310-FR-011

const THREE: ViewerPhoto[] = [
  {
    alt: 'Photo 1 of 3 · Atelier Dinamo',
    displayUrl: 'https://s/1',
    id: 'p-1',
  },
  {
    alt: 'Photo 2 of 3 · Atelier Dinamo',
    displayUrl: 'https://s/2',
    id: 'p-2',
  },
  {
    alt: 'Photo 3 of 3 · Atelier Dinamo',
    displayUrl: 'https://s/3',
    id: 'p-3',
  },
];

@Component({
  imports: [PhotoViewer],
  template: `
    <button type="button" id="opener">open</button>
    <button type="button" id="fallback">first</button>
    <mf-photo-viewer
      title="Atelier Dinamo"
      [photos]="photos()"
      [labels]="labels"
      (failed)="failures.push($event.id)"
    />
  `,
})
class Host {
  readonly photos = signal(THREE);
  readonly labels = {
    close: 'Close',
    counter: (n: number, total: number) => `${n} / ${total}`,
    next: 'Next',
    previous: 'Previous',
  };
  readonly failures: string[] = [];
  readonly viewer = viewChild.required(PhotoViewer);
}

const requested: string[] = [];
const RealImage = globalThis.Image;
class RecordedImage {
  set src(url: string) {
    requested.push(url);
  }
}

let fixture: ComponentFixture<Host>;
const reduced = signal(false);

beforeEach(async () => {
  requested.length = 0;
  reduced.set(false);
  globalThis.Image = RecordedImage as unknown as typeof Image;
  TestBed.configureTestingModule({
    providers: [{ provide: REDUCED_MOTION, useValue: reduced }],
  });
  fixture = TestBed.createComponent(Host);
  await settle();
});

afterEach(() => {
  globalThis.Image = RealImage;
  jest.restoreAllMocks();
  fixture.destroy();
});

async function settle() {
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const opener = () =>
  fixture.nativeElement.querySelector('#opener') as HTMLButtonElement;
const fallback = () =>
  fixture.nativeElement.querySelector('#fallback') as HTMLButtonElement;
const view = () => document.querySelector<HTMLElement>('[role="dialog"]');
const image = () => view()?.querySelector<HTMLImageElement>('img') ?? null;
const button = (name: string) =>
  [...(view()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
    (b) => b.getAttribute('aria-label') === name,
  );
const text = () => view()?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

async function open(index: number) {
  opener().focus();
  fixture.componentInstance.viewer().open(index, opener(), fallback);
  await settle();
}

async function key(name: string) {
  const target = (document.activeElement as HTMLElement) ?? document.body;
  target.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, key: name }),
  );
  await settle();
}

async function pointer(
  target: Element,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  target.dispatchEvent(
    new MouseEvent('pointerdown', {
      bubbles: true,
      clientX: from.x,
      clientY: from.y,
    }),
  );
  target.dispatchEvent(
    new MouseEvent('pointerup', {
      bubbles: true,
      clientX: to.x,
      clientY: to.y,
    }),
  );
  await settle();
}

const backdrop = () =>
  view()?.querySelector<HTMLElement>('[data-slot="viewer-backdrop"]') ?? null;

const swipe = (dx: number, dy = 0) =>
  pointer(
    image() as HTMLElement,
    { x: 300, y: 200 },
    { x: 300 + dx, y: 200 + dy },
  );

describe('the photo viewer under hostile use', () => {
  it('keeps the first photo when asked for an index below zero', async () => {
    await open(-1);

    expect(text()).toContain('1 / 3');
    expect(image()?.getAttribute('src')).toBe('https://s/1');
  });

  it('keeps the last photo when asked for an index past the end', async () => {
    await open(99);

    expect(text()).toContain('3 / 3');
    expect(image()?.getAttribute('src')).toBe('https://s/3');
  });

  it('opens on the first photo for a not-a-number index', async () => {
    await open(Number.NaN);

    expect(text()).toContain('1 / 3');
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });

  it('opens on the whole photo below a fractional index', async () => {
    await open(1.7);

    expect(text()).toContain('2 / 3');
  });

  it('opens nothing for an empty list', async () => {
    fixture.componentInstance.photos.set([]);
    await settle();

    await open(0);

    expect(view()).toBeNull();
  });

  it('keeps one view when opened twice, on the second index', async () => {
    await open(0);
    await open(2);

    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(text()).toContain('3 / 3');
    await key('Escape');
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
  });

  it('opens nothing and moves nothing on arrow keys while closed', async () => {
    opener().focus();
    await key('ArrowRight');
    await key('Escape');

    expect(view()).toBeNull();
    expect(document.activeElement).toBe(opener());
  });

  it('closes without error and without moving focus when closed already', async () => {
    opener().focus();

    fixture.componentInstance.viewer().close();
    await settle();

    expect(view()).toBeNull();
    expect(document.activeElement).toBe(opener());
  });

  it('closes from close() and gives focus back', async () => {
    await open(1);

    fixture.componentInstance.viewer().close();
    await settle();

    expect(view()).toBeNull();
    expect(document.activeElement).toBe(opener());
  });

  it('moves on a swipe of exactly 50 px', async () => {
    await open(1);

    await swipe(-50);

    expect(text()).toContain('3 / 3');
  });

  it('stays on a swipe of 49 px', async () => {
    await open(1);

    await swipe(-49);

    expect(text()).toContain('2 / 3');
  });

  it('stays on a diagonal move whose horizontal and vertical parts are equal', async () => {
    await open(1);

    await swipe(-80, 80);

    expect(text()).toContain('2 / 3');
  });

  it('moves on a 51 px swipe with 50 px of drift when horizontal still wins', async () => {
    await open(1);

    await swipe(-51, 50);

    expect(text()).toContain('3 / 3');
  });

  it('does not swipe past the last photo or before the first', async () => {
    await open(2);
    await swipe(-200);
    expect(text()).toContain('3 / 3');

    await key('ArrowLeft');
    await key('ArrowLeft');
    await swipe(200);
    expect(text()).toContain('1 / 3');
  });

  it('does not close the view when a swipe ends on the backdrop', async () => {
    await open(1);

    await pointer(
      backdrop() as HTMLElement,
      { x: 10, y: 10 },
      { x: 120, y: 10 },
    );

    expect(view()).not.toBeNull();
  });

  it('does not close the view when the press began on the image and ended on the backdrop', async () => {
    await open(1);

    (image() as HTMLElement).dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }),
    );
    (backdrop() as HTMLElement).dispatchEvent(
      new MouseEvent('pointerup', { bubbles: true, clientX: 5, clientY: 5 }),
    );
    await settle();

    expect(view()).not.toBeNull();
  });

  it('shows 1 / 1 for a single photo with previous and next both disabled', async () => {
    fixture.componentInstance.photos.set([THREE[0]]);
    await settle();

    await open(0);
    await key('ArrowRight');
    await swipe(-100);

    expect(text()).toContain('1 / 1');
    expect(button('Previous')?.disabled).toBe(true);
    expect(button('Next')?.disabled).toBe(true);
  });

  it('asks to preload nothing beyond a single photo', async () => {
    fixture.componentInstance.photos.set([THREE[0]]);
    await settle();
    requested.length = 0;

    await open(0);

    expect(requested.filter((url) => url !== 'https://s/1')).toEqual([]);
  });

  it('does not preload before the first or after the last photo', async () => {
    await open(2);

    expect(requested).toContain('https://s/2');
    expect(requested.some((url) => !/^https:\/\/s\/[123]$/.test(url))).toBe(
      false,
    );
  });

  it('opens on the second entry of a list that repeats an id', async () => {
    fixture.componentInstance.photos.set([
      { alt: 'a', displayUrl: 'https://s/a', id: 'dup' },
      { alt: 'b', displayUrl: 'https://s/b', id: 'dup' },
    ]);
    await settle();

    await open(1);

    expect(image()?.getAttribute('src')).toBe('https://s/b');
    expect(text()).toContain('2 / 2');
  });

  it('closes when a re-read drops every photo and stays closed when they come back', async () => {
    await open(1);

    fixture.componentInstance.photos.set([]);
    await settle();
    expect(view()).toBeNull();

    fixture.componentInstance.photos.set(THREE);
    await settle();

    expect(view()).toBeNull();
  });

  it('shows the first photo for a new list that has none of the viewed ids when it grows', async () => {
    await open(0);

    fixture.componentInstance.photos.set([
      { alt: 'x', displayUrl: 'https://s/x', id: 'x-1' },
      { alt: 'y', displayUrl: 'https://s/y', id: 'y-1' },
    ]);
    await settle();

    expect(image()?.getAttribute('src')).toBe('https://s/x');
    expect(text()).toContain('1 / 2');
  });

  it('shows the placeholder, with no image, for a photo marked failed, and still moves on', async () => {
    fixture.componentInstance.photos.set([
      { ...THREE[0], failed: true },
      THREE[1],
    ]);
    await settle();

    await open(0);
    expect(image()).toBeNull();
    expect(
      view()
        ?.querySelector('[data-slot="viewer-stage"]')
        ?.getAttribute('data-failed'),
    ).toBe('true');

    await key('ArrowRight');
    expect(image()?.getAttribute('src')).toBe('https://s/2');
  });

  it('reports a failure once per image error and not for a photo that loaded', async () => {
    await open(0);

    image()?.dispatchEvent(new Event('load'));
    await settle();

    expect(fixture.componentInstance.failures).toEqual([]);
  });

  it('keeps ten fast arrow presses inside the list', async () => {
    await open(0);

    for (let i = 0; i < 10; i++) await key('ArrowRight');

    expect(text()).toContain('3 / 3');
  });

  it('puts the alt text of the shown photo on the image, whatever characters it holds', async () => {
    const alt = 'Fotografie 1 din 1 · <b>"Ăâî"</b> 🚗';
    fixture.componentInstance.photos.set([{ ...THREE[0], alt }]);
    await settle();

    await open(0);

    expect(image()?.getAttribute('alt')).toBe(alt);
    expect(view()?.querySelector('b')).toBeNull();
  });
});
