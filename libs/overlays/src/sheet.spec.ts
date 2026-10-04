import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import {
  injectOverlayTask,
  type OverlayResult,
  type OverlayShape,
  Overlays,
} from './index';

@Component({
  template: `
    <label for="plate">Număr</label>
    <input id="plate" />
    <button id="done" type="button" (click)="task.close('saved')">Gata</button>
  `,
})
class FieldTask {
  readonly task = injectOverlayTask<undefined, 'saved'>();
}

@Component({
  template: `<button id="opener" type="button" (click)="open()">Deschide</button>`,
})
class Host {
  private readonly overlays = inject(Overlays);
  shape: OverlayShape = 'dialog';
  result?: Promise<OverlayResult<'saved'>>;

  open() {
    this.result = this.overlays.open<'saved'>(FieldTask, {
      shape: this.shape,
      title: 'shell.brand',
    });
  }
}

let wide = false;
let sheetHeight = 300;

function fakeViewport(height: number, offsetTop = 0) {
  const viewport = Object.assign(new EventTarget(), { height, offsetTop });
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: viewport,
  });
  return viewport;
}

beforeEach(() => {
  wide = false;
  sheetHeight = 300;
  globalThis.matchMedia = (query: string) =>
    ({
      addEventListener() {},
      addListener() {},
      matches: wide && query.includes('min-width: 768px'),
      media: query,
      removeEventListener() {},
      removeListener() {},
    }) as unknown as MediaQueryList;
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: 844,
  });
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: undefined,
  });
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.scrollIntoView = jest.fn();
  jest
    .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
    .mockImplementation(() => sheetHeight);
});

afterEach(() => {
  jest.restoreAllMocks();
  document.querySelector('.cdk-overlay-container')?.remove();
});

