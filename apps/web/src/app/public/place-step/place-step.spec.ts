import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { BusinessKind, PlaceSection } from '@motor-fix/contracts';
import { PlacesService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import {
  type OpenPlaceMap,
  PLACE_MAP,
  type PlaceMapEvents,
  type Shown,
} from './place-map';
import { PlaceStep } from './place-step';

type Suggestion = { label: string; lat: number; lng: number };

const STEFAN: Suggestion = {
  label: 'Strada Ștefan cel Mare 12, Sector 2, București',
  lat: 44.4512,
  lng: 26.1207,
};
const suggestions = (n: number): Suggestion[] =>
  Array.from({ length: n }, (_, i) => ({
    label: `Strada Exemplu ${i + 1}, București`,
    lat: 44.4 + i / 100,
    lng: 26.1,
  }));

let search: jest.Mock;
let events: PlaceMapEvents;
let failMap: boolean;
const map = {
  destroy: jest.fn(),
  show: jest.fn<void, [Shown]>(),
};
const shown = () => map.show.mock.lastCall?.[0];
const openMap: jest.Mock<
  ReturnType<OpenPlaceMap>,
  Parameters<OpenPlaceMap>
> = jest.fn(async (_host, handlers) => {
  events = handlers;
  if (failMap) throw new Error('the style did not load');
  return map;
});

async function open(
  value: PlaceSection = {},
  businessKind?: BusinessKind,
  language: 'ro' | 'en' = 'ro',
) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: PlacesService, useValue: { placesControllerSearch: search } },
      { provide: PLACE_MAP, useValue: openMap },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(PlaceStep);
  fixture.componentRef.setInput('value', value);
  fixture.componentRef.setInput('businessKind', businessKind);
  const emitted: PlaceSection[] = [];
  fixture.componentInstance.value.subscribe((v) => emitted.push(v));
  await settle(fixture);
  const step = fixture.nativeElement as HTMLElement;
  return { emitted, fixture, step };
}

type Opened = Awaited<ReturnType<typeof open>>;
type Fixture = Opened['fixture'];

async function settle(fixture: Fixture) {
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const address = (step: HTMLElement) =>
  step.querySelector<HTMLInputElement>(
    'input[name="address"]',
  ) as HTMLInputElement;
const radius = (step: HTMLElement) =>
  step.querySelector<HTMLInputElement>('input[name="radiusKm"]');
const options = (step: HTMLElement) => [
  ...step.querySelectorAll<HTMLButtonElement>('.suggestions button'),
];
const button = (step: HTMLElement, label: string) => {
  const found = [...step.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => text(b) === label,
  );
  if (!found) throw new Error(`no button ${label}`);
  return found;
};
const labelOf = (step: HTMLElement, input: HTMLInputElement) =>
  text(step.querySelector(`label[for="${input.id}"]`));
const described = (step: HTMLElement, input: HTMLInputElement) =>
  (input.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => text(step.querySelector(`#${id}`)))
    .join(' ');

async function type({ fixture, step }: Opened, value: string, pause = 350) {
  const input = address(step);
  input.value = value;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
  await wait(pause);
  await settle(fixture);
}

async function key({ fixture }: Opened, target: HTMLElement, name: string) {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, key: name }),
  );
  await settle(fixture);
}

async function mapEvent({ fixture }: Opened, act: () => void) {
  act();
  await settle(fixture);
}

beforeEach(() => {
  failMap = false;
  openMap.mockClear();
  map.destroy.mockClear();
  map.show.mockClear();
  search = jest.fn(async ({ q }: { q: string }) =>
    q.toLowerCase().includes('nicăieri') ? { items: [] } : { items: [STEFAN] },
  );
});

