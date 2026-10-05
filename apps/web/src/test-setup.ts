import { setupZonelessTestEnv } from 'jest-preset-angular/setup-env/zoneless';

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
