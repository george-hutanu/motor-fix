import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component, signal, viewChild } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';

import { PhotoViewer, type ViewerPhoto } from './photo-viewer';
import { REDUCED_MOTION } from './reduced-motion';

// @traces 310-FR-007 310-FR-008 310-FR-009 310-FR-010 310-FR-011 310-FR-012 310-FR-014

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

function nameOf(element: HTMLElement) {
  const label = element.getAttribute('aria-label');
  if (label) return label;
  return (element.getAttribute('aria-labelledby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
    .join(' ');
}

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

describe('the photo viewer', () => {
  it('opens on the chosen photo with the garage name and its place in the list', async () => {
    await open(1);

    expect(image()?.getAttribute('src')).toBe('https://s/2');
    expect(image()?.getAttribute('alt')).toBe('Photo 2 of 3 · Atelier Dinamo');
    expect(text()).toContain('Atelier Dinamo');
    expect(text()).toContain('2 / 3');
  });

  it('names itself with the garage and the counter, and says the new counter on a move', async () => {
    await open(0);
    const dialog = view() as HTMLElement;
    expect(nameOf(dialog)).toContain('Atelier Dinamo');
    expect(nameOf(dialog)).toContain('1 / 3');

    await key('ArrowRight');

    const live = dialog.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toContain('2 / 3');
  });

  it('moves with the arrow keys and stops at both ends', async () => {
    await open(0);

    await key('ArrowLeft');
    expect(text()).toContain('1 / 3');
    await key('ArrowRight');
    await key('ArrowRight');
    expect(text()).toContain('3 / 3');
    await key('ArrowRight');
    expect(text()).toContain('3 / 3');
    expect(image()?.getAttribute('src')).toBe('https://s/3');
  });

  it('disables previous on the first photo and next on the last', async () => {
    await open(0);
    expect(button('Previous')?.disabled).toBe(true);
    expect(button('Next')?.disabled).toBe(false);

    button('Next')?.click();
    button('Next')?.click();
    await settle();

    expect(text()).toContain('3 / 3');
    expect(button('Next')?.disabled).toBe(true);
    expect(button('Previous')?.disabled).toBe(false);
  });

  it('moves on a horizontal swipe of at least 50 px', async () => {
    await open(1);

    await pointer(
      image() as HTMLElement,
      { x: 300, y: 200 },
      { x: 240, y: 210 },
    );
    expect(text()).toContain('3 / 3');

    await pointer(
      image() as HTMLElement,
      { x: 100, y: 200 },
      { x: 170, y: 190 },
    );
    expect(text()).toContain('2 / 3');
  });

  it('stays on a short or mostly vertical move', async () => {
    await open(1);

    await pointer(
      image() as HTMLElement,
      { x: 300, y: 200 },
      { x: 260, y: 200 },
    );
    await pointer(
      image() as HTMLElement,
      { x: 300, y: 100 },
      { x: 240, y: 200 },
    );

    expect(text()).toContain('2 / 3');
  });

  it('closes on a tap on the backdrop but not on the image', async () => {
    await open(0);

    await pointer(
      image() as HTMLElement,
      { x: 200, y: 200 },
      { x: 202, y: 201 },
    );
    expect(view()).not.toBeNull();

    await pointer(
      backdrop() as HTMLElement,
      { x: 10, y: 10 },
      { x: 12, y: 11 },
    );
    expect(view()).toBeNull();
  });

  it('closes on Esc and gives focus back to the element that opened it', async () => {
    await open(2);

    await key('Escape');

    expect(view()).toBeNull();
    expect(document.activeElement).toBe(opener());
  });

  it('closes with its close button and gives focus back', async () => {
    await open(0);

    button('Close')?.click();
    await settle();

    expect(view()).toBeNull();
    expect(document.activeElement).toBe(opener());
  });

  it('takes focus inside the view and traps it there while open', async () => {
    await open(0);

    expect(view()?.contains(document.activeElement)).toBe(true);
    expect(document.querySelectorAll('.cdk-focus-trap-anchor').length).toBe(2);
  });

  it('blocks the page scroll behind it while open', async () => {
    // jsdom lays nothing out, and the CDK only blocks a page taller than the window.
    jest
      .spyOn(document.documentElement, 'scrollHeight', 'get')
      .mockReturnValue(window.innerHeight * 4);
    await open(0);
    expect(
      document.documentElement.classList.contains('cdk-global-scrollblock'),
    ).toBe(true);

    await key('Escape');
    expect(
      document.documentElement.classList.contains('cdk-global-scrollblock'),
    ).toBe(false);
  });

  it('starts loading the photos on either side of the one it shows', async () => {
    await open(1);

    expect(requested).toEqual(
      expect.arrayContaining(['https://s/1', 'https://s/3']),
    );

    requested.length = 0;
    await key('ArrowRight');
    expect(requested).toContain('https://s/2');
    expect(requested).not.toContain('https://s/4');
  });

  it('shows a grey surface in place of the photo until it has loaded', async () => {
    await open(0);
    const stage = view()?.querySelector<HTMLElement>(
      '[data-slot="viewer-stage"]',
    );
    expect(stage?.dataset['loaded']).toBe('false');

    image()?.dispatchEvent(new Event('load'));
    await settle();

    expect(stage?.dataset['loaded']).toBe('true');
  });

  it('drops the fade when the visitor asks for reduced motion', async () => {
    reduced.set(true);
    await open(0);

    expect(
      view()
        ?.querySelector('[data-slot="viewer-stage"]')
        ?.hasAttribute('data-still'),
    ).toBe(true);
  });

  it('gives previous, next and close a touch target of at least 44 px', () => {
    const source = readFileSync(join(__dirname, 'photo-viewer.ts'), 'utf8');

    expect(source).toMatch(/min-(width|inline-size):\s*44px/);
    expect(source).toMatch(/min-(height|block-size):\s*44px/);
  });

  it('is built from Angular and the Cockpit alone, with no new runtime dependency', () => {
    const source = readFileSync(join(__dirname, 'photo-viewer.ts'), 'utf8');
    const modules = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);

    expect(
      modules.filter((m) => !/^(@angular\/(core|cdk\/.+)|\.\/.+)$/.test(m)),
    ).toEqual([]);
  });
});

describe('the photo viewer after the list changes', () => {
  it('stays on the same photo when it moved in the list', async () => {
    await open(1);

    fixture.componentInstance.photos.set([THREE[1], THREE[0], THREE[2]]);
    await settle();

    expect(image()?.getAttribute('src')).toBe('https://s/2');
    expect(text()).toContain('1 / 3');
  });

  it('shows the photo at the same place, kept within the list, when its photo is gone', async () => {
    await open(2);

    fixture.componentInstance.photos.set([THREE[0], THREE[1]]);
    await settle();

    expect(image()?.getAttribute('src')).toBe('https://s/2');
    expect(text()).toContain('2 / 2');
  });

  it('closes when no photo is left', async () => {
    await open(0);

    fixture.componentInstance.photos.set([]);
    await settle();

    expect(view()).toBeNull();
  });

  it('tells its host which photo failed to load', async () => {
    await open(1);

    image()?.dispatchEvent(new Event('error'));
    await settle();

    expect(fixture.componentInstance.failures).toEqual(['p-2']);
  });

  it('takes its view off the page when its host removes it while open', async () => {
    await open(1);

    fixture.destroy();

    expect(view()).toBeNull();
  });

  it('gives focus to the fallback the host named when the opener is gone', async () => {
    await open(0);
    opener().remove();

    await key('Escape');

    expect(document.activeElement).toBe(fallback());
  });
});
