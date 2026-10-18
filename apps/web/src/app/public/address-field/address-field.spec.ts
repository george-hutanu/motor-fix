import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { PlacesService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { type AddressChoice, AddressField } from './address-field';

@Component({
  imports: [AddressField],
  template: `<mf-address-field
    ids="test-place"
    [label]="label()"
    [locate]="locate()"
    [autofocus]="autofocus()"
    (chosen)="chosen.push($event)"
  />`,
})
class Host {
  readonly label = signal<string | undefined>(undefined);
  readonly locate = signal(false);
  readonly autofocus = signal(false);
  readonly chosen: AddressChoice[] = [];
}

type Suggestion = {
  label: string;
  lat: number;
  lng: number;
  locality?: string;
};
const CLUJ: Suggestion = {
  label: 'Strada Exemplu 2, Cluj-Napoca',
  lat: 46.77123,
  lng: 23.62361,
  locality: 'Cluj-Napoca',
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
let fixture: ComponentFixture<Host>;

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
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function mount(
  over: { language?: 'ro' | 'en'; locate?: boolean; autofocus?: boolean } = {},
) {
  TestBed.configureTestingModule({
    providers: [
      { provide: PlacesService, useValue: { placesControllerSearch: search } },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (over.language === 'en') await i18n.use('en');
  fixture = TestBed.createComponent(Host);
  fixture.componentInstance.locate.set(over.locate ?? false);
  fixture.componentInstance.autofocus.set(over.autofocus ?? false);
  document.body.appendChild(fixture.nativeElement);
  await settle();
}

const root = () => fixture.nativeElement as HTMLElement;
const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const field = () =>
  root().querySelector<HTMLInputElement>(
    'input[role="combobox"]',
  ) as HTMLInputElement;
const options = () => [
  ...root().querySelectorAll<HTMLButtonElement>('[role="option"]'),
];
const live = () => text(root().querySelector('[aria-live="polite"]'));
const locateButton = () =>
  [...root().querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    /Folosește locația mea|Se caută locația|Use my location|Finding your location/.test(
      text(b),
    ),
  );
const chosen = () => fixture.componentInstance.chosen;

async function type(value: string, pause = 350) {
  const input = field();
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(pause);
  await settle();
}

function press(name: string) {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: name,
  });
  field().dispatchEvent(event);
  return event;
}

async function key(name: string) {
  const event = press(name);
  await settle();
  return event;
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
  fixture?.nativeElement.remove();
  TestBed.resetTestingModule();
  Reflect.deleteProperty(navigator, 'geolocation');
});

// @traces 271-garage-distance-FR-005
describe('the address field', () => {
  it('is a labelled combobox wired to its listbox and its message', async () => {
    await mount();

    const input = field();
    expect(input.id).toBe('test-place-address');
    expect(text(root().querySelector(`label[for="${input.id}"]`))).toBe(
      'Adresă',
    );
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    expect(input.getAttribute('aria-controls')).toBe('test-place-options');
    expect(input.getAttribute('aria-describedby')).toBe('test-place-message');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(
      root().querySelector('#test-place-options')?.getAttribute('role'),
    ).toBe('listbox');
  });

  // @traces 271-garage-distance-FR-002
  it('takes the label it is given, and names its list by it', async () => {
    await mount({ language: 'en' });
    expect(text(root().querySelector('label'))).toBe('Address');

    fixture.componentInstance.label.set('Enter an address');
    await settle();

    expect(text(root().querySelector('label'))).toBe('Enter an address');
    expect(
      root().querySelector('[role="listbox"]')?.getAttribute('aria-label'),
    ).toBe('Enter an address');
  });

  // @traces 271-garage-distance-FR-002
  it('takes focus when asked to', async () => {
    await mount({ autofocus: true });

    expect(document.activeElement).toBe(field());
  });

  it('leaves the focus where it is otherwise', async () => {
    await mount();

    expect(document.activeElement).not.toBe(field());
  });

  it('asks nothing under three characters and shows nothing', async () => {
    await mount();

    await type('Cl');

    expect(search).not.toHaveBeenCalled();
    expect(options()).toHaveLength(0);
    expect(live()).toBe('');
  });

  it('asks once, 300 ms after the last key, in the page language', async () => {
    await mount({ language: 'en' });

    await type('Clu', 100);
    await type('Cluj', 100);
    expect(search).not.toHaveBeenCalled();
    await wait(250);
    await settle();

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith({ lang: 'en', q: 'Cluj' });
  });

  it('asks from the third character, without the spaces around it', async () => {
    await mount();

    await type('  Clu  ');

    expect(search).toHaveBeenCalledWith({ lang: 'ro', q: 'Clu' });
  });

  it('shows at most five suggestions as options of the listbox', async () => {
    search.mockResolvedValue({ items: suggestions(7) });
    await mount();

    await type('Strada');

    expect(field().getAttribute('aria-expanded')).toBe('true');
    expect(options().map(text)).toEqual(suggestions(5).map((s) => s.label));
    expect(options().map((o) => o.id)).toEqual(
      [0, 1, 2, 3, 4].map((i) => `test-place-option-${i}`),
    );
  });

  it('shows only the answer to the latest text', async () => {
    let first: (value: unknown) => void = () => undefined;
    search.mockImplementationOnce(
      () => new Promise((resolve) => (first = resolve)),
    );
    await mount();

    await type('Strada');
    await type('Cluj');
    first({ items: suggestions(3) });
    await settle();

    expect(options().map(text)).toEqual([CLUJ.label]);
  });

  it('gives the suggestion tapped, with its label, its point and its town', async () => {
    await mount();
    await type('Cluj');

    options()[0].click();
    await settle();

    expect(chosen()).toEqual([
      {
        label: CLUJ.label,
        lat: CLUJ.lat,
        lng: CLUJ.lng,
        locality: 'Cluj-Napoca',
        origin: 'address',
      },
    ]);
    expect(options()).toHaveLength(0);
    expect(field().getAttribute('aria-expanded')).toBe('false');
  });

  it('cuts a label longer than an address may be', async () => {
    search.mockResolvedValue({
      items: [{ ...CLUJ, label: `Strada ${'Lungă '.repeat(60)}` }],
    });
    await mount();
    await type('Strada');

    options()[0].click();
    await settle();

    expect(chosen()[0]?.label?.length).toBeLessThanOrEqual(200);
  });

  it('walks the suggestions with the arrows, round the ends, and takes one with Enter', async () => {
    search.mockResolvedValue({ items: suggestions(3) });
    await mount();
    await type('Strada');

    await key('ArrowDown');
    await key('ArrowDown');
    expect(options()[1].getAttribute('aria-selected')).toBe('true');
    expect(field().getAttribute('aria-activedescendant')).toBe(options()[1].id);
    await key('ArrowUp');
    await key('ArrowUp');
    expect(options()[2].getAttribute('aria-selected')).toBe('true');
    const enter = await key('Enter');

    expect(enter.defaultPrevented).toBe(true);
    expect(chosen()).toEqual([
      expect.objectContaining({ label: suggestions(3)[2].label }),
    ]);
  });

  it('leaves Enter alone while no suggestion is walked to', async () => {
    await mount();
    await type('Cluj');

    const enter = await key('Enter');

    expect(enter.defaultPrevented).toBe(false);
    expect(chosen()).toEqual([]);
  });

  it('closes the list with Escape, and keeps Escape from going further only then', async () => {
    await mount();
    await type('Cluj');
    let heard = 0;
    const count = () => heard++;
    root().addEventListener('keydown', count);

    await key('Escape');
    expect(options()).toHaveLength(0);
    expect(field().getAttribute('aria-expanded')).toBe('false');
    expect(heard).toBe(0);

    await key('Escape');
    expect(heard).toBe(1);
    root().removeEventListener('keydown', count);
  });

  it('shows no late answer after Escape closed the list', async () => {
    let answer: (value: unknown) => void = () => undefined;
    search.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)),
    );
    await mount();
    await type('Cluj');

    await key('Escape');
    answer({ items: [CLUJ] });
    await settle();

    expect(options()).toHaveLength(0);
  });

  it('keeps every suggestion row at least 44 px tall', () => {
    const stylesheet = readFileSync(
      join(__dirname, 'address-field.css'),
      'utf8',
    );
    expect(stylesheet).toMatch(
      /\[role="option"\] \{[^}]*min-height: var\(--mf-tap\);/,
    );
    expect(stylesheet).toMatch(/\ninput \{[^}]*min-height: var\(--mf-tap\);/);
  });

  it.each([
    ['ro', 'Nu am găsit adresa'],
    ['en', 'Address not found'],
  ] as const)(
    'says politely when nothing was found (%s)',
    async (language, said) => {
      search.mockResolvedValue({ items: [] });
      await mount({ language });

      await type('nicaieri');

      expect(live()).toBe(said);
      expect(
        root().querySelector('#test-place-message')?.getAttribute('aria-live'),
      ).toBe('polite');
      expect(options()).toHaveLength(0);
    },
  );

  it.each([
    ['the provider is down', new HttpErrorResponse({ status: 503 })],
    ['too many look-ups', new HttpErrorResponse({ status: 429 })],
    ['the network', new HttpErrorResponse({ status: 0 })],
  ])(
    'says it cannot search when %s, and asks again on the next key',
    async (_, error) => {
      search.mockRejectedValueOnce(error);
      await mount();

      await type('Cluj');
      expect(live()).toBe('Nu putem căuta adrese acum');

      await type('Cluj-');

      expect(search).toHaveBeenCalledTimes(2);
      expect(options().map(text)).toEqual([CLUJ.label]);
      expect(live()).toBe('');
    },
  );

  it('says it in English when the look-up is down', async () => {
    search.mockRejectedValueOnce(new HttpErrorResponse({ status: 503 }));
    await mount({ language: 'en' });

    await type('Cluj');

    expect(live()).toBe('We cannot search addresses now');
  });

  it('asks nothing once it is gone before the pause ends', async () => {
    await mount();

    await type('Cluj', 100);
    fixture.destroy();
    await wait(300);

    expect(search).not.toHaveBeenCalled();
  });
});

