import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { OpenSheets, type OverlayOptions, Overlays } from './index';

@Component({ template: `<button id="done" type="button">Gata</button>` })
class Task {}

@Component({
  template: `<button id="opener" type="button" (click)="open()">Deschide</button>`,
})
class Host {
  private readonly overlays = inject(Overlays);
  options: OverlayOptions<unknown> = { shape: 'dialog', title: 'shell.brand' };

  open() {
    void this.overlays.open(Task, this.options);
  }
}

let computer = false;

beforeEach(() => {
  computer = false;
  globalThis.matchMedia = (query: string) =>
    ({
      addEventListener() {},
      addListener() {},
      matches: computer && query.includes('min-width: 768px'),
      media: query,
      removeEventListener() {},
      removeListener() {},
    }) as unknown as MediaQueryList;
});

afterEach(() => {
  document.querySelector('.cdk-overlay-container')?.remove();
});

async function settle() {
  for (let i = 0; i < 3; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function openTask(options?: OverlayOptions<unknown>) {
  const fixture = TestBed.createComponent(Host);
  if (options) fixture.componentInstance.options = options;
  fixture.detectChanges();
  document.querySelector<HTMLButtonElement>('#opener')?.click();
  await settle();
}

const panes = () => [
  ...document.querySelectorAll<HTMLElement>('.cdk-overlay-pane'),
];
const pressEscape = () =>
  document.activeElement?.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
  );

describe('OpenSheets counter', () => {
  // @traces 1127-FR-004
  it('starts false', () => {
    expect(TestBed.inject(OpenSheets).any()).toBe(false);
  });

  // @traces 1127-FR-004
  it('never goes below zero, so one opened() after many stray closed() calls is true', () => {
    const sheets = TestBed.inject(OpenSheets);
    sheets.closed();
    sheets.closed();
    sheets.closed();
    expect(sheets.any()).toBe(false);

    sheets.opened();
    expect(sheets.any()).toBe(true);
    sheets.closed();
    expect(sheets.any()).toBe(false);
  });

  // @traces 1127-FR-004
  it('stays true through ten thousand opens until the same number of closes', () => {
    const sheets = TestBed.inject(OpenSheets);
    for (let i = 0; i < 10_000; i++) sheets.opened();
    for (let i = 0; i < 9_999; i++) sheets.closed();
    expect(sheets.any()).toBe(true);
    sheets.closed();
    expect(sheets.any()).toBe(false);
  });
});

describe('Overlays: sheets and the window width', () => {
  // @traces 1127-FR-004
  it.each(['dialog', 'drawer', 'drawer-wide'] as const)(
    'counts a %s opened on a phone exactly once',
    async (shape) => {
      await openTask({ shape, title: 'shell.brand' });
      const sheets = TestBed.inject(OpenSheets);
      expect(sheets.any()).toBe(true);

      pressEscape();
      await settle();
      expect(sheets.any()).toBe(false);
      sheets.opened();
      sheets.closed();
      expect(sheets.any()).toBe(false);
    },
  );

  // @traces 1127-FR-004
  it('keeps counting a sheet whose window grew past 768 px until it closes', async () => {
    await openTask();
    computer = true;
    const sheets = TestBed.inject(OpenSheets);
    expect(sheets.any()).toBe(true);

    pressEscape();
    await settle();
    expect(sheets.any()).toBe(false);
  });

  // @traces 1127-FR-004
  it('does not count a drawer opened on a computer even after the window shrinks', async () => {
    computer = true;
    await openTask({ shape: 'drawer', title: 'shell.brand' });
    computer = false;

    expect(TestBed.inject(OpenSheets).any()).toBe(false);
  });

  // @traces 1127-FR-004
  it('does not go negative when the opener aborts and the sheet is then closed again', async () => {
    const opener = new AbortController();
    await openTask({
      shape: 'dialog',
      signal: opener.signal,
      title: 'shell.brand',
    });
    const sheets = TestBed.inject(OpenSheets);

    opener.abort();
    await settle();
    pressEscape();
    await settle();
    expect(sheets.any()).toBe(false);

    sheets.opened();
    expect(sheets.any()).toBe(true);
    sheets.closed();
    expect(sheets.any()).toBe(false);
  });

  // @traces 1127-FR-001
  it('sizes a phone sheet’s pane to the full width and leaves a later computer dialog’s pane alone', async () => {
    await openTask();
    expect(panes().map((p) => p.style.width)).toEqual(['100%']);
    pressEscape();
    await settle();

    computer = true;
    await openTask();
    expect(panes().at(-1)?.style.width).toBe('');
    expect(panes().at(-1)?.style.height).toBe('');
  });

  // @traces 1127-FR-002
  it('gives a computer drawer the full height and no inline width', async () => {
    computer = true;
    await openTask({ shape: 'drawer-wide', title: 'shell.brand' });

    const pane = panes().at(-1);
    expect(pane?.style.height).toBe('100%');
    expect(pane?.style.width).toBe('');
  });
});
