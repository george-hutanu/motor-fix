// Test setup for the projects whose code reads a Blob's bytes.
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
