import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PlacesService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { PlaceDialog } from './place-dialog';
import type { Place } from '../place-store';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

type Suggestion = { label: string; lat: number; lng: number };
const CLUJ: Suggestion = {
  label: 'Strada Exemplu 2, Cluj-Napoca',
  lat: 46.7712,
  lng: 23.6236,
};
const suggestions = (n: number): Suggestion[] =>
  Array.from({ length: n }, (_, i) => ({
    label: `Strada Exemplu ${i + 1}, Cluj-Napoca`,
    lat: 46.77 + i / 100,
    lng: 23.62,
  }));

type Located = {
  ok: PositionCallback;
  fail: PositionErrorCallback;
  options?: PositionOptions;
};
let located: Located[];
let search: jest.Mock;
let result: Promise<OverlayResult<Place>>;
let closed: OverlayResult<Place> | undefined;

function geolocation(available = true) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: available
      ? {
          getCurrentPosition: jest.fn(
            (
              ok: PositionCallback,
              fail: PositionErrorCallback,
              options?: PositionOptions,
            ) => located.push({ fail, ok, options }),
          ),
        }
      : undefined,
  });
}

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function open(language: 'ro' | 'en' = 'ro') {
  TestBed.configureTestingModule({
    providers: [
      { provide: PlacesService, useValue: { placesControllerSearch: search } },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const host = TestBed.createComponent(Host);
  closed = undefined;
  result = host.componentInstance.overlays.open<Place>(PlaceDialog, {
    confirmDiscard: false,
    shape: 'dialog',
    title: 'public.home.place.title',
  });
  const opened = result;
  // A dialog left open by the test before is closed when its TestBed resets;
  // that late answer is not this dialog's.
  void opened.then((value) => {
    if (result === opened) closed = value;
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const buttons = () => [
  ...panel().querySelectorAll<HTMLButtonElement>('button'),
];
const locate = () =>
  buttons().find((b) =>
    /Folosește locația mea|Se caută locația|Use my location|Finding your location/.test(
      text(b),
    ),
  );
const field = () =>
  panel().querySelector<HTMLInputElement>(
    'input[role="combobox"]',
  ) as HTMLInputElement;
const options = () => [
  ...panel().querySelectorAll<HTMLButtonElement>('[role="option"]'),
];
const live = () => text(panel().querySelector('[aria-live="polite"]'));

async function type(value: string, pause = 350) {
  const input = field();
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(pause);
  await settle();
}

async function key(name: string) {
  field().dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, key: name }),
  );
  await settle();
}

const position = (latitude: number, longitude: number) =>
  ({ coords: { latitude, longitude } }) as GeolocationPosition;
const refusal = (code: number) =>
  ({ code, message: 'no' }) as GeolocationPositionError;

beforeEach(() => {
  located = [];
  search = jest.fn(async () => ({ items: [CLUJ] }));
  geolocation();
});

afterEach(() => {
  TestBed.resetTestingModule();
  document.querySelectorAll('.cdk-overlay-container').forEach((c) => {
    c.innerHTML = '';
  });
});

describe('the place dialog, by location', () => {
  it('offers the location and an address field, and asks nothing on opening', async () => {
    await open();

    expect(text(locate())).toBe('Folosește locația mea');
    expect(field()).not.toBeNull();
    expect(located).toHaveLength(0);
    expect(search).not.toHaveBeenCalled();
  });

  it('says it in English on the English page', async () => {
    await open('en');

    expect(text(locate())).toBe('Use my location');
  });

  it('offers no location button when the browser has no geolocation', async () => {
    geolocation(false);
    await open();

    expect(locate()).toBeUndefined();
    expect(field()).not.toBeNull();
  });

  it('asks the browser once, for at most 10 seconds, and waits disabled', async () => {
    await open();

    locate()?.click();
    await settle();

    expect(located).toHaveLength(1);
    expect(located[0].options).toMatchObject({ timeout: 10_000 });
    expect(locate()?.disabled).toBe(true);
    expect(text(locate())).toBe('Se caută locația…');
    expect(closed).toBeUndefined();
  });

  it('closes with the rounded point of a location in Romania', async () => {
    await open();
    locate()?.click();
    await settle();

    located[0].ok(position(46.7712, 23.6236));
    await settle();
    await result;

    expect(closed).toEqual({
      label: null,
      lat: 46.771,
      lng: 23.624,
      origin: 'location',
    });
  });

  it.each([
    ['a refusal', (l: Located) => l.fail(refusal(1))],
    ['no position', (l: Located) => l.fail(refusal(2))],
    ['a timeout', (l: Located) => l.fail(refusal(3))],
    ['a point outside Romania', (l: Located) => l.ok(position(47.498, 19.04))],
  ])('after %s, hints at the address and focuses it', async (_, end) => {
    await open();
    locate()?.click();
    await settle();

    end(located[0]);
    await settle();

    expect(live()).toBe('Nu am putut afla locația; scrie o adresă');
    expect(document.activeElement).toBe(field());
    expect(locate()?.disabled).toBe(false);
    expect(closed).toBeUndefined();
  });
});

describe('the place dialog, by address', () => {
  it('asks nothing under three characters and shows nothing', async () => {
    await open();

    await type('Cl');

    expect(search).not.toHaveBeenCalled();
    expect(options()).toHaveLength(0);
    expect(live()).toBe('');
  });

  it('asks once, 300 ms after the last key, in the page language', async () => {
    await open('en');

    await type('Clu', 100);
    await type('Cluj', 100);
    expect(search).not.toHaveBeenCalled();
    await wait(250);
    await settle();

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith({ lang: 'en', q: 'Cluj' });
  });

  it('asks nothing once it is closed before the pause ends', async () => {
    await open();

    await type('Cluj', 100);
    await key('Escape');
    expect(closed).toBeDefined();
    await wait(300);
    await settle();

    expect(search).not.toHaveBeenCalled();
  });

  it('shows at most five suggestions as options of a listbox', async () => {
    search.mockResolvedValue({ items: suggestions(7) });
    await open();

    await type('Strada');

    expect(field().getAttribute('aria-expanded')).toBe('true');
    expect(panel().querySelector('[role="listbox"]')).not.toBeNull();
    expect(options().map(text)).toEqual(suggestions(5).map((s) => s.label));
  });

  it('closes with the suggestion chosen, its label and its point', async () => {
    await open();
    await type('Cluj');

    options()[0].click();
    await settle();
    await result;

    expect(closed).toEqual({
      label: CLUJ.label,
      lat: 46.771,
      lng: 23.624,
      origin: 'address',
    });
  });

  it('walks the suggestions with the arrows and takes one with Enter', async () => {
    search.mockResolvedValue({ items: suggestions(3) });
    await open();
    await type('Strada');

    await key('ArrowDown');
    await key('ArrowDown');
    expect(options()[1].getAttribute('aria-selected')).toBe('true');
    expect(field().getAttribute('aria-activedescendant')).toBe(options()[1].id);
    await key('Enter');
    await result;

    expect(closed).toMatchObject({ label: suggestions(3)[1].label });
  });

  it('says when nothing was found', async () => {
    search.mockResolvedValue({ items: [] });
    await open();

    await type('nicaieri');

    expect(live()).toBe('Nu am găsit adresa');
    expect(options()).toHaveLength(0);
  });

  it.each([
    ['the provider is down', new HttpErrorResponse({ status: 503 })],
    ['too many look-ups', new HttpErrorResponse({ status: 429 })],
    ['the network', new HttpErrorResponse({ status: 0 })],
  ])(
    'says it cannot search when %s, and asks again on the next key',
    async (_, error) => {
      search.mockRejectedValueOnce(error);
      await open();

      await type('Cluj');
      expect(live()).toBe('Nu putem căuta adrese acum');
      expect(closed).toBeUndefined();

      await type('Cluj-');

      expect(search).toHaveBeenCalledTimes(2);
      expect(options().map(text)).toEqual([CLUJ.label]);
      expect(live()).not.toContain('Nu putem');
    },
  );

  it('shows only the answer to the latest text', async () => {
    let first: (value: unknown) => void = () => undefined;
    search.mockImplementationOnce(
      () => new Promise((resolve) => (first = resolve)),
    );
    await open();

    await type('Strada');
    await type('Cluj');
    first({ items: suggestions(3) });
    await settle();

    expect(options().map(text)).toEqual([CLUJ.label]);
  });
});