async function settle() {
  for (let i = 0; i < 3; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function openTask(shape: OverlayShape = 'dialog') {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.shape = shape;
  fixture.detectChanges();
  document.querySelector<HTMLButtonElement>('#opener')?.click();
  await settle();
  return fixture.componentInstance;
}

const panel = () =>
  document.querySelector<HTMLElement>(
    '.cdk-overlay-pane mf-overlay-panel',
  ) as HTMLElement;
const grip = () => panel()?.querySelector<HTMLElement>('.mf-overlay-grip');
const open = () => document.querySelectorAll('mf-overlay-panel').length;
const dragOffset = () => panel().style.getPropertyValue('--mf-drag');

// jsdom has no PointerEvent: a mouse event with a pointer id stands in.
function pointerEvent(type: string, clientY: number, button = 0) {
  return Object.assign(
    new MouseEvent(type, { bubbles: true, button, clientY }),
    { pointerId: 1 },
  );
}

function pointer(type: string, clientY: number, target = grip()) {
  target?.dispatchEvent(pointerEvent(type, clientY));
}

async function drag(by: number, end = 'pointerup') {
  pointer('pointerdown', 100);
  pointer('pointermove', 100 + by);
  await settle();
  const during = dragOffset();
  pointer(end, 100 + by);
  await settle();
  return during;
}

describe('the bottom sheet on a phone', () => {
  it.each([
    'dialog',
    'drawer',
    'drawer-wide',
  ] as const)('shows a %s as a bottom sheet with a grip below 768 px', async (shape) => {
    await openTask(shape);

    const host = panel();
    expect(host.getAttribute('data-side')).toBe('bottom');
    expect(host.classList).toContain('spartan-sheet-content');
    expect(host.classList).toContain('mf-overlay-sheet');
    expect(host.classList).not.toContain('mf-overlay-dialog');
    expect(host.classList).not.toContain('mf-overlay-drawer');
    expect(host.classList).not.toContain('mf-overlay-drawer-wide');
    expect(host.classList).not.toContain('spartan-dialog-content');
    expect(grip()?.getAttribute('aria-hidden')).toBe('true');
  });

  it.each([
    ['dialog', 'mf-overlay-dialog', null],
    ['drawer', 'mf-overlay-drawer', 'right'],
    ['drawer-wide', 'mf-overlay-drawer-wide', 'right'],
  ] as const)('keeps a %s as asked at 768 px and wider, with no grip', async (shape, cls, side) => {
    wide = true;
    await openTask(shape);

    expect(panel().classList).toContain(cls);
    expect(panel().classList).not.toContain('mf-overlay-sheet');
    expect(panel().getAttribute('data-side')).toBe(side);
    expect(grip()).toBeNull();
  });

  it('keeps the shape it opened with when the width changes', async () => {
    await openTask();
    wide = true;
    window.dispatchEvent(new Event('resize'));
    await settle();

    expect(panel().getAttribute('data-side')).toBe('bottom');
  });

  it('focuses the sheet itself, not its field, so no keyboard opens', async () => {
    await openTask();

    expect(document.activeElement).toBe(
      panel().closest('[role="dialog"]') ?? panel(),
    );
  });
});

describe('dragging the grip', () => {
  it('follows the pointer down and springs back from a third or less', async () => {
    await openTask();

    expect(await drag(100)).toBe('100px');
    expect(open()).toBe(1);
    expect(dragOffset()).toBe('');
  });

  it('closes like the X past a third of the height it had at the start', async () => {
    const host = await openTask();

    await drag(101);

    expect(open()).toBe(0);
    await expect(host.result).resolves.toBe('cancelled');
  });

  it('does not move above its resting place', async () => {
    await openTask();

    expect(await drag(-80)).toBe('0px');
    expect(open()).toBe(1);
  });

  it('springs back when the pointer is cancelled, however far it went', async () => {
    await openTask();
    expect(grip()).not.toBeNull();

    await drag(250, 'pointercancel');

    expect(open()).toBe(1);
    expect(dragOffset()).toBe('');
  });

  it('asks the discard question at rest when a field changed', async () => {
    await openTask();
    const field = panel().querySelector<HTMLInputElement>('#plate');
    if (!field) throw new Error('no field');
    field.value = 'B 123 ABC';
    field.dispatchEvent(new Event('input', { bubbles: true }));

    await drag(200);

    expect(open()).toBe(1);
    expect(panel().querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(dragOffset()).toBe('');
  });

  it('ignores a press that is not the primary button', async () => {
    await openTask();
    expect(grip()).not.toBeNull();
    grip()?.dispatchEvent(pointerEvent('pointerdown', 0, 2));
    pointer('pointermove', 250);
    pointer('pointerup', 250);
    await settle();

    expect(open()).toBe(1);
  });
});

describe('the on-screen keyboard', () => {
  it('lifts the sheet to the top of the keyboard and caps it to what is visible', async () => {
    const viewport = fakeViewport(844);
    await openTask();
    const field = panel().querySelector<HTMLInputElement>('#plate');
    field?.focus();

    viewport.height = 500;
    viewport.dispatchEvent(new Event('resize'));
    await settle();

    expect(panel().style.getPropertyValue('--mf-keyboard')).toBe('344px');
    expect(panel().style.getPropertyValue('--mf-visible-height')).toBe('500px');
    expect(field?.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });

    viewport.height = 844;
    viewport.dispatchEvent(new Event('resize'));
    await settle();
    expect(panel().style.getPropertyValue('--mf-keyboard')).toBe('0px');
  });

  it('counts a viewport scrolled by the browser as visible', async () => {
    const viewport = fakeViewport(844);
    await openTask();

    viewport.height = 500;
    viewport.offsetTop = 120;
    viewport.dispatchEvent(new Event('scroll'));
    await settle();

    expect(panel().style.getPropertyValue('--mf-keyboard')).toBe('224px');
  });

  it('leaves a dialog on a computer alone, and stops listening when the sheet closes', async () => {
    const viewport = fakeViewport(844);
    const add = jest.spyOn(viewport, 'addEventListener');
    const remove = jest.spyOn(viewport, 'removeEventListener');
    wide = true;
    await openTask();
    expect(add).not.toHaveBeenCalled();
    panel().querySelector<HTMLButtonElement>('#done')?.click();
    await settle();

    wide = false;
    await openTask();
    expect(add).toHaveBeenCalledWith('resize', expect.any(Function));
    panel().querySelector<HTMLButtonElement>('#done')?.click();
    await settle();
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
  });
});

describe('the sheet styles', () => {
  const css = readFileSync(join(__dirname, 'panel.ts'), 'utf8');
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
  };

  it('caps the sheet at 92 % of the visible height and lifts it by the keyboard', () => {
    const sheet = rule(':host.mf-overlay-sheet');
    expect(sheet).toMatch(
      /max-height:\s*calc\(0\.92 \* var\(--mf-visible-height, 100dvh\)\)/,
    );
    expect(sheet).toMatch(/inset-block-end:\s*var\(--mf-keyboard, 0px\)/);
  });

  it('keeps the body above the bottom safe area and inside the side ones', () => {
    expect(css).toMatch(/max\(var\(--mf-space-6\), var\(--mf-safe-bottom\)\)/);
    const sides = rule(':host.mf-overlay-sheet .mf-overlay-body');
    expect(sides).toMatch(/var\(--mf-safe-left\)/);
    expect(sides).toMatch(/var\(--mf-safe-right\)/);
  });

  it('adds the top safe area to the right-hand drawer only', () => {
    expect(css).toMatch(
      /:host\[data-side='right'\] \.mf-overlay-header\s*{\s*padding-top:\s*calc\(var\(--mf-space-3\) \+ var\(--mf-safe-top\)\)/,
    );
    expect(css).not.toMatch(/:host\.spartan-sheet-content \.mf-overlay-header/);
  });

  it('draws a 36 × 4 px grip in a 44 px row in the strong line colour', () => {
    const row = rule('.mf-overlay-grip');
    expect(row).toMatch(/height:\s*var\(--mf-tap\)/);
    expect(row).toMatch(/touch-action:\s*none/);
    const bar = rule('.mf-overlay-grip::before');
    expect(bar).toMatch(/width:\s*36px/);
    expect(bar).toMatch(/height:\s*4px/);
    expect(bar).toMatch(/background:\s*var\(--mf-line-strong\)/);
  });

  it('springs back on the motion tokens and follows the finger with no transition', () => {
    expect(rule(':host.mf-overlay-sheet')).toMatch(
      /transition:\s*transform var\(--mf-motion-pop\) var\(--mf-motion-ease\)/,
    );
    expect(rule(':host.mf-overlay-dragging')).toMatch(/transition:\s*none/);
  });
});
