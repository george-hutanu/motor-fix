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
