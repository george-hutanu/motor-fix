import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { BREAKPOINTS, Layout } from './layout';

// A viewport whose width the test sets; each query answers like the browser's.
function fakeViewport(start: number) {
  let width = start;
  const lists: {
    query: string;
    listeners: ((e: { matches: boolean }) => void)[];
  }[] = [];
  const matches = (query: string) => {
    const min = /min-width:\s*([\d.]+)px/.exec(query);
    const max = /max-width:\s*([\d.]+)px/.exec(query);
    return (
      (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]))
    );
  };
  window.matchMedia = ((query: string) => {
    const list = {
      listeners: [] as ((e: { matches: boolean }) => void)[],
      query,
    };
    lists.push(list);
    return {
      addEventListener: (_: string, fn: (e: { matches: boolean }) => void) =>
        list.listeners.push(fn),
      addListener: (fn: (e: { matches: boolean }) => void) =>
        list.listeners.push(fn),
      get matches() {
        return matches(query);
      },
      media: query,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    };
  }) as unknown as typeof window.matchMedia;
  return async (next: number) => {
    width = next;
    for (const list of lists) {
      for (const fn of list.listeners) fn({ matches: matches(list.query) });
    }
    await new Promise((resolve) => setTimeout(resolve));
  };
}

describe('Layout', () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
  });

  it('puts the breakpoints at 768 and 1024 px', () => {
    expect(BREAKPOINTS).toEqual({ desktop: 1024, tablet: 768 });
  });

  for (const [width, expected] of [
    [320, 'phone'],
    [767, 'phone'],
    [768, 'tablet'],
    [1023, 'tablet'],
    [1024, 'desktop'],
    [1440, 'desktop'],
  ] as const) {
    it(`says ${expected} at ${width} px`, () => {
      fakeViewport(width);

      expect(TestBed.inject(Layout).current()).toBe(expected);
    });
  }

  it('follows the width when the window is resized or the phone rotates', async () => {
    const resize = fakeViewport(390);
    const layout = TestBed.inject(Layout);
    expect(layout.current()).toBe('phone');

    await resize(844);
    expect(layout.current()).toBe('tablet');

    await resize(1280);
    expect(layout.current()).toBe('desktop');

    await resize(390);
    expect(layout.current()).toBe('phone');
  });

  it('says phone on the server, where there is no width', () => {
    fakeViewport(1440);
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'server' }],
    });

    expect(TestBed.inject(Layout).current()).toBe('phone');
  });
});
