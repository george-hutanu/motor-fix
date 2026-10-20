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

const SHEET = 600;
const TOP = 120;
const layout = signal<LayoutName>('phone');
let fixture: ComponentFixture<Host>;
let push: jest.SpyInstance;
let back: jest.SpyInstance;

async function settle() {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }
}

async function render() {
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: 'browser' },
      { provide: Layout, useValue: { current: layout } },
    ],
  });
  await TestBed.inject(I18n).enter('public');
  fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  await settle();
}

const host = () =>
  (fixture.nativeElement as HTMLElement).querySelector(
    'mf-results-sheet',
  ) as HTMLElement;
const position = () => host().getAttribute('data-position');
const handle = () => host().querySelector<HTMLButtonElement>('button.handle');
const offset = () => host().style.getPropertyValue('--sheet-y');

function pointer(
  target: Element | null,
  type: string,
  clientY: number,
  pointerId = 1,
) {
  target?.dispatchEvent(
    Object.assign(new MouseEvent(type, { bubbles: true, button: 0, clientY }), {
      pointerId,
    }),
  );
}

async function drag(from: number, to: number) {
  pointer(handle(), 'pointerdown', from);
  pointer(handle(), 'pointermove', to);
  pointer(handle(), 'pointerup', to);
  await settle();
}

async function press(detail = 1) {
  handle()?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));
  await settle();
}

async function popped(state: unknown = null) {
  history.replaceState(state, '');
  window.dispatchEvent(new PopStateEvent('popstate', { state }));
  await settle();
}

beforeEach(async () => {
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
  await render();
});

afterEach(() => jest.restoreAllMocks());

