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

// The jsdom jest-environment-jsdom ships (26) has no Blob.arrayBuffer; every
// browser has. The uploader reads the bytes for their checksum.
Blob.prototype.arrayBuffer ??= function arrayBuffer(this: Blob) {
  const impl = Object.getOwnPropertySymbols(this).find(
    (symbol) => symbol.description === 'impl',
  );
  const held =
    impl && (this as unknown as Record<symbol, { _buffer?: Uint8Array }>)[impl];
  const bytes = held?._buffer ?? new Uint8Array();
  return Promise.resolve(new Uint8Array(bytes).buffer as ArrayBuffer);
};
