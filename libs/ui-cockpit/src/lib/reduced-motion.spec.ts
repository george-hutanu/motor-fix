import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';

import { injectReducedMotion } from './reduced-motion';

const QUERY = '(prefers-reduced-motion: reduce)';

function fakeDevice(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    addEventListener: jest.fn((_: string, l: never) => listeners.add(l)),
    matches,
    media: QUERY,
    removeEventListener: jest.fn((_: string, l: never) => listeners.delete(l)),
  };
  const matchMedia = jest
    .spyOn(window, 'matchMedia')
    .mockImplementation((query) =>
      query === QUERY
        ? (media as unknown as MediaQueryList)
        : ({ matches: false, media: query } as MediaQueryList),
    );
  return {
    listeners,
    matchMedia,
    media,
    set(next: boolean) {
      media.matches = next;
      for (const l of listeners) l({ matches: next } as MediaQueryListEvent);
    },
  };
}

const read = () => TestBed.runInInjectionContext(injectReducedMotion);

afterEach(() => jest.restoreAllMocks());

describe('injectReducedMotion', () => {
  it.each([
    true,
    false,
  ])('reads the device setting at start (%p)', (matches) => {
    fakeDevice(matches);

    expect(read()()).toBe(matches);
  });

  it('follows the device setting live', () => {
    const device = fakeDevice(false);
    const reduced = read();

    device.set(true);
    expect(reduced()).toBe(true);
    device.set(false);
    expect(reduced()).toBe(false);
  });

  it('is one shared signal, asking the device once', () => {
    const device = fakeDevice(false);

    expect(read()).toBe(read());
    expect(device.matchMedia).toHaveBeenCalledTimes(1);
    expect(device.listeners.size).toBe(1);
  });

  it('stops listening when the app is destroyed', () => {
    const device = fakeDevice(false);
    read();

    TestBed.resetTestingModule();

    expect(device.listeners.size).toBe(0);
  });

  it('is false where there is no device, as on the server', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: DOCUMENT, useValue: { defaultView: null } }],
    });

    expect(read()()).toBe(false);
  });
});