describe('step 5, the place', () => {
  it('asks for the address with its placeholder, a map and the manual pin', async () => {
    const { step } = await open();

    expect(labelOf(step, address(step))).toBe('Adresă');
    expect(address(step).placeholder).toBe('Stradă și număr, sector, oraș');
    expect(openMap).toHaveBeenCalledTimes(1);
    expect(button(step, 'Pune pinul pe hartă')).toBeTruthy();
    expect(radius(step)).toBeNull();
  });

  it('speaks English when the page does', async () => {
    const { step } = await open({}, 'company', 'en');

    expect(labelOf(step, address(step))).toBe('Address');
    expect(address(step).placeholder).toBe('Street and number, sector, town');
    expect(button(step, 'Place the pin on the map')).toBeTruthy();
  });

  it('asks nothing for one or two characters', async () => {
    const opened = await open();

    await type(opened, 'St');

    expect(search).not.toHaveBeenCalled();
    expect(options(opened.step)).toEqual([]);
  });

  it('asks once, a moment after the typing stops, in the page language', async () => {
    const opened = await open();

    await type(opened, 'Str', 50);
    await type(opened, 'Str. Ștef', 50);
    expect(search).not.toHaveBeenCalled();
    await type(opened, 'Str. Ștefan cel Mare 12, Sector 2');

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith({
      lang: 'ro',
      q: 'Str. Ștefan cel Mare 12, Sector 2',
    });
    expect(options(opened.step).map(text)).toEqual([STEFAN.label]);
  });

  it('keeps what is typed in the section as it goes', async () => {
    const opened = await open();

    await type(opened, 'Strada Exemplu 1');

    expect(opened.emitted.at(-1)).toEqual({ address: 'Strada Exemplu 1' });
  });

  it('shows at most five suggestions and announces how many', async () => {
    search.mockResolvedValue({ items: suggestions(7) });
    const opened = await open();

    await type(opened, 'Strada Exemplu');

    expect(options(opened.step)).toHaveLength(5);
    expect(text(opened.step.querySelector('[aria-live="polite"]'))).toContain(
      '5',
    );
  });

  it('drops a late answer to an older text', async () => {
    let late: (answer: { items: Suggestion[] }) => void = () => undefined;
    search
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            late = resolve;
          }),
      )
      .mockResolvedValueOnce({ items: [STEFAN] });
    const opened = await open();

    await type(opened, 'Strada Exemplu');
    await type(opened, 'Str. Ștefan cel Mare');
    late({ items: suggestions(3) });
    await settle(opened.fixture);

    expect(options(opened.step).map(text)).toEqual([STEFAN.label]);
  });

  it('fills the field, keeps the position and drops the pin on choosing a suggestion', async () => {
    const opened = await open();
    await type(opened, 'Str. Ștefan cel Mare 12, Sector 2');

    options(opened.step)[0].click();
    await settle(opened.fixture);

    expect(opened.emitted.at(-1)).toEqual({
      address: STEFAN.label,
      lat: STEFAN.lat,
      lng: STEFAN.lng,
    });
    expect(address(opened.step).value).toBe(STEFAN.label);
    expect(shown()?.at).toEqual({
      lat: STEFAN.lat,
      lng: STEFAN.lng,
    });
    expect(options(opened.step)).toEqual([]);
  });

  it('is worked by keyboard: arrows move, Enter chooses, Escape closes', async () => {
    search.mockResolvedValue({ items: suggestions(3) });
    const opened = await open();
    const input = address(opened.step);
    await type(opened, 'Strada Exemplu');

    await key(opened, input, 'ArrowDown');
    await key(opened, input, 'ArrowDown');
    const active = input.getAttribute('aria-activedescendant') ?? '';
    expect(text(opened.step.querySelector(`#${active}`))).toBe(
      'Strada Exemplu 2, București',
    );
    await key(opened, input, 'Enter');
    expect(opened.emitted.at(-1)?.address).toBe('Strada Exemplu 2, București');

    await type(opened, 'Strada Exemplu');
    expect(options(opened.step)).toHaveLength(3);
    await key(opened, input, 'Escape');
    expect(options(opened.step)).toEqual([]);
  });

  it('says when nothing is found and keeps the manual pin', async () => {
    const opened = await open();

    await type(opened, 'Bulevardul Nicăieri 7');

    expect(options(opened.step)).toEqual([]);
    expect(text(opened.step)).toContain('Pune pinul pe hartă');
  });

  it('places the pin with the one tap the button arms, and keeps the address', async () => {
    const opened = await open({ address: 'Bulevardul Nicăieri 7' });

    await mapEvent(opened, () => events.tapped({ lat: 45.1, lng: 25.2 }));
    expect(opened.emitted).toEqual([]);

    button(opened.step, 'Pune pinul pe hartă').click();
    await settle(opened.fixture);
    await mapEvent(opened, () => events.tapped({ lat: 45.1, lng: 25.2 }));
    await mapEvent(opened, () => events.tapped({ lat: 46, lng: 24 }));

    expect(opened.emitted).toEqual([
      { address: 'Bulevardul Nicăieri 7', lat: 45.1, lng: 25.2 },
    ]);
    expect(shown()?.at).toEqual({ lat: 45.1, lng: 25.2 });
  });

  it('leaves a placed pin where it is on a tap, even once the button is pressed', async () => {
    const opened = await open({
      address: STEFAN.label,
      lat: STEFAN.lat,
      lng: STEFAN.lng,
    });

    button(opened.step, 'Pune pinul pe hartă').click();
    await settle(opened.fixture);
    await mapEvent(opened, () => events.tapped({ lat: 46, lng: 24 }));

    expect(opened.emitted).toEqual([]);
    expect(shown()?.at).toEqual({
      lat: STEFAN.lat,
      lng: STEFAN.lng,
    });
    expect(
      button(opened.step, 'Pune pinul pe hartă').getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('moves the position when the pin is dragged and leaves the address', async () => {
    const opened = await open({
      address: STEFAN.label,
      lat: STEFAN.lat,
      lng: STEFAN.lng,
    });

    expect(shown()?.at).toEqual({ lat: STEFAN.lat, lng: STEFAN.lng });
    await mapEvent(opened, () => events.dragged({ lat: 44.452, lng: 26.121 }));

    expect(opened.emitted.at(-1)).toEqual({
      address: STEFAN.label,
      lat: 44.452,
      lng: 26.121,
    });
  });

  it('nudges a placed pin with the arrow keys on the map', async () => {
    const opened = await open({
      address: STEFAN.label,
      lat: STEFAN.lat,
      lng: STEFAN.lng,
    });
    const area = opened.step.querySelector<HTMLElement>('.map') as HTMLElement;

    expect(area.tabIndex).toBe(0);
    await key(opened, area, 'ArrowUp');
    const up = opened.emitted.at(-1) as PlaceSection;
    expect(up.lat).toBeGreaterThan(STEFAN.lat);
    expect(up.lng).toBe(STEFAN.lng);
    await key(opened, area, 'ArrowRight');
    expect(opened.emitted.at(-1)?.lng).toBeGreaterThan(STEFAN.lng);
  });

  it('does nothing on the arrow keys before there is a pin', async () => {
    const opened = await open({ address: STEFAN.label });

    await key(
      opened,
      opened.step.querySelector('.map') as HTMLElement,
      'ArrowUp',
    );

    expect(opened.emitted).toEqual([]);
  });

  it('keeps a pin dropped outside Romania where it fell and says why', async () => {
    const opened = await open({
      address: STEFAN.label,
      lat: STEFAN.lat,
      lng: STEFAN.lng,
    });

    await mapEvent(opened, () => events.dragged({ lat: 48.2, lng: 16.37 }));

    expect(opened.emitted).toEqual([
      { address: STEFAN.label, lat: 48.2, lng: 16.37 },
    ]);
    expect(text(opened.step.querySelector('.map-area'))).toContain(
      'Adresa trebuie să fie în România',
    );
  });

  it('says the search is down and keeps the field and the manual pin', async () => {
    search.mockRejectedValue(new Error('503'));
    const opened = await open();

    await type(opened, 'Strada Exemplu');

    expect(described(opened.step, address(opened.step))).toContain(
      'Căutarea adresei nu merge acum',
    );
    expect(address(opened.step).disabled).toBe(false);
    expect(button(opened.step, 'Pune pinul pe hartă').disabled).toBe(false);
  });

  it('says the map could not be loaded and keeps the address', async () => {
    failMap = true;
    const opened = await open({ address: 'Strada Exemplu 1' });

    expect(text(opened.step.querySelector('.map-area'))).toContain(
      'Harta nu s‑a putut încărca',
    );
    await type(opened, 'Strada Exemplu 12');
    expect(opened.emitted.at(-1)).toEqual({ address: 'Strada Exemplu 12' });
  });

  it('says the map could not be loaded when its tiles fail later', async () => {
    const opened = await open();

    await mapEvent(opened, () => events.failed());

    expect(text(opened.step.querySelector('.map-area'))).toContain(
      'Harta nu s‑a putut încărca',
    );
  });

  // @traces 945-FR-004
  it('clears the notice once the loaded map renders again without an error', async () => {
    const opened = await open();
    await mapEvent(opened, () => events.failed());

    await mapEvent(opened, () => events.recovered());

    expect(text(opened.step.querySelector('.map-area'))).not.toContain(
      'Harta nu s‑a putut încărca',
    );
  });
});

describe('step 5 for a mobile mechanic', () => {
  it('asks for the registered seat and the area, 20 km when none is given', async () => {
    const { step } = await open({}, 'mobile');

    expect(labelOf(step, address(step))).toBe('Sediul înregistrat');
    const area = radius(step) as HTMLInputElement;
    expect(labelOf(step, area)).toBe('Zona în care lucrezi');
    expect(area.value).toBe('20');
    expect(described(step, area)).toContain('Între 1 și 100 km');
  });

  it('sends the pin and the radius in force to the map together, once', async () => {
    await open(
      { address: STEFAN.label, lat: STEFAN.lat, lng: STEFAN.lng },
      'mobile',
    );

    expect(map.show).toHaveBeenCalledTimes(1);
    expect(map.show).toHaveBeenCalledWith({
      at: { lat: STEFAN.lat, lng: STEFAN.lng },
      km: 20,
    });
  });

  it('sends a workshop pin to the map with no radius', async () => {
    await open(
      { address: STEFAN.label, lat: STEFAN.lat, lng: STEFAN.lng, radiusKm: 35 },
      'company',
    );

    expect(map.show).toHaveBeenLastCalledWith({
      at: { lat: STEFAN.lat, lng: STEFAN.lng },
      km: undefined,
    });
  });

  it('keeps a whole radius from 1 to 100 and redraws the circle', async () => {
    const opened = await open(
      { address: STEFAN.label, lat: STEFAN.lat, lng: STEFAN.lng },
      'mobile',
    );
    expect(shown()?.km).toBe(20);
    const area = radius(opened.step) as HTMLInputElement;

    for (const km of [1, 100, 35]) {
      area.value = String(km);
      area.dispatchEvent(new Event('input'));
      await settle(opened.fixture);
      expect(opened.emitted.at(-1)?.radiusKm).toBe(km);
      expect(shown()?.km).toBe(km);
    }
  });

  it('keeps the radius when the map could not be loaded', async () => {
    failMap = true;
    const opened = await open(
      { address: STEFAN.label, lat: STEFAN.lat, lng: STEFAN.lng },
      'mobile',
    );
    const area = radius(opened.step) as HTMLInputElement;

    area.value = '35';
    area.dispatchEvent(new Event('input'));
    await settle(opened.fixture);

    expect(opened.emitted.at(-1)?.radiusKm).toBe(35);
    expect(shown()).toBeUndefined();
  });

  it.each(['0', '101', '12.5', 'a'])(
    'refuses %s km and keeps the last good value drawn',
    async (typed) => {
      const opened = await open(
        { address: STEFAN.label, radiusKm: 35 },
        'mobile',
      );
      const area = radius(opened.step) as HTMLInputElement;
      const sent = map.show.mock.calls.length;

      area.value = typed;
      area.dispatchEvent(new Event('input'));
      await settle(opened.fixture);

      expect(opened.emitted).toEqual([]);
      expect(map.show).toHaveBeenCalledTimes(sent);
      expect(area.getAttribute('aria-invalid')).toBe('true');
      expect(described(opened.step, area)).toContain('Între 1 și 100 km');
      expect(shown()?.km).toBe(35);
    },
  );

  it('keeps the address, position and radius when the kind changes back', async () => {
    const value = {
      address: STEFAN.label,
      lat: STEFAN.lat,
      lng: STEFAN.lng,
      radiusKm: 35,
    };
    const opened = await open(value, 'mobile');

    opened.fixture.componentRef.setInput('businessKind', 'company');
    await settle(opened.fixture);

    expect(labelOf(opened.step, address(opened.step))).toBe('Adresă');
    expect(address(opened.step).value).toBe(STEFAN.label);
    expect(radius(opened.step)).toBeNull();
    expect(shown()?.km).toBeUndefined();
    expect(opened.emitted).toEqual([]);
  });
});

describe('the map on the listing page', () => {
  it('keeps its own controls under the pinned Save bar: the map is its own stacking context', () => {
    const css = readFileSync(join(__dirname, 'place-step.css'), 'utf8');
    const map = /(?:^|\n)\.map \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(map).toMatch(/isolation:\s*isolate;/);
  });
});
