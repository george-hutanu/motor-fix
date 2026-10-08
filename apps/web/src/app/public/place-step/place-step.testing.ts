// A stand-in for maplibre-gl in the place-map specs: no canvas, no WebGL.
// A spec routes the module here and reads the state through `jest.requireMock`:
//   jest.mock('maplibre-gl', () => jest.requireActual('./place-step.testing'));
//   const { fake } = jest.requireMock<MapFake>('maplibre-gl');

type Listener = (payload?: unknown) => void;

export class FakeMap {
  readonly data = jest.fn();
  readonly fitBounds = jest.fn();
  readonly jumpTo = jest.fn();
  readonly remove = jest.fn();
  constructor() {
    fake.map = this;
  }
  addControl() {}
  addLayer() {}
  addSource() {}
  getBounds() {
    return { contains: () => fake.inView };
  }
  getSource() {
    return { setData: this.data };
  }
  // Listeners as MapLibre keeps them: `off` drops a function whether `on`
  // or `once` added it, and a one-time listener is dropped before it runs.
  readonly #listeners: { event: string; fn: Listener; once: boolean }[] = [];
  fire(event: string, payload?: unknown) {
    for (const listener of this.#listeners.filter((l) => l.event === event)) {
      if (listener.once) this.off(event, listener.fn);
      listener.fn(payload);
    }
  }
  off(event: string, fn: Listener) {
    const at = this.#listeners.findIndex(
      (l) => l.event === event && l.fn === fn,
    );
    if (at >= 0) this.#listeners.splice(at, 1);
  }
  on(event: string, fn: Listener) {
    this.#listeners.push({ event, fn, once: false });
  }
  // `load` fires at once unless a spec sets `fake.manualLoad` and fires it.
  once(event: string, fn: Listener) {
    if (event === 'load' && !fake.manualLoad) return fn();
    this.#listeners.push({ event, fn, once: true });
  }
}

export class FakeMarker {
  readonly remove = jest.fn();
  constructor() {
    fake.marker = this;
  }
  addTo() {
    return this;
  }
  on() {}
  setLngLat() {
    return this;
  }
}

// The last map and marker built, whether getBounds() holds every point, and
// whether a spec fires the map's `load` itself.
export const fake = {
  inView: true,
  manualLoad: false,
  map: undefined as unknown as FakeMap,
  marker: undefined as unknown as FakeMarker,
};

export { FakeMap as Map, FakeMarker as Marker };
export const NavigationControl = class {};
export const setWorkerUrl = () => {};

export type MapFake = { fake: typeof fake };
