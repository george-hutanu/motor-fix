import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Overlays } from './index';

@Component({
  template: `
    <label for="car">Mașina</label>
    <select id="car"><option>Logan</option></select>
    <textarea id="first" autofocus></textarea>
    <textarea id="second" autofocus></textarea>
  `,
})
class TwoAutofocusTask {}

@Component({
  template: `
    <label for="plate">Număr</label>
    <input id="plate" />
    <textarea id="later" autofocus></textarea>
  `,
})
class LaterAutofocusTask {}

@Component({
  template: `<button id="opener" type="button" (click)="open()">Deschide</button>`,
})
class Host {
  private readonly overlays = inject(Overlays);
  task: typeof TwoAutofocusTask | typeof LaterAutofocusTask = TwoAutofocusTask;

  open() {
    this.overlays.open(this.task, { shape: 'dialog', title: 'shell.brand' });
  }
}

let wide = true;

beforeEach(() => {
  wide = true;
  globalThis.matchMedia = (query: string) =>
    ({
      addEventListener() {},
      addListener() {},
      matches: wide && query.includes('min-width: 768px'),
      media: query,
      removeEventListener() {},
      removeListener() {},
    }) as unknown as MediaQueryList;
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: undefined,
  });
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.scrollIntoView = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
  document.querySelector('.cdk-overlay-container')?.remove();
});

async function openTask(task: Host['task']) {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.task = task;
  fixture.detectChanges();
  document.querySelector<HTMLButtonElement>('#opener')?.click();
  for (let i = 0; i < 3; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

// @traces 356-FR-011
describe('a panel with fields marked autofocus', () => {
  it('focuses the first one when two are marked', async () => {
    await openTask(TwoAutofocusTask);

    expect(document.activeElement?.id).toBe('first');
  });

  it('focuses the one marked even when a plain field comes before it', async () => {
    await openTask(LaterAutofocusTask);

    expect(document.activeElement?.id).toBe('later');
  });
});
