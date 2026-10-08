// A stand-in for maplibre-gl in the place-map specs: no canvas, no WebGL.
// A spec routes the module here and reads the state through `jest.requireMock`:
//   jest.mock('maplibre-gl', () => jest.requireActual('./place-step.testing'));
//   const { fake } = jest.requireMock<MapFake>('maplibre-gl');

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
  on() {}
  once(event: string, then: () => void) {
    if (event === 'load') then();
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

// The last map and marker built, and whether getBounds() holds every point.
export const fake = {
  inView: true,
  map: undefined as unknown as FakeMap,
  marker: undefined as unknown as FakeMarker,
};

export { FakeMap as Map, FakeMarker as Marker };
export const NavigationControl = class {};
export const setWorkerUrl = () => {};

export type MapFake = { fake: typeof fake };
