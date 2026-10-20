import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component, PLATFORM_ID, signal, viewChild } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { Layout, type LayoutName } from '@motor-fix/ui-cockpit';

import { ResultsSheet } from './results-sheet';

@Component({
  imports: [ResultsSheet],
  template: `
    <mf-results-sheet [forcedFull]="forced()">
      <div class="brands"><button type="button" class="chip">BMW</button></div>
      <div class="found">
        <button type="button" class="card">Atelier Unu</button>
        <input class="field" type="search" />
      </div>
    </mf-results-sheet>
  `,
})
class Host {
  readonly forced = signal(false);
  readonly sheet = viewChild.required(ResultsSheet);
}

// The sheet is 600 px tall and its top (handle and header) 120 px: full
// rests at 0, half at 300, low at 480. The screen is 800 px, so a drag under
// 80 px goes back.
const SHEET = 600;
const TOP = 120;
const layout = signal<LayoutName>('phone');
let fixture: ComponentFixture<Host>;
let push: jest.SpyInstance;
let back: jest.SpyInstance;

async function render(platform = 'browser') {
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
      { provide: Layout, useValue: { current: layout } },
    ],
  });
  await TestBed.inject(I18n).enter('public');
  fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  await settle();
}

async function settle() {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }
}

const host = () =>
  (fixture.nativeElement as HTMLElement).querySelector(
    'mf-results-sheet',
  ) as HTMLElement;
const position = () => host().getAttribute('data-position');
const handle = () => host().querySelector<HTMLButtonElement>('button.handle');
const header = () => host().querySelector<HTMLElement>('.header');
const body = () => host().querySelector<HTMLElement>('.body');
const offset = () => host().style.getPropertyValue('--sheet-y');

function pointer(target: Element | null, type: string, clientY: number) {
  target?.dispatchEvent(
    Object.assign(new MouseEvent(type, { bubbles: true, button: 0, clientY }), {
      pointerId: 1,
    }),
  );
}

async function drag(
  from: number,
  to: number,
  target: Element | null | undefined = handle(),
) {
  pointer(target, 'pointerdown', from);
  pointer(target, 'pointermove', to);
  pointer(target, 'pointerup', to);
  await settle();
}

async function press() {
  handle()?.click();
  await settle();
}

async function toLow() {
  await drag(400, 600);
  expect(position()).toBe('low');
}

beforeEach(() => {
  layout.set('phone');
  history.replaceState(null, '');
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: 800,
  });
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.scrollTo = jest.fn();
  jest
    .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
    .mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('top') ? TOP : SHEET;
    });
  push = jest.spyOn(history, 'pushState');
  back = jest.spyOn(history, 'back').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

