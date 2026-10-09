import { ElementRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { moreRows } from './more-rows';

let inView: (entries: { isIntersecting: boolean }[]) => void;

beforeEach(() => {
  globalThis.IntersectionObserver = class {
    constructor(callback: typeof inView) {
      inView = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  delete (globalThis as { IntersectionObserver?: unknown })
    .IntersectionObserver;
});

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('the rows after a list’s first page', () => {
  it('reads the next page when the end comes into view', async () => {
    const page = jest.fn(async (cursor: string) => ({
      items: [cursor],
      nextCursor: null,
    }));
    const rows = TestBed.runInInjectionContext(() =>
      moreRows(
        signal(1),
        signal('c1'),
        page,
        signal(new ElementRef(document.createElement('div'))),
      ),
    );
    TestBed.tick();

    inView([{ isIntersecting: true }]);
    await settle();

    expect(rows()).toEqual(['c1']);
  });

  it('stops re-reading the shown depth at a page with no rows', async () => {
    const first = signal(1);
    let reads = 0;
    const page = jest.fn(
      async (
        cursor: string,
      ): Promise<{ items: string[]; nextCursor: string }> =>
        ++reads === 1
          ? { items: ['row'], nextCursor: 'c2' }
          : { items: [], nextCursor: cursor },
    );
    const rows = TestBed.runInInjectionContext(() =>
      moreRows(
        first,
        signal('c1'),
        page,
        signal(new ElementRef(document.createElement('div'))),
      ),
    );
    TestBed.tick();
    inView([{ isIntersecting: true }]);
    await settle();

    first.set(2);
    TestBed.tick();
    await settle();

    expect(page.mock.calls.length).toBeLessThan(5);
    expect(rows()).toEqual([]);
  });
});
