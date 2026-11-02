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
    <button id="again" type="button" (click)="openAgain()">Încă una</button>
  `,
})
class FieldTask {
  readonly task = injectOverlayTask<undefined, 'saved'>();
  private readonly overlays = inject(Overlays);

  openAgain() {
    this.overlays.open(FieldTask, { shape: 'drawer', title: 'shell.brand' });
  }
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

function _fakeViewport(height: number, offsetTop = 0) {
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
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    () => sheetHeight,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
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
const grip = (from: HTMLElement = panel()) =>
  from?.querySelector<HTMLElement>('.mf-overlay-grip');
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

function pressEscape() {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
  );
}

async function _drag(by: number, end = 'pointerup') {
  pointer('pointerdown', 100);
  pointer('pointermove', 100 + by);
  await settle();
  const during = dragOffset();
  pointer(end, 100 + by);
  await settle();
  return during;
}

function activation(value: unknown) {
  Object.defineProperty(window.navigator, 'userActivation', {
    configurable: true,
    value,
  });
}

afterEach(() => {
  Reflect.deleteProperty(window.navigator, 'userActivation');
});

async function untouched() {
  activation({ hasBeenActive: false, isActive: false });
  history.pushState({ page: 'here' }, '');
  const length = history.length;
  const host = await openTask();
  return { host, length };
}

// @traces 532-FR-007
describe('the deferred history entry: when it is pushed', () => {
  it.each([
    ['no userActivation at all', undefined],
    ['an activation object that says nothing', {}],
    ['a page that has been active', { hasBeenActive: true }],
    ['a null activation', null],
  ])('pushes at once with %s', async (_, value) => {
    activation(value);
    history.pushState({ page: 'here' }, '');
    const length = history.length;

    await openTask();

    expect(history.length).toBe(length + 1);
  });

  it('pushes one entry for a pointerdown then a keydown then another pointerdown', async () => {
    const { length } = await untouched();

    window.dispatchEvent(pointerEvent('pointerdown', 5));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    window.dispatchEvent(pointerEvent('pointerdown', 5));
    await settle();

    expect(history.length).toBe(length + 1);
  });

  it('counts a bare modifier key as the first interaction', async () => {
    const { length } = await untouched();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
    await settle();

    expect(history.length).toBe(length + 1);
  });

  it('does not count a pointerup, a click or a keyup as the first interaction', async () => {
    const { length } = await untouched();

    window.dispatchEvent(pointerEvent('pointerup', 5));
    window.dispatchEvent(new MouseEvent('click'));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'a' }));
    await settle();

    expect(history.length).toBe(length);
  });

  it('pushes the entry at the current address, with the page’s own state kept', async () => {
    const { length } = await untouched();
    const href = location.href;

    window.dispatchEvent(pointerEvent('pointerdown', 5));
    await settle();

    expect(history.length).toBe(length + 1);
    expect(location.href).toBe(href);
    expect(history.state).toEqual(expect.objectContaining({ page: 'here' }));
  });

  it('pushes one entry for each of two tasks open at once, on one interaction', async () => {
    const { length } = await untouched();
    panel().querySelector<HTMLButtonElement>('#again')?.click();
    await settle();
    expect(open()).toBe(2);
    expect(history.length).toBe(length);

    window.dispatchEvent(pointerEvent('pointerdown', 5));
    await settle();

    expect(history.length).toBe(length + 2);
  });
});

// @traces 532-FR-008
describe('the deferred history entry: when the task closes first', () => {
  it('stops listening for the first interaction once it closes', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    await untouched();
    const added = add.mock.calls.filter(
      ([type]) => type === 'pointerdown' || type === 'keydown',
    );
    expect(added.length).toBeGreaterThan(0);

    panel().querySelector<HTMLButtonElement>('#done')?.click();
    await settle();

    for (const [type, listener] of added) {
      expect(remove).toHaveBeenCalledWith(type, listener, expect.anything());
    }
  });

  it('pushes nothing for a keydown after a drag closed the sheet before any touch', async () => {
    const { length } = await untouched();
    pointer('pointerdown', 100);
    pointer('pointermove', 300);
    pointer('pointerup', 300);
    await settle();
    expect(open()).toBe(0);
    const after = history.length;

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    await settle();

    expect(after).toBe(length + 1);
    expect(history.length).toBe(after);
  });

  it('gives a task opened after an earlier untouched one closed exactly one entry', async () => {
    const { length } = await untouched();
    panel().querySelector<HTMLButtonElement>('#done')?.click();
    await settle();
    await openTask();

    window.dispatchEvent(pointerEvent('pointerdown', 5));
    await settle();

    expect(history.length).toBe(length + 1);
  });

  it('steps back over its own entry only, leaving the task under it on its entry, when Escape closes an untouched top task', async () => {
    activation({ hasBeenActive: true, isActive: false });
    history.pushState({ page: 'here' }, '');
    const length = history.length;
    await openTask();
    activation({ hasBeenActive: false, isActive: false });
    panel().querySelector<HTMLButtonElement>('#again')?.click();
    await settle();
    expect(open()).toBe(2);
    expect(history.length).toBe(length + 1);

    pressEscape();
    await settle();

    expect(open()).toBe(1);
    expect(history.length).toBe(length + 2);
    expect(history.state).toEqual(
      expect.objectContaining({ mfOverlay: expect.any(Number) }),
    );
  });

  it('leaves history where it began after an interaction, then the X', async () => {
    const { host } = await untouched();
    window.dispatchEvent(pointerEvent('pointerdown', 5));
    await settle();

    panel().querySelector<HTMLButtonElement>('#done')?.click();
    await settle();

    await expect(host.result).resolves.toBe('saved');
    expect(history.state).toEqual({ page: 'here' });
  });

  it('pushes nothing at an interaction that comes after a pushed task was closed', async () => {
    const { length } = await untouched();
    window.dispatchEvent(pointerEvent('pointerdown', 5));
    await settle();
    panel().querySelector<HTMLButtonElement>('#done')?.click();
    await settle();
    const after = history.length;

    window.dispatchEvent(pointerEvent('pointerdown', 5));
    await settle();

    expect(after).toBe(length + 1);
    expect(history.length).toBe(after);
  });

  it('ends where it started when the first interaction is the click outside that closes it', async () => {
    const { host } = await untouched();
    const backdrop = document.querySelector<HTMLElement>(
      '.cdk-overlay-backdrop',
    );

    backdrop?.dispatchEvent(pointerEvent('pointerdown', 5));
    backdrop?.click();
    await settle();

    await expect(host.result).resolves.toBe('cancelled');
    expect(open()).toBe(0);
    expect(history.state).toEqual({ page: 'here' });
  });
});
