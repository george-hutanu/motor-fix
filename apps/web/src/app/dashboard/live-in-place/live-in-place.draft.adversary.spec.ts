import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { liveDraft } from './live-in-place';

type Range = { from: number; to?: number };
const same = (a: Range, b: Range) => a.from === b.from && a.to === b.to;

describe('liveDraft against hostile sequences', () => {
  // @traces 588-FR-002
  it('fills its source from the first value that shows, not from nothing', () => {
    TestBed.runInInjectionContext(() => {
      const shown = signal<Range | undefined>(undefined);
      const draft = liveDraft(shown, same);
      expect(draft.source()).toBeUndefined();
      expect(draft.changed()).toBeUndefined();

      const first = { from: 1 };
      shown.set(first);

      expect(draft.source()).toBe(first);
      expect(draft.changed()).toBeUndefined();
    });
  });

  // @traces 588-FR-004
  it('shows no change when the value goes away and comes back equal', () => {
    TestBed.runInInjectionContext(() => {
      const shown = signal<Range | undefined>({ from: 1, to: 2 });
      const draft = liveDraft(shown, same);

      shown.set({ from: 5, to: 6 });
      expect(draft.changed()).toEqual({ from: 5, to: 6 });
      shown.set(undefined);
      expect(draft.changed()).toBeUndefined();
      expect(draft.source()).toEqual({ from: 1, to: 2 });
      shown.set({ from: 1, to: 2 });
      expect(draft.changed()).toBeUndefined();
    });
  });

  // @traces 588-FR-004
  it('accepts the value given, not the one on screen, and stays idempotent', () => {
    TestBed.runInInjectionContext(() => {
      const shown = signal<Range | undefined>({ from: 1 });
      const draft = liveDraft(shown, same);
      shown.set({ from: 9 });

      draft.accept({ from: 4 });
      draft.accept({ from: 4 });

      expect(draft.source()).toEqual({ from: 4 });
      expect(draft.changed()).toEqual({ from: 9 });
      draft.accept({ from: 9 });
      expect(draft.changed()).toBeUndefined();
    });
  });

  // @traces 588-FR-004
  it('accepts what is on screen when called without a value', () => {
    TestBed.runInInjectionContext(() => {
      const shown = signal<Range | undefined>({ from: 1 });
      const draft = liveDraft(shown, same);
      shown.set({ from: 9 });

      draft.accept();

      expect(draft.source()).toEqual({ from: 9 });
      expect(draft.changed()).toBeUndefined();
    });
  });

  // @traces 588-FR-004
  it('accepting with nothing on screen leaves a source and no change, never a crash', () => {
    TestBed.runInInjectionContext(() => {
      const shown = signal<Range | undefined>({ from: 1 });
      const draft = liveDraft(shown, same);
      shown.set(undefined);

      draft.accept();

      expect(draft.changed()).toBeUndefined();
      shown.set({ from: 1 });
      expect(draft.changed()).toBeUndefined();
    });
  });

  // @traces 588-FR-002
  it('without an equality, a new object with equal content is a change', () => {
    TestBed.runInInjectionContext(() => {
      const shown = signal<Range | undefined>({ from: 1 });
      const draft = liveDraft(shown);

      shown.set({ from: 1 });

      expect(draft.changed()).toEqual({ from: 1 });
    });
  });

  // @traces 588-FR-002
  it('compares falsy values by range rather than treating zero as missing', () => {
    TestBed.runInInjectionContext(() => {
      const shown = signal<Range | undefined>({ from: 0, to: 0 });
      const draft = liveDraft(shown, same);

      shown.set({ from: 0 });

      expect(draft.changed()).toEqual({ from: 0 });
    });
  });
});