// @traces 1358-FR-003
describe('ResultsSheet drags under hostile pointers', () => {
  it('ignores moves and releases from another pointer while one finger drags', async () => {
    pointer(handle(), 'pointerdown', 400, 1);
    pointer(handle(), 'pointermove', 100, 2);
    pointer(handle(), 'pointerup', 100, 2);
    await settle();

    expect(position()).toBe('half');
    expect(push).not.toHaveBeenCalled();
  });

  it('keeps following the first finger when a second one goes down', async () => {
    pointer(handle(), 'pointerdown', 400, 1);
    pointer(handle(), 'pointerdown', 100, 2);
    pointer(handle(), 'pointermove', 560, 1);
    pointer(handle(), 'pointerup', 560, 1);
    await settle();

    expect(position()).toBe('low');
  });

  it('returns to where it started on a cancelled drag, with no step', async () => {
    pointer(handle(), 'pointerdown', 400);
    pointer(handle(), 'pointermove', 100);
    pointer(handle(), 'pointercancel', 100);
    await settle();

    expect(position()).toBe('half');
    expect(push).not.toHaveBeenCalled();
  });

  it('does not keep dragging after a cancel when a stray move arrives', async () => {
    pointer(handle(), 'pointerdown', 400);
    pointer(handle(), 'pointercancel', 400);
    pointer(handle(), 'pointermove', 100);
    pointer(handle(), 'pointerup', 100);
    await settle();

    expect(position()).toBe('half');
  });

  it('ignores a release that had no press', async () => {
    pointer(handle(), 'pointerup', 100);
    await settle();

    expect(position()).toBe('half');
    expect(push).not.toHaveBeenCalled();
  });

  it('treats a press and release on the same spot as no move', async () => {
    await drag(400, 400);

    expect(position()).toBe('half');
    expect(push).not.toHaveBeenCalled();
  });

  it('rests at full for a drag far past the top, with a non-negative offset', async () => {
    pointer(handle(), 'pointerdown', 400);
    pointer(handle(), 'pointermove', -5000);
    fixture.detectChanges();
    expect(Number.parseFloat(offset())).toBeGreaterThanOrEqual(0);

    pointer(handle(), 'pointerup', -5000);
    await settle();
    expect(position()).toBe('full');
  });

  it('rests at low for a drag far past the bottom, with the offset capped at low', async () => {
    pointer(handle(), 'pointerdown', 400);
    pointer(handle(), 'pointermove', 9000);
    fixture.detectChanges();
    expect(Number.parseFloat(offset())).toBeLessThanOrEqual(480);

    pointer(handle(), 'pointerup', 9000);
    await settle();
    expect(position()).toBe('low');
  });

  it('adds one step only when a second drag up arrives at full', async () => {
    await drag(400, 180);
    await drag(300, 100);

    expect(position()).toBe('full');
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('adds a second step on a second visit to full after leaving it', async () => {
    await press(0);
    await press(0);
    expect(position()).toBe('low');
    await press(0);
    await press(0);

    expect(position()).toBe('full');
    expect(push).toHaveBeenCalledTimes(2);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('ignores a back with no sheet marker when the sheet is not stepped', async () => {
    await popped();
    expect(position()).toBe('half');

    await press(0);
    await press(0);
    await press(0);
    await popped();
    expect(position()).toBe('half');
  });

  it('stays low on a back step when it rests low', async () => {
    await drag(400, 560);

    await popped();

    expect(position()).toBe('low');
    expect(back).not.toHaveBeenCalled();
  });

  it('goes to half only once when two back steps arrive in a row', async () => {
    await press(0);

    await popped();
    await popped();

    expect(position()).toBe('half');
    expect(back).not.toHaveBeenCalled();
  });

  it('does not call back again when the step is already consumed by a back', async () => {
    await press(0);
    await popped();

    await press(0);
    await press(0);

    expect(position()).toBe('low');
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('stops listening to the back button once it is destroyed', async () => {
    await press(0);
    fixture.destroy();

    await popped();

    expect(back).not.toHaveBeenCalled();
  });
});

// @traces 1358-FR-010
describe('ResultsSheet forced full', () => {
  it('keeps a hand-made full and its single step when forced is switched on and off', async () => {
    await press(0);
    expect(push).toHaveBeenCalledTimes(1);

    fixture.componentInstance.forced.set(true);
    await settle();
    fixture.componentInstance.forced.set(false);
    await settle();

    expect(position()).toBe('full');
    expect(push).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
  });

  it('does not pull a visitor-dragged half back to full when forced stays true', async () => {
    fixture.componentInstance.forced.set(true);
    await settle();
    await drag(200, 420);
    expect(position()).toBe('half');

    fixture.componentInstance.forced.set(true);
    await settle();

    expect(position()).toBe('half');
  });

  // A forced full added no step, so a back step is the page's own.
  it('leaves a forced full as it is on a back step, which belongs to the page', async () => {
    fixture.componentInstance.forced.set(true);
    await settle();

    await popped();

    expect(position()).toBe('full');
    expect(back).not.toHaveBeenCalled();
  });

  it('forces a low sheet to full with no step', async () => {
    await drag(400, 560);

    fixture.componentInstance.forced.set(true);
    await settle();

    expect(position()).toBe('full');
    expect(push).not.toHaveBeenCalled();
  });

  it('adds no step when a forced full is pressed down to low', async () => {
    fixture.componentInstance.forced.set(true);
    await settle();

    await press(0);

    expect(position()).toBe('low');
    expect(back).not.toHaveBeenCalled();
  });
});

// @traces 1358-FR-001 1358-FR-009
describe('ResultsSheet when the layout changes', () => {
  it('draws no handle after a switch to a tablet and consumes the step it added', async () => {
    await press(0);
    expect(position()).toBe('full');

    layout.set('tablet');
    await settle();

    expect(handle()).toBeNull();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('draws the handle again at half when the layout returns to a phone', async () => {
    await press(0);
    layout.set('tablet');
    await settle();

    layout.set('phone');
    await settle();

    expect(handle()).not.toBeNull();
    expect(position()).not.toBe('full');
  });
});

// @traces 1358-FR-012
describe('ResultsSheet focus', () => {
  it('keeps full and half where they are when a card takes focus', async () => {
    await press(0);

    host().querySelector<HTMLButtonElement>('.card')?.focus();
    await settle();

    expect(position()).toBe('full');
  });

  it('marks nothing in the sheet inert or hidden at low', async () => {
    await drag(400, 560);

    expect(
      host().querySelector('[inert], [aria-hidden="true"]:not(.grip):not(svg)'),
    ).toBeNull();
  });
});