// @traces 1358-FR-003 1358-FR-005 1358-FR-015
describe('ResultsSheet on a phone', () => {
  beforeEach(() => render());

  // A short stage (a small phone with the consent bar open) keeps the map's
  // zoom buttons, 104 px from the stage's top, clear of the half sheet.
  it('rests half no higher than under the zoom buttons on a short stage', async () => {
    jest
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('top') ? 40 : 160;
      });
    pointer(handle(), 'pointerdown', 300);
    pointer(handle(), 'pointermove', 301);
    await settle();

    expect(offset()).toBe('105px');
    pointer(handle(), 'pointerup', 301);
    const css = readFileSync(join(__dirname, 'results-sheet.css'), 'utf8');
    expect(css).toMatch(
      /:host \{\s*--rest: min\(max\(50%, 6\.5rem\), calc\(100% - var\(--sheet-top, 160px\)\)\);/,
    );
  });

  it('opens at half', () => {
    expect(position()).toBe('half');
  });

  it('follows the finger while it drags', () => {
    pointer(handle(), 'pointerdown', 400);
    pointer(handle(), 'pointermove', 460);
    fixture.detectChanges();

    expect(offset()).toBe('360px');
  });

  it('rests at the position nearest to where it is let go', async () => {
    await drag(400, 560);
    expect(position()).toBe('low');

    await drag(700, 600);
    expect(position()).toBe('half');

    await drag(400, 180);
    expect(position()).toBe('full');
  });

  it('takes a drag on the handle as a drag, not also as a press', async () => {
    await drag(400, 560);
    handle()?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, detail: 1 }),
    );
    await settle();

    expect(position()).toBe('low');
  });

  it('goes back to where it started after a drag under a tenth of the screen', async () => {
    await drag(400, 470);
    expect(position()).toBe('half');

    await drag(400, 330);
    expect(position()).toBe('half');
  });

  it('may go from low to full in one long drag', async () => {
    await toLow();

    await drag(700, 230);

    expect(position()).toBe('full');
  });

  it('drags from the free space of the header, never from a control in it', async () => {
    const free = header();
    await drag(400, 560, free);
    expect(position()).toBe('low');

    await drag(700, 230, host().querySelector('.chip'));
    expect(position()).toBe('low');
  });

  it('keeps the list scroll apart from the sheet', async () => {
    await drag(400, 560, host().querySelector('.card'));

    expect(position()).toBe('half');
  });

  // @traces 1358-FR-012
  it('cycles low, half, full and low again from the handle, saying what it does next', async () => {
    await toLow();
    expect(handle()?.getAttribute('aria-expanded')).toBe('false');
    expect(handle()?.getAttribute('aria-label')).toBe(
      'Arată mai mult din listă',
    );

    await press();
    expect(position()).toBe('half');
    expect(handle()?.getAttribute('aria-expanded')).toBe('true');
    expect(handle()?.getAttribute('aria-label')).toBe(
      'Arată mai mult din listă',
    );

    await press();
    expect(position()).toBe('full');
    expect(handle()?.getAttribute('aria-expanded')).toBe('true');
    expect(handle()?.getAttribute('aria-label')).toBe(
      'Arată mai mult din hartă',
    );

    await press();
    expect(position()).toBe('low');
  });

  // @traces 1358-FR-012 1358-FR-014
  it('names the handle in English', async () => {
    await TestBed.inject(I18n).use('en');
    await settle();
    expect(handle()?.getAttribute('aria-label')).toBe('Show more of the list');

    await press();
    expect(handle()?.getAttribute('aria-label')).toBe('Show more of the map');
  });

  // @traces 1358-FR-012
  it('keeps focus on the handle that moved it, and hides no card by its position', async () => {
    await toLow();
    handle()?.focus();
    await press();

    expect(document.activeElement).toBe(handle());
    expect(
      host().querySelector(
        '.body[inert], .body [inert], .body [aria-hidden="true"]',
      ),
    ).toBeNull();
  });

  // @traces 1358-FR-007
  it('raises low to half and leaves half and full where they are', async () => {
    const sheet = fixture.componentInstance.sheet();
    await toLow();

    sheet.raise();
    await settle();
    expect(position()).toBe('half');

    sheet.raise();
    await settle();
    expect(position()).toBe('half');

    await press();
    sheet.raise();
    await settle();
    expect(position()).toBe('full');
  });

  // @traces 1358-FR-008
  it('sends the list to its top and keeps the position', async () => {
    await toLow();

    fixture.componentInstance.sheet().toTop(true);
    await settle();

    expect(body()?.scrollTo).toHaveBeenCalledWith({
      behavior: 'smooth',
      top: 0,
    });
    expect(position()).toBe('low');
  });

  // @traces 1358-FR-012
  it('raises a low sheet when a card in it takes focus', async () => {
    await toLow();

    host().querySelector<HTMLButtonElement>('.card')?.focus();
    await settle();

    expect(position()).toBe('half');
  });

  // @traces 1358-FR-004
  it('rests on the screen edge while a field takes text, the tab bar hidden', async () => {
    const field = host().querySelector<HTMLInputElement>('.field');

    field?.focus();
    await settle();
    expect(host().classList.contains('typing')).toBe(true);

    field?.blur();
    await settle();
    expect(host().classList.contains('typing')).toBe(false);
  });
});

