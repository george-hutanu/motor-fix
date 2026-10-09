import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';

import {
  LiveAnchor,
  LiveChange,
  LivePill,
  liveDraft,
  liveRows,
  reuse,
} from './live-in-place';

interface Row {
  id: string;
  price: number;
}

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('reuse', () => {
  it('returns the old value itself when the new one is equal', () => {
    const before = { id: 'r-1', parts: [{ id: 'p-1', name: 'Disc' }] };

    expect(reuse(before, JSON.parse(JSON.stringify(before)))).toBe(before);
  });

  it('keeps every unchanged row, matched by id, and replaces only the changed one', () => {
    const before: Row[] = [
      { id: 'a', price: 100 },
      { id: 'b', price: 200 },
      { id: 'c', price: 300 },
    ];

    const after = reuse(before, [
      { id: 'c', price: 300 },
      { id: 'a', price: 100 },
      { id: 'b', price: 250 },
    ]);

    expect(after).not.toBe(before);
    expect(after[0]).toBe(before[2]);
    expect(after[1]).toBe(before[0]);
    expect(after[2]).not.toBe(before[1]);
    expect(after[2]).toEqual({ id: 'b', price: 250 });
  });

  it('keeps the unchanged parts of a changed object', () => {
    const before = { car: { plate: 'B 12 ABC' }, status: 'open' };

    const after = reuse(before, { car: { plate: 'B 12 ABC' }, status: 'done' });

    expect(after).not.toBe(before);
    expect(after.car).toBe(before.car);
    expect(after.status).toBe('done');
  });

  it('takes the new value when there was none, or when a field was added or removed', () => {
    const next = { id: 'a' };
    expect(reuse(undefined, next)).toBe(next);
    expect(reuse({ id: 'a' }, { id: 'a', note: 'x' })).toEqual({
      id: 'a',
      note: 'x',
    });
    expect(
      reuse({ id: 'a', note: 'x' } as { id: string }, { id: 'a' }),
    ).toEqual({
      id: 'a',
    });
    expect(reuse([1, 2], [1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe('liveDraft', () => {
  it('keeps the copy the form was filled from, and says when the object changed meanwhile', () => {
    const shown = signal<Row | undefined>(undefined);
    const draft = liveDraft(shown);
    expect(draft.source()).toBeUndefined();

    const first = { id: 'job-1', price: 100 };
    shown.set(first);
    expect(draft.source()).toBe(first);
    expect(draft.changed()).toBeUndefined();

    const second = { id: 'job-1', price: 150 };
    shown.set(second);
    expect(draft.source()).toBe(first);
    expect(draft.changed()).toBe(second);

    draft.accept();
    expect(draft.source()).toBe(second);
    expect(draft.changed()).toBeUndefined();
  });

  it('says nothing when a re-read brings the same object', () => {
    const first = { id: 'job-1', price: 100 };
    const shown = signal<Row | undefined>(first);
    const draft = liveDraft(shown);

    shown.set(reuse(first, { id: 'job-1', price: 100 }));

    expect(draft.changed()).toBeUndefined();
  });
});

describe('liveRows', () => {
  const a = { id: 'a', price: 1 };
  const b = { id: 'b', price: 2 };
  const c = { id: 'c', price: 3 };

  it('shows the first rows at once', () => {
    const list = liveRows(signal<Row[] | undefined>([b, c]), () => false);

    expect(list.rows()).toEqual([b, c]);
    expect(list.waiting()).toBe(0);
  });

  it('holds back a new row above the rows shown while the list is scrolled, and counts it', () => {
    const shown = signal<Row[] | undefined>([b, c]);
    const list = liveRows(shown, () => false);
    list.rows();

    shown.set([a, b, c]);

    expect(list.rows()).toEqual([b, c]);
    expect(list.waiting()).toBe(1);
  });

  it('shows the held rows when the list is scrolled back to its top', () => {
    const shown = signal<Row[] | undefined>([b, c]);
    const top = signal(false);
    const list = liveRows(shown, top);
    list.rows();
    shown.set([a, b, c]);
    expect(list.waiting()).toBe(1);

    top.set(true);

    expect(list.rows()).toEqual([a, b, c]);
    expect(list.waiting()).toBe(0);
  });

  it('updates the rows shown in place while holding a new one', () => {
    const shown = signal<Row[] | undefined>([b, c]);
    const list = liveRows(shown, () => false);
    list.rows();
    const changed = { id: 'c', price: 30 };

    shown.set([a, b, changed]);

    expect(list.rows()).toEqual([b, changed]);
  });

  it('shows a new row below the first one shown at once', () => {
    const shown = signal<Row[] | undefined>([a, b]);
    const list = liveRows(shown, () => false);
    list.rows();

    shown.set([a, b, c]);

    expect(list.rows()).toEqual([a, b, c]);
    expect(list.waiting()).toBe(0);
  });

  it('shows the held rows when asked, and names the first of them', () => {
    const shown = signal<Row[] | undefined>([c]);
    const list = liveRows(shown, () => false);
    list.rows();
    shown.set([a, b, c]);
    expect(list.waiting()).toBe(2);

    expect(list.showAll()).toBe('a');

    expect(list.rows()).toEqual([a, b, c]);
    expect(list.waiting()).toBe(0);
  });

  it('shows new rows at once while the list is at its top', () => {
    const shown = signal<Row[] | undefined>([b, c]);
    const list = liveRows(shown, () => true);
    list.rows();

    shown.set([a, b, c]);

    expect(list.rows()).toEqual([a, b, c]);
    expect(list.waiting()).toBe(0);
  });

  it('removes a row that is gone from the re-read, in place', () => {
    const shown = signal<Row[] | undefined>([a, b, c]);
    const list = liveRows(shown, () => false);
    list.rows();

    shown.set([a, c]);

    expect(list.rows()).toEqual([a, c]);
  });
});

@Component({
  imports: [LiveChange],
  template: `<p [mfLiveChange]="value()" [mfLiveChangeSay]="say()">{{ value() }}</p>`,
})
class Changing {
  readonly value = signal(1);
  readonly say = signal<string | undefined>(undefined);
}

function changing(reduced = false) {
  TestBed.configureTestingModule({
    providers: [{ provide: REDUCED_MOTION, useValue: signal(reduced) }],
  });
  const announce = jest
    .spyOn(TestBed.inject(LiveAnnouncer), 'announce')
    .mockResolvedValue();
  const fixture = TestBed.createComponent(Changing);
  fixture.detectChanges();
  const p = (fixture.nativeElement as HTMLElement).querySelector('p');
  return { announce, fixture, p: p as HTMLElement };
}

describe('LiveChange', () => {
  it('highlights a value that changed until the highlight ends, and not when it first shows', () => {
    const { fixture, p } = changing();
    expect(p.classList.contains('mf-live-changed')).toBe(false);

    fixture.componentInstance.value.set(2);
    fixture.detectChanges();
    expect(p.classList.contains('mf-live-changed')).toBe(true);

    // A row's own animation ending inside it leaves the highlight on.
    const ended = (type: string, animationName: string) =>
      Object.assign(new Event(type, { bubbles: true }), { animationName });
    p.dispatchEvent(ended('animationend', 'mf-blink'));
    expect(p.classList.contains('mf-live-changed')).toBe(true);
    p.dispatchEvent(ended('animationend', 'mf-live-changed'));
    expect(p.classList.contains('mf-live-changed')).toBe(false);

    fixture.componentInstance.value.set(3);
    fixture.detectChanges();
    p.dispatchEvent(ended('animationcancel', 'mf-live-changed'));
    expect(p.classList.contains('mf-live-changed')).toBe(false);
  });

  it('does not highlight with reduced motion', () => {
    const { fixture, p } = changing(true);

    fixture.componentInstance.value.set(2);
    fixture.detectChanges();

    expect(p.classList.contains('mf-live-changed')).toBe(false);
  });

  it('announces the change politely, without moving the focus', () => {
    const { announce, fixture } = changing();
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();

    fixture.componentInstance.say.set('Preț nou: 150 lei');
    fixture.componentInstance.value.set(2);
    fixture.detectChanges();

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Preț nou: 150 lei', 'polite');
    expect(document.activeElement).toBe(button);
    button.remove();
  });

  it('announces nothing when the view gives no text', () => {
    const { announce, fixture } = changing();

    fixture.componentInstance.value.set(2);
    fixture.detectChanges();

    expect(announce).not.toHaveBeenCalled();
  });
});

@Component({
  imports: [LiveChange],
  template: `<p [mfLiveChange]="1" [mfLiveChangeNew]="arrived">new</p>`,
})
class Arriving {
  arrived = true;
}

// @traces 344-FR-015
describe('LiveChange on a row that arrived live', () => {
  it('highlights it when it first shows', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: REDUCED_MOTION, useValue: signal(false) }],
    });
    const fixture = TestBed.createComponent(Arriving);
    fixture.detectChanges();

    const p = (fixture.nativeElement as HTMLElement).querySelector('p');
    expect(p?.classList.contains('mf-live-changed')).toBe(true);
  });

  it('does not when it was there before', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: REDUCED_MOTION, useValue: signal(false) }],
    });
    const fixture = TestBed.createComponent(Arriving);
    fixture.componentInstance.arrived = false;
    fixture.detectChanges();

    const p = (fixture.nativeElement as HTMLElement).querySelector('p');
    expect(p?.classList.contains('mf-live-changed')).toBe(false);
  });
});

