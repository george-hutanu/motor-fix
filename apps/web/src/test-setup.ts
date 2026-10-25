import { setupZonelessTestEnv } from 'jest-preset-angular/setup-env/zoneless';
import '@motor-fix/media/testing';

setupZonelessTestEnv({
  errorOnUnknownElements: true,
  errorOnUnknownProperties: true,
});

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
if (typeof Element !== 'undefined')
  Element.prototype.scrollTo ??= () => undefined;

// jsdom answers querySelector through nwsapi, which caches up to a thousand
// compiled selectors with the element each was last asked from. A spec file
// keeps one document for all its tests, so those entries held the pages of
// earlier tests: list-your-garage.spec kept every page it rendered and grew
// past 750 MB. Emptying the caches after each test lets each page go.
if (typeof document !== 'undefined')
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
