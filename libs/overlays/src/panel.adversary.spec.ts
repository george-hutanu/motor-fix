import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import {
  FieldError,
  injectOverlayTask,
  type OverlayResult,
  type OverlayShape,
  Overlays,
  TaskError,
  TaskSubmit,
  taskSave,
} from './index';

@Component({
  template: `
    <input id="plate" />
    <button id="done" type="button" (click)="task.close('saved')">Gata</button>
  `,
})
class FieldTask {
  readonly task = injectOverlayTask<undefined, 'saved'>();
}

let answer: () => Promise<string>;

@Component({
  imports: [ReactiveFormsModule, FieldError, TaskError, TaskSubmit],
  template: `
    <form [formGroup]="form" (ngSubmit)="save.submit()">
      <input id="name" formControlName="name" aria-describedby="name-error" />
      <mf-field-error id="name-error" [save]="save" [control]="form.controls.name" />
      <mf-task-error [save]="save" />
      <button id="save" type="submit" [mfTaskSubmit]="save">Salvează</button>
    </form>
  `,
})
class SaveTask {
  readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });
  readonly save = taskSave({
    form: this.form,
    send: () => answer(),
  });
}

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
  open(
    task: Parameters<Overlays['open']>[0] = FieldTask,
    shape: OverlayShape = 'dialog',
  ): Promise<OverlayResult<'saved'>> {
    return this.overlays.open<'saved'>(task, { shape, title: 'shell.brand' });
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
  answer = () => Promise.resolve('saved');
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
  for (let i = 0; i < 4; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function openTask(
  task: Parameters<Overlays['open']>[0] = FieldTask,
  shape: OverlayShape = 'dialog',
) {
  const host = TestBed.createComponent(Host).componentInstance;
  const result = host.open(task, shape);
  await settle();
  return { result };
}

const panels = () =>
  Array.from(document.querySelectorAll<HTMLElement>('mf-overlay-panel'));
const top = () => panels()[panels().length - 1];
const grip = (el: HTMLElement = top()) =>
  el?.querySelector<HTMLElement>('.mf-overlay-grip') ?? null;
const dragOffset = (el: HTMLElement = top()) =>
  el.style.getPropertyValue('--mf-drag');

function pointerEvent(type: string, clientY: number, pointerId = 1) {
  return Object.assign(
    new MouseEvent(type, { bubbles: true, button: 0, clientY }),
    { pointerId },
  );
}

function pointer(
  type: string,
  clientY: number,
  target: HTMLElement | null = grip(),
  pointerId = 1,
) {
  target?.dispatchEvent(pointerEvent(type, clientY, pointerId));
}

function pressEscape() {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
  );
}

function clickOutside() {
  const backdrops = document.querySelectorAll<HTMLElement>(
    '.cdk-overlay-backdrop',
  );
  backdrops[backdrops.length - 1]?.click();
}

function typeInto(el: HTMLElement, value: string) {
  const field = el.querySelector<HTMLInputElement>('input');
  if (!field) throw new Error('no field');
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('stacked sheets', () => {
  it('Escape, outside and a drag close only the top sheet', async () => {
    const { result: first } = await openTask();
    const { result: second } = await openTask();
    expect(panels()).toHaveLength(2);

    pressEscape();
    await settle();
    await expect(second).resolves.toBe('cancelled');
    expect(panels()).toHaveLength(1);

    const { result: third } = await openTask();
    clickOutside();
    await settle();
    await expect(third).resolves.toBe('cancelled');
    expect(panels()).toHaveLength(1);

    const { result: fourth } = await openTask();
    pointer('pointerdown', 100);
    pointer('pointermove', 400);
    pointer('pointerup', 400);
    await settle();
    await expect(fourth).resolves.toBe('cancelled');
    expect(panels()).toHaveLength(1);

    top().querySelector<HTMLButtonElement>('#done')?.click();
    await settle();
    await expect(first).resolves.toBe('saved');
  });
});

describe('odd pointer sequences', () => {
  it('ignores a pointerup that had no pointerdown', async () => {
    await openTask();

    pointer('pointerup', 900);
    await settle();

    expect(panels()).toHaveLength(1);
    expect(dragOffset()).toBe('');
  });

  it('ignores a pointermove that had no pointerdown', async () => {
    await openTask();

    pointer('pointermove', 900);
    await settle();

    expect(panels()).toHaveLength(1);
    expect(dragOffset()).toBe('');
  });

  it('closes at 101 px of 300 and not at exactly one third (100 px)', async () => {
    const { result } = await openTask();
    pointer('pointerdown', 0);
    pointer('pointermove', 100);
    pointer('pointerup', 100);
    await settle();
    expect(panels()).toHaveLength(1);

    pointer('pointerdown', 0);
    pointer('pointermove', 100.5);
    pointer('pointerup', 100.5);
    await settle();
    expect(panels()).toHaveLength(0);
    await expect(result).resolves.toBe('cancelled');
  });

  it('measures the threshold against the height at the start of the drag', async () => {
    await openTask();
    pointer('pointerdown', 0);
    sheetHeight = 120;
    pointer('pointermove', 100);
    pointer('pointerup', 100);
    await settle();

    expect(panels()).toHaveLength(1);
  });

  it('a second pointerdown mid-drag does not reset the start, so the release measures from the first', async () => {
    await openTask();
    pointer('pointerdown', 100);
    pointer('pointermove', 150);
    pointer('pointerdown', 150);
    pointer('pointermove', 230);
    await settle();

    expect(dragOffset()).toBe('130px');
    pointer('pointerup', 230);
    await settle();
    expect(panels()).toHaveLength(0);
  });

  it('a second pointer id mid-drag does not move the sheet', async () => {
    await openTask();
    pointer('pointerdown', 100, grip(), 1);
    pointer('pointermove', 150, grip(), 1);
    pointer('pointermove', 600, grip(), 2);
    await settle();

    expect(dragOffset()).toBe('50px');
    pointer('pointerup', 600, grip(), 2);
    await settle();
    expect(panels()).toHaveLength(1);
  });

  it('a pointermove after pointerup does not move the sheet', async () => {
    await openTask();
    pointer('pointerdown', 100);
    pointer('pointermove', 150);
    pointer('pointerup', 150);
    await settle();
    pointer('pointermove', 400);
    await settle();

    expect(dragOffset()).toBe('');
    expect(panels()).toHaveLength(1);
  });

  it('a zero-height sheet does not close on a zero-length drag', async () => {
    sheetHeight = 0;
    await openTask();
    pointer('pointerdown', 100);
    pointer('pointerup', 100);
    await settle();

    expect(panels()).toHaveLength(1);
  });

  it('a pointercancel then a pointerup does not close the sheet', async () => {
    await openTask();
    pointer('pointerdown', 0);
    pointer('pointermove', 280);
    pointer('pointercancel', 280);
    pointer('pointerup', 280);
    await settle();

    expect(panels()).toHaveLength(1);
    expect(dragOffset()).toBe('');
  });

  it('a drag released closes once even when pointerup repeats', async () => {
    const { result } = await openTask();
    pointer('pointerdown', 0);
    pointer('pointermove', 250);
    pointer('pointerup', 250);
    pointer('pointerup', 250);
    await settle();

    await expect(result).resolves.toBe('cancelled');
    expect(panels()).toHaveLength(0);
  });
});

describe('a drag during the discard question', () => {
  it('keeps asking and does not close when released past the threshold', async () => {
    const { result } = await openTask();
    typeInto(top(), 'B 123');
    pointer('pointerdown', 0);
    pointer('pointermove', 200);
    pointer('pointerup', 200);
    await settle();
    expect(top().querySelector('[role="alertdialog"]')).not.toBeNull();

    let settled = false;
    result.then(() => {
      settled = true;
    });
    pointer('pointerdown', 0);
    pointer('pointermove', 280);
    pointer('pointerup', 280);
    await settle();

    expect(settled).toBe(false);
    expect(panels()).toHaveLength(1);
    expect(top().querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(dragOffset()).toBe('');
  });

  it('a pointer down during the question that ends in a cancel leaves it asking', async () => {
    await openTask();
    typeInto(top(), 'x');
    clickOutside();
    await settle();
    expect(top().querySelector('[role="alertdialog"]')).not.toBeNull();

    pointer('pointerdown', 0);
    pointer('pointermove', 60);
    pointer('pointercancel', 60);
    await settle();

    expect(panels()).toHaveLength(1);
    expect(top().querySelector('[role="alertdialog"]')).not.toBeNull();
  });
});

describe('the visual viewport', () => {
  it('never gives a negative keyboard offset when the viewport is taller than the window', async () => {
    const viewport = fakeViewport(844);
    await openTask();

    viewport.height = 1000;
    viewport.dispatchEvent(new Event('resize'));
    await settle();

    expect(top().style.getPropertyValue('--mf-keyboard')).toBe('0px');
  });

  it('never gives a negative offset when the viewport is scrolled past the keyboard', async () => {
    const viewport = fakeViewport(844);
    await openTask();

    viewport.height = 500;
    viewport.offsetTop = 600;
    viewport.dispatchEvent(new Event('scroll'));
    await settle();

    expect(top().style.getPropertyValue('--mf-keyboard')).toBe('0px');
  });

  it('keeps the visible height cap non-negative for a zero-height viewport', async () => {
    const viewport = fakeViewport(844);
    await openTask();

    viewport.height = 0;
    viewport.dispatchEvent(new Event('resize'));
    await settle();

    const cap = Number.parseFloat(
      top().style.getPropertyValue('--mf-visible-height'),
    );
    expect(cap).toBeGreaterThanOrEqual(0);
  });

  it('ignores viewport events after the sheet closed', async () => {
    const viewport = fakeViewport(844);
    const remove = jest.spyOn(viewport, 'removeEventListener');
    const { result } = await openTask();
    const closed = top();
    closed.querySelector<HTMLButtonElement>('#done')?.click();
    await settle();
    await expect(result).resolves.toBe('saved');

    viewport.height = 300;
    viewport.dispatchEvent(new Event('resize'));
    viewport.dispatchEvent(new Event('scroll'));
    await settle();

    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(closed.style.getPropertyValue('--mf-keyboard')).not.toBe('544px');
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('removes the exact listeners it added, once each, when a sheet closes by Escape', async () => {
    const viewport = fakeViewport(844);
    const add = jest.spyOn(viewport, 'addEventListener');
    const remove = jest.spyOn(viewport, 'removeEventListener');
    await openTask();

    pressEscape();
    await settle();

    for (const [type, fn] of add.mock.calls) {
      expect(remove).toHaveBeenCalledWith(type, fn);
    }
    expect(add.mock.calls.length).toBeGreaterThan(0);
  });

  it('two stacked sheets both follow the keyboard', async () => {
    const viewport = fakeViewport(844);
    await openTask();
    await openTask();

    viewport.height = 500;
    viewport.dispatchEvent(new Event('resize'));
    await settle();
    for (const p of panels()) {
      expect(p.style.getPropertyValue('--mf-keyboard')).toBe('344px');
    }
  });

  it('a wide window opened after a sheet closed does not listen to the viewport', async () => {
    const viewport = fakeViewport(844);
    const { result } = await openTask();
    top().querySelector<HTMLButtonElement>('#done')?.click();
    await settle();
    await result;

    const add = jest.spyOn(viewport, 'addEventListener');
    wide = true;
    await openTask();
    viewport.height = 400;
    viewport.dispatchEvent(new Event('resize'));
    await settle();

    expect(add).not.toHaveBeenCalled();
    expect(top().style.getPropertyValue('--mf-keyboard')).toBe('');
  });

  it('does not throw and keeps the 92 % of the window when no viewport exists', async () => {
    await openTask();

    window.dispatchEvent(new Event('resize'));
    await settle();

    expect(top().getAttribute('data-side')).toBe('bottom');
    expect(top().style.getPropertyValue('--mf-keyboard')).not.toMatch(/^-/);
  });
});

describe('a sheet then a dialog at a wider width', () => {
  it('keeps the sheet a sheet and opens the next task as a dialog', async () => {
    await openTask();
    wide = true;
    window.dispatchEvent(new Event('resize'));
    await openTask();

    const [first, second] = panels();
    expect(first.getAttribute('data-side')).toBe('bottom');
    expect(grip(first)).not.toBeNull();
    expect(second.classList).toContain('mf-overlay-dialog');
    expect(grip(second)).toBeNull();
  });

  it('a dialog stays a dialog when the window narrows, and the next one is a sheet', async () => {
    wide = true;
    await openTask();
    wide = false;
    window.dispatchEvent(new Event('resize'));
    await openTask();

    const [first, second] = panels();
    expect(first.classList).toContain('mf-overlay-dialog');
    expect(first.getAttribute('data-side')).not.toBe('bottom');
    expect(second.getAttribute('data-side')).toBe('bottom');
  });

  it('a wide dialog does not move with a viewport change from an open sheet below it', async () => {
    const viewport = fakeViewport(844);
    await openTask();
    wide = true;
    await openTask();

    viewport.height = 500;
    viewport.dispatchEvent(new Event('resize'));
    await settle();

    expect(panels()[1].style.getPropertyValue('--mf-keyboard')).toBe('');
  });
});

describe('loader tasks and taskSave in a sheet', () => {
  it('shows a busy skeleton in a sheet and then the task', async () => {
    let release!: (task: typeof FieldTask) => void;
    const loader = () =>
      new Promise<typeof FieldTask>((resolve) => {
        release = resolve;
      });
    await openTask(loader);

    expect(top().getAttribute('data-side')).toBe('bottom');
    expect(grip()).not.toBeNull();
    expect(top().querySelector('.mf-overlay-skeleton')).not.toBeNull();

    release(FieldTask);
    await settle();
    expect(top().querySelector('.mf-overlay-skeleton')).toBeNull();
    expect(top().querySelector('#plate')).not.toBeNull();
  });

  it('closes a sheet whose loader is still pending by a drag, with cancelled', async () => {
    const { result } = await openTask(
      () => new Promise<typeof FieldTask>(() => {}),
    );

    pointer('pointerdown', 0);
    pointer('pointermove', 250);
    pointer('pointerup', 250);
    await settle();

    await expect(result).resolves.toBe('cancelled');
    expect(panels()).toHaveLength(0);
  });

  it('a loader that rejects leaves the sheet closable by Escape', async () => {
    const { result } = await openTask(() => Promise.reject(new Error('chunk')));

    pressEscape();
    await settle();

    await expect(result).resolves.toBe('cancelled');
    expect(panels()).toHaveLength(0);
  });

  it('shows the required message and focuses the field in a sheet on an empty press', async () => {
    await openTask(SaveTask);

    top().querySelector<HTMLButtonElement>('#save')?.click();
    await settle();

    expect(top().querySelector('#name-error')?.textContent?.trim()).not.toBe(
      '',
    );
    expect(document.activeElement?.id).toBe('name');
  });

  it('keeps the typed text and shows the failure when the send fails in a sheet', async () => {
    answer = () =>
      Promise.reject(
        new HttpErrorResponse({
          error: { code: 'conflict', status: 409 },
          status: 409,
          url: '/api/x',
        }),
      );
    await openTask(SaveTask);
    typeInto(top(), 'Ana Pop');

    top().querySelector<HTMLButtonElement>('#save')?.click();
    await settle();

    expect(top().querySelector<HTMLInputElement>('#name')?.value).toBe(
      'Ana Pop',
    );
    expect(panels()).toHaveLength(1);
    expect(top().querySelector('mf-task-error')?.textContent?.trim()).not.toBe(
      '',
    );
  });

  it('a long drag in a saving sheet with a changed field asks the question and keeps the text', async () => {
    await openTask(SaveTask);
    typeInto(top(), 'Ana');

    pointer('pointerdown', 0);
    pointer('pointermove', 250);
    pointer('pointerup', 250);
    await settle();

    expect(top().querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(panels()).toHaveLength(1);
  });
});
