import { getTestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';
import '@motor-fix/media/testing';

// The Angular unit-test builder initialises TestBed before this file; a run
// of Vitest on its own (Stryker, the edit hooks) does it here.
if (!getTestBed().platform) {
  getTestBed().initTestEnvironment(
    BrowserTestingModule,
    platformBrowserTesting(),
    { errorOnUnknownElements: true, errorOnUnknownProperties: true },
  );
}

// The server specs run in node (the test-node target): the browser shims
// below apply only where there is a window.
if (typeof window !== 'undefined') {
  // jsdom has no matchMedia; the dashboard's toaster reads the colour-scheme query.
  globalThis.matchMedia ??= (query: string) =>
    ({
      addEventListener() {},
      addListener() {},
      matches: false,
      media: query,
      removeEventListener() {},
      removeListener() {},
    }) as unknown as MediaQueryList;

  // jsdom has no element scrolling; the results sheet scrolls its list to the top.
  Element.prototype.scrollTo ??= () => undefined;

  // jsdom answers querySelector through nwsapi, which caches up to a thousand
  // compiled selectors with the element each was last asked from. A spec file
  // keeps one document for all its tests, so those entries held the pages of
  // earlier tests: list-your-garage.spec kept every page it rendered and grew
  // past 750 MB. Emptying the caches after each test lets each page go.
  afterEach(() => {
    const impl = Object.getOwnPropertySymbols(document).find(
      (symbol) => symbol.description === 'impl',
    );
    if (!impl)
      throw new Error(
        "test-setup: jsdom's document no longer has its impl symbol",
      );
    const engines = (
      document as unknown as Record<symbol, Record<string, unknown>>
    )[impl];
    for (const key of ['_nwsapi', '_nwsapiDontThrow'])
      (
        engines[key] as
          | { configure(options: object, clear: boolean): void }
          | undefined
      )?.configure({}, true);
  });
}
