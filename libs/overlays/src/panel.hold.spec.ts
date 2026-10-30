import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { injectOverlayTask, type OverlayResult, Overlays } from './index';

// A task with its own Renunță and a save that holds the task while it runs.
@Component({
  template: `
    <label for="plate">Număr</label>
    <input id="plate" />
    <button id="cancel" type="button" (click)="task.dismiss()">Renunță</button>
    <button id="hold" type="button" (click)="task.hold(true)">Salvează</button>
    <button id="release" type="button" (click)="task.hold(false)">Gata</button>
    <button id="done" type="button" (click)="task.close('saved')">Închide</button>
  `,
})
class HeldTask {
  readonly task = injectOverlayTask<undefined, 'saved'>();
}

@Component({
  template: `<button id="opener" type="button" (click)="open()">Deschide</button>`,
})
class Host {
  private readonly overlays = inject(Overlays);
  dismissible?: boolean;
  result?: Promise<OverlayResult<'saved'>>;

  open() {
    this.result = this.overlays.open<'saved'>(HeldTask, {
      shape: 'dialog',
      title: 'shell.brand',
      ...(this.dismissible !== undefined && { dismissible: this.dismissible }),
    });
  }
}

beforeEach(() => {
  globalThis.matchMedia = (query: string) =>
    ({
      addEventListener() {},
      addListener() {},
      matches: query.includes('min-width: 768px'),
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

async function openTask(dismissible?: boolean) {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.dismissible = dismissible;
  fixture.detectChanges();
  document.querySelector<HTMLButtonElement>('#opener')?.click();
  await settle();
  return fixture.componentInstance;
}

const open = () => document.querySelectorAll('mf-overlay-panel').length;
const question = () => document.querySelector('[role="alertdialog"]');
async function press(id: string) {
  document.querySelector<HTMLButtonElement>(`#${id}`)?.click();
  await settle();
}
function type() {
  const field = document.querySelector<HTMLInputElement>('#plate');
  if (!field) throw new Error('no field');
  field.value = 'B 123 ABC';
  field.dispatchEvent(new Event('input', { bubbles: true }));
}
async function pressEscape() {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
  );
  await settle();
}
async function clickOutside() {
  document
    .querySelector<HTMLElement>('.cdk-overlay-backdrop')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
}

// @traces 1403-FR-012
describe("a task's own Renunță", () => {
  it('closes with "cancelled" at once when nothing was typed', async () => {
    const host = await openTask();

    await press('cancel');

    expect(open()).toBe(0);
    await expect(host.result).resolves.toBe('cancelled');
  });

  it('asks the discard question first when a field changed', async () => {
    await openTask();
    type();

    await press('cancel');

    expect(open()).toBe(1);
    expect(question()).not.toBeNull();
  });

  it('closes a task opened not dismissible too', async () => {
    const host = await openTask(false);

    await press('cancel');

    await expect(host.result).resolves.toBe('cancelled');
  });
});

describe('a task held during a save', () => {
  it('stays open on Escape, a click outside and Renunță', async () => {
    await openTask();
    await press('hold');

    await pressEscape();
    await clickOutside();
    await press('cancel');

    expect(open()).toBe(1);
    expect(question()).toBeNull();
  });

  it('stays open on Back and keeps its history entry', async () => {
    history.pushState({ page: 'here' }, '');
    await openTask();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await press('hold');

    history.back();
    await settle();

    expect(open()).toBe(1);
    expect(history.state?.mfOverlay).toBeDefined();
  });

  it('still closes by its own close', async () => {
    const host = await openTask();
    await press('hold');

    await press('done');

    await expect(host.result).resolves.toBe('saved');
  });

  it('closes again on Escape once released', async () => {
    const host = await openTask();
    await press('hold');
    await press('release');

    await pressEscape();

    expect(open()).toBe(0);
    await expect(host.result).resolves.toBe('cancelled');
  });
});
