import { setupZonelessTestEnv } from 'jest-preset-angular/setup-env/zoneless';

setupZonelessTestEnv({
  errorOnUnknownElements: true,
  errorOnUnknownProperties: true,
});

// jsdom has no matchMedia; the toaster reads the colour-scheme query.
globalThis.matchMedia ??= (query: string) =>
  ({
    addEventListener() {},
    addListener() {},
    matches: false,
    media: query,
    removeEventListener() {},
    removeListener() {},
  }) as unknown as MediaQueryList;

// jsdom draws nothing and has no ResizeObserver: a 2D context whose methods do
// nothing lets the real Chart.js lay charts out and keep their state. The
// gradient carries its tag because Chart.js treats a plain object as options.
HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
  const state: Record<string | symbol, unknown> = { canvas: this };
  const gradient = {
    addColorStop() {},
    [Symbol.toStringTag]: 'CanvasGradient',
  };
  return new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'createLinearGradient') return () => gradient;
      if (prop === 'getLineDash') return () => [];
      return () => {};
    },
  });
} as never;

globalThis.ResizeObserver ??= class {
  disconnect() {}
  observe() {}
  unobserve() {}
} as never;