@Component({
  imports: [LiveAnchor, LivePill],
  template: `
    <mf-live-pill [rows]="list" />
    <ul [mfLiveAnchor]="list.rows()">
      @for (row of list.rows(); track row.id) {
        <li [attr.data-live-id]="row.id">{{ row.id }}</li>
      }
    </ul>
  `,
})
class List {
  readonly shown = signal<Row[] | undefined>([
    { id: 'b', price: 2 },
    { id: 'c', price: 3 },
  ]);
  top = false;
  readonly list = liveRows(this.shown, () => this.top);
}

// jsdom lays nothing out: each row reports the box the test gives it.
function place(element: HTMLElement, tops: Record<string, number>) {
  for (const li of element.querySelectorAll<HTMLElement>('li')) {
    const top = tops[li.dataset['liveId'] ?? ''] ?? 0;
    li.getBoundingClientRect = () =>
      ({ bottom: top + 60, height: 60, top }) as DOMRect;
  }
}

describe('LivePill and LiveAnchor', () => {
  function list() {
    const fixture = TestBed.createComponent(List);
    fixture.detectChanges();
    return { element: fixture.nativeElement as HTMLElement, fixture };
  }

  it('shows the pill with the count of held rows, in Romanian', () => {
    const { element, fixture } = list();
    expect(element.querySelector('mf-live-pill button')).toBeNull();

    fixture.componentInstance.shown.set([
      { id: 'a', price: 1 },
      { id: 'b', price: 2 },
      { id: 'c', price: 3 },
    ]);
    fixture.detectChanges();

    expect(
      element.querySelector('mf-live-pill button')?.textContent?.trim(),
    ).toBe('1 actualizare nouă');
  });

  it('shows the held rows and scrolls up to the first one when the pill is tapped', () => {
    const { element, fixture } = list();
    const scroll = jest.fn();
    Element.prototype.scrollIntoView = scroll;
    fixture.componentInstance.shown.set([
      { id: 'z', price: 0 },
      { id: 'a', price: 1 },
      { id: 'b', price: 2 },
      { id: 'c', price: 3 },
    ]);
    fixture.detectChanges();

    element.querySelector<HTMLButtonElement>('mf-live-pill button')?.click();
    fixture.detectChanges();

    expect(
      [...element.querySelectorAll('li')].map((li) => li.textContent),
    ).toEqual(['z', 'a', 'b', 'c']);
    expect(element.querySelector('mf-live-pill button')).toBeNull();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(element.querySelector('li'));
  });

  it('keeps the first visible row where it was on screen when a row above it leaves', () => {
    const scrollBy = jest.fn();
    window.scrollBy = scrollBy as unknown as typeof window.scrollBy;
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 400,
    });
    const { element, fixture } = list();
    fixture.componentInstance.shown.set([
      { id: 'a', price: 1 },
      { id: 'b', price: 2 },
      { id: 'c', price: 3 },
    ]);
    fixture.componentInstance.list.showAll();
    fixture.detectChanges();
    // a is above the screen, b is the first row visible, 20 px from the top.
    place(element, { a: -70, b: 20, c: 80 });
    window.dispatchEvent(new Event('scroll'));
    // Once a leaves, b sits 60 px higher: its box, read after the render.
    place(element, { a: -70, b: -40, c: 20 });

    fixture.componentInstance.shown.set([
      { id: 'b', price: 2 },
      { id: 'c', price: 3 },
    ]);
    fixture.detectChanges();

    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy).toHaveBeenCalledWith(0, -60);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  });
});