// @traces 1358-FR-009 1358-FR-013
describe('ResultsSheet and the back button', () => {
  beforeEach(() => render());

  const popped = async (state: unknown = null) => {
    history.replaceState(state, '');
    window.dispatchEvent(new PopStateEvent('popstate', { state }));
    await settle();
  };

  it('adds one step at the same address, keeping the state, when the visitor drags it full', async () => {
    history.replaceState({ navigationId: 3 }, '');
    const address = location.href;

    await drag(400, 180);

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith({ mfSheet: true, navigationId: 3 }, '');
    expect(location.href).toBe(address);
  });

  it('adds the step when the handle takes it full', async () => {
    await press();

    expect(position()).toBe('full');
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('adds no step for low or half', async () => {
    await toLow();
    await press();

    expect(position()).toBe('half');
    expect(push).not.toHaveBeenCalled();
  });

  it('goes back to half on the back button from full, and stays on the page', async () => {
    await drag(400, 180);

    await popped();

    expect(position()).toBe('half');
    expect(back).not.toHaveBeenCalled();
  });

  it('goes back over its step when the visitor leaves full by hand', async () => {
    await drag(400, 180);

    await drag(200, 420);

    expect(position()).toBe('half');
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('goes back over nothing when the page pushed an address over its step', async () => {
    await press();
    history.pushState({ navigationId: 7 }, '', '?brand=audi');

    await press();

    expect(position()).toBe('low');
    expect(back).not.toHaveBeenCalled();
  });

  it('goes back over its step when the handle leaves full', async () => {
    await press();
    await press();

    expect(position()).toBe('low');
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('leaves the sheet at half on a step it reaches again by going forward', async () => {
    await popped({ mfSheet: true });

    expect(position()).toBe('half');
    expect(push).not.toHaveBeenCalled();
  });

  it('goes one further on a back over a step it reached by going forward, so the back leaves the page', async () => {
    await drag(400, 180);
    await popped();
    await popped({ mfSheet: true });
    expect(back).not.toHaveBeenCalled();

    await popped({ navigationId: 3 });

    expect(position()).toBe('half');
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('goes one further on a back from its own step that lands on one reached again', async () => {
    await popped({ mfSheet: true });
    await press();
    await popped({ mfSheet: true });
    expect(position()).toBe('half');
    expect(back).not.toHaveBeenCalled();

    await popped({ navigationId: 3 });

    expect(back).toHaveBeenCalledTimes(1);
  });

  // @traces 1358-FR-009
  it('lets a forward off a step it reached again stay forward', async () => {
    const at = { index: 1 };
    Object.defineProperty(globalThis, 'navigation', {
      configurable: true,
      value: { currentEntry: at },
    });
    try {
      await popped({ mfSheet: true });
      at.index = 2;
      await popped({ navigationId: 3 });

      expect(back).not.toHaveBeenCalled();

      at.index = 1;
      await popped({ mfSheet: true });
      at.index = 0;
      await popped({ navigationId: 2 });

      expect(back).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.deleteProperty(globalThis, 'navigation');
    }
  });

  it("goes no further on a plain back between the page's own steps", async () => {
    await popped({ navigationId: 2 });

    expect(back).not.toHaveBeenCalled();
  });

  it('rests full with no step when it is forced, and the visitor may still drag it down', async () => {
    fixture.componentInstance.forced.set(true);
    await settle();

    expect(position()).toBe('full');
    expect(push).not.toHaveBeenCalled();

    await drag(200, 420);

    expect(position()).toBe('half');
    expect(back).not.toHaveBeenCalled();

    fixture.componentInstance.forced.set(false);
    await settle();
    expect(position()).toBe('half');
  });
});

// @traces 1358-FR-003
describe('ResultsSheet holding the pointer', () => {
  it('lets the handle hold its own pointer, so a press still clicks it', async () => {
    const holders: Element[] = [];
    Element.prototype.setPointerCapture = function (this: Element) {
      holders.push(this);
    };
    await render();

    pointer(handle(), 'pointerdown', 400);
    pointer(handle(), 'pointerup', 400);
    pointer(header(), 'pointerdown', 400);
    pointer(header(), 'pointerup', 400);
    await settle();

    expect(holders).toEqual([handle(), host().querySelector('.top')]);
  });
});

describe('ResultsSheet forced full across 768 px', () => {
  it('stays full when the map failed', async () => {
    layout.set('tablet');
    await render();
    fixture.componentInstance.forced.set(true);
    await settle();

    layout.set('phone');
    await settle();

    expect(position()).toBe('full');
    expect(push).not.toHaveBeenCalled();
  });

  // @traces 1358-FR-009
  it('goes back to full with no step after the visitor dragged it down', async () => {
    await render();
    fixture.componentInstance.forced.set(true);
    await settle();
    await drag(100, 500);
    expect(position()).not.toBe('full');

    layout.set('tablet');
    await settle();
    layout.set('phone');
    await settle();

    expect(position()).toBe('full');
    expect(push).not.toHaveBeenCalled();
  });
});

describe('ResultsSheet after a reload on its step', () => {
  it('opens at half', async () => {
    history.replaceState({ mfSheet: true }, '');

    await render();

    expect(position()).toBe('half');
    expect(push).not.toHaveBeenCalled();
  });

  // @traces 1358-FR-009
  it('goes one further on the back over it, so the back leaves the page', async () => {
    history.replaceState({ mfSheet: true }, '');
    await render();

    history.replaceState({ navigationId: 1 }, '');
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    await settle();

    expect(back).toHaveBeenCalledTimes(1);
  });
});

// @traces 1358-FR-001 1358-FR-011
describe('ResultsSheet from a tablet up', () => {
  it('draws no handle and leaves the list in the page', async () => {
    layout.set('tablet');
    await render();

    expect(handle()).toBeNull();
    expect(host().querySelector('.found .card')).not.toBeNull();
  });

  it('takes no drag and adds no step there', async () => {
    layout.set('tablet');
    await render();

    await drag(400, 100, header());
    await drag(100, 700, header());

    expect(host().getAttribute('data-position')).toBe('half');
    expect(push).not.toHaveBeenCalled();
  });

  it('sets its boxes aside in the stylesheet from 768 px', () => {
    const css = readFileSync(join(__dirname, 'results-sheet.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ');
    const wide =
      css.match(
        /@media \(min-width: 768px\) \{((?:[^{}]*\{[^}]*\})*)[^}]*\}/,
      )?.[1] ?? '';

    expect(wide).toMatch(/:host[^{]*\{[^}]*display: contents/);
    expect(wide).toMatch(/\.body[^{]*\{[^}]*display: contents/);
  });

  // @traces 1358-FR-003
  it('moves with the theme easing, and not at all under reduced motion', () => {
    const css = readFileSync(join(__dirname, 'results-sheet.css'), 'utf8');

    expect(css).toMatch(
      /prefers-reduced-motion: no-preference[\s\S]*transition: transform 420ms var\(--mf-motion-ease\)/,
    );
  });

  it('slides up when it opens, with the theme easing, and not under reduced motion', () => {
    const css = readFileSync(join(__dirname, 'results-sheet.css'), 'utf8');
    const calm =
      css.match(
        /@media \(prefers-reduced-motion: no-preference\) \{((?:[^{}]*\{[^}]*\})*)[^}]*\}/,
      )?.[1] ?? '';

    expect(calm).toMatch(/animation: sheet-in 420ms var\(--mf-motion-ease\)/);
    expect(css).toMatch(
      /@keyframes sheet-in \{\s*from \{\s*transform: translateY\(100%\);/,
    );
  });

  it('wears the theme panel corners and its top line', () => {
    const css = readFileSync(join(__dirname, 'results-sheet.css'), 'utf8');

    expect(css).toMatch(
      /border-radius: var\(--mf-radius-panel\) var\(--mf-radius-panel\) 0 0;/,
    );
    expect(css).toMatch(/border-top: 1px solid var\(--mf-line\);/);
  });
});

describe('ResultsSheet on the server', () => {
  it('renders at half and touches no history', async () => {
    await render('server');

    expect(position()).toBe('half');
    expect(push).not.toHaveBeenCalled();
  });
});