// @traces 271-garage-distance-FR-005
describe('the address field, by location', () => {
  it('offers no location unless asked to', async () => {
    await mount();

    expect(locateButton()).toBeUndefined();
  });

  it('offers no location when the browser has none', async () => {
    geolocation(false);
    await mount({ locate: true });

    expect(locateButton()).toBeUndefined();
    expect(field()).not.toBeNull();
  });

  it('asks the browser once on a tap, for at most 10 seconds, and waits disabled', async () => {
    await mount({ locate: true });
    expect(text(locateButton())).toBe('Folosește locația mea');
    expect(located).toHaveLength(0);

    locateButton()?.click();
    await settle();

    expect(located).toHaveLength(1);
    expect(located[0].options).toMatchObject({ timeout: 10_000 });
    expect(locateButton()?.disabled).toBe(true);
    expect(text(locateButton())).toBe('Se caută locația…');
  });

  it('gives a location inside Romania as a place with no label', async () => {
    await mount({ locate: true });
    locateButton()?.click();
    await settle();

    located[0].ok(position(46.7712, 23.6236));
    await settle();

    expect(chosen()).toEqual([
      { label: null, lat: 46.7712, lng: 23.6236, origin: 'location' },
    ]);
  });

  it.each([
    ['a refusal', (l: Located) => l.fail(refusal(1))],
    ['no position', (l: Located) => l.fail(refusal(2))],
    ['a timeout', (l: Located) => l.fail(refusal(3))],
    ['a point outside Romania', (l: Located) => l.ok(position(47.498, 19.04))],
  ])('after %s, hints at the address and focuses it', async (_, end) => {
    await mount({ locate: true });
    locateButton()?.click();
    await settle();

    end(located[0]);
    await settle();

    expect(live()).toBe('Nu am putut afla locația; scrie o adresă');
    expect(document.activeElement).toBe(field());
    expect(locateButton()?.disabled).toBe(false);
    expect(chosen()).toEqual([]);
  });
});

describe('type scale', () => {
  // @traces 975-type-scale-FR-002
  // @traces 975-type-scale-FR-008
  const stylesheet = readFileSync(join(__dirname, 'address-field.css'), 'utf8');

  it('takes every text size from a Cockpit size token', () => {
    const sizes = stylesheet.match(/font-size:[^;]*;/g) ?? [];
    expect(
      sizes.filter((d) => !/^font-size: var\(--mf-size-[a-z]+\);$/.test(d)),
    ).toEqual([]);
  });

  it('sets `input` at the field size', () => {
    expect(stylesheet).toMatch(
      /\ninput \{[^}]*font-size: var\(--mf-size-field\);/,
    );
  });
});
