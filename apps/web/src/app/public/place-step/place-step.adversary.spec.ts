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
  if (mapGate) await mapGate;
  return map;
});
let mapGate: Promise<void> | undefined;

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
  mapGate = undefined;
  openMap.mockClear();
  map.destroy.mockClear();
  map.show.mockClear();
  search = jest.fn(async ({ q }: { q: string }) =>
    q.toLowerCase().includes('nicăieri') ? { items: [] } : { items: [STEFAN] },
  );
});

describe('step 5 against hostile typing and answers', () => {
  it('stops the field at 200 characters', async () => {
    const { step } = await open();

    expect(address(step).maxLength).toBe(200);
  });

  it('never emits an address longer than the draft takes when a suggestion is long', async () => {
    const long = {
      label: `Strada ${'Lungă '.repeat(60)}`,
      lat: 44.4,
      lng: 26.1,
    };
    search.mockResolvedValue({ items: [long] });
    const opened = await open();
    await type(opened, 'Strada Lungă');

    options(opened.step)[0].click();
    await settle(opened.fixture);

    expect(opened.emitted.at(-1)?.address?.length).toBeLessThanOrEqual(200);
  });

  it('shows a suggestion made of markup as text, not as elements', async () => {
    const label = '<img src=x onerror="window.__owned=1"><b>Strada</b>';
    search.mockResolvedValue({ items: [{ label, lat: 44.4, lng: 26.1 }] });
    const opened = await open();

    await type(opened, 'Strada Exemplu');

    expect(opened.step.querySelector('img')).toBeNull();
    expect(opened.step.querySelector('.suggestions b')).toBeNull();
    expect(text(options(opened.step)[0])).toBe(label);
  });

  it('asks nothing for spaces around two characters', async () => {
    const opened = await open();

    await type(opened, '   ab   ');

    expect(search).not.toHaveBeenCalled();
  });

  it('asks with the text trimmed', async () => {
    const opened = await open();

    await type(opened, '   Strada Exemplu   ');

    expect(search).toHaveBeenCalledWith({ lang: 'ro', q: 'Strada Exemplu' });
  });

  it('does not ask again for the same text when only spaces were added', async () => {
    const opened = await open();
    await type(opened, 'Strada Exemplu');
    search.mockClear();

    await type(opened, 'Strada Exemplu   ');

    expect(search).not.toHaveBeenCalled();
  });

  it('shows no suggestions from an answer that comes after the text fell under three characters', async () => {
    let late: (answer: { items: Suggestion[] }) => void = () => undefined;
    search.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          late = resolve;
        }),
    );
    const opened = await open();
    await type(opened, 'Strada Exemplu');

    await type(opened, 'St');
    late({ items: suggestions(3) });
    await settle(opened.fixture);

    expect(options(opened.step)).toEqual([]);
  });

  it('does not say the search is down for an old failure after a newer answer', async () => {
    let fail: (reason: Error) => void = () => undefined;
    search
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            fail = reject;
          }),
      )
      .mockResolvedValueOnce({ items: [STEFAN] });
    const opened = await open();
    await type(opened, 'Strada Exemplu');
    await type(opened, 'Strada Ștefan');

    fail(new Error('503'));
    await settle(opened.fixture);

    expect(described(opened.step, address(opened.step))).not.toContain(
      'Căutarea adresei nu merge acum',
    );
    expect(options(opened.step).map(text)).toEqual([STEFAN.label]);
  });

  it('clears the search-down message once a later look-up answers', async () => {
    search
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValueOnce({ items: [STEFAN] });
    const opened = await open();
    await type(opened, 'Strada Exemplu');

    await type(opened, 'Strada Ștefan');

    expect(described(opened.step, address(opened.step))).not.toContain(
      'Căutarea adresei nu merge acum',
    );
  });

  it('asks nothing after the step is gone', async () => {
    const opened = await open();
    const input = address(opened.step);
    input.value = 'Strada Exemplu';
    input.dispatchEvent(new Event('input'));

    opened.fixture.destroy();
    await wait(400);

    expect(search).not.toHaveBeenCalled();
  });

  it('lets go of a map that opens after the step is gone', async () => {
    let release: () => void = () => undefined;
    mapGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: PlacesService,
          useValue: { placesControllerSearch: search },
        },
        { provide: PLACE_MAP, useValue: openMap },
      ],
    });
    await TestBed.inject(I18n).enter('public');
    const fixture = TestBed.createComponent(PlaceStep);
    fixture.componentRef.setInput('value', {});
    fixture.detectChanges();
    await wait(10);

    fixture.destroy();
    release();
    await wait(20);

    expect(map.destroy).toHaveBeenCalledTimes(1);
  });

  it('takes a restored section handed in after the step opened', async () => {
    const opened = await open();

    opened.fixture.componentRef.setInput('value', {
      address: STEFAN.label,
      lat: STEFAN.lat,
      lng: STEFAN.lng,
    });
    await settle(opened.fixture);

    expect(address(opened.step).value).toBe(STEFAN.label);
    expect(shown()?.at).toEqual({
      lat: STEFAN.lat,
      lng: STEFAN.lng,
    });
    expect(opened.emitted).toEqual([]);
  });

  it('emits a pin on the very edge of the country without the Romania message', async () => {
    const opened = await open({ address: STEFAN.label });
    button(opened.step, 'Pune pinul pe hartă').click();
    await settle(opened.fixture);

    await mapEvent(opened, () => events.tapped({ lat: 43.5, lng: 20.2 }));

    expect(opened.emitted.at(-1)).toEqual({
      address: STEFAN.label,
      lat: 43.5,
      lng: 20.2,
    });
    expect(text(opened.step.querySelector('.map-area'))).not.toContain(
      'Adresa trebuie să fie în România',
    );
  });

  it('clears the Romania message when the pin is dragged back inside', async () => {
    const opened = await open({
      address: STEFAN.label,
      lat: STEFAN.lat,
      lng: STEFAN.lng,
    });
    await mapEvent(opened, () => events.dragged({ lat: 48.2, lng: 16.37 }));

    await mapEvent(opened, () => events.dragged({ lat: 44.4, lng: 26.1 }));

    expect(text(opened.step.querySelector('.map-area'))).not.toContain(
      'Adresa trebuie să fie în România',
    );
  });

  it('does not nudge a pin that has no place, and does not arm a tap by a key press on the map', async () => {
    const opened = await open();

    await key(
      opened,
      opened.step.querySelector('.map') as HTMLElement,
      'Enter',
    );
    await mapEvent(opened, () => events.tapped({ lat: 45, lng: 25 }));

    expect(opened.emitted).toEqual([]);
  });

  it('keeps an address typed after the map failed and a position placed by hand impossible', async () => {
    failMap = true;
    const opened = await open();

    await type(opened, 'Strada Exemplu 12');

    expect(opened.emitted.at(-1)).toEqual({ address: 'Strada Exemplu 12' });
    expect(opened.emitted.at(-1)).not.toHaveProperty('lat');
  });
});

describe('step 5 radius against hostile typing', () => {
  it.each(['-5', '1e3', '100.5', '', ' ', '--3', '١٢'])(
    'refuses %j km and emits nothing',
    async (typed) => {
      const opened = await open(
        { address: STEFAN.label, radiusKm: 35 },
        'mobile',
      );
      const area = radius(opened.step) as HTMLInputElement;

      area.value = typed;
      area.dispatchEvent(new Event('input'));
      await settle(opened.fixture);

      expect(opened.emitted).toEqual([]);
      expect(map.show).not.toHaveBeenCalledWith(
        expect.objectContaining({ km: Number(typed) }),
      );
    },
  );

  it('shows 20 and draws 20 km for a section holding no radius, without emitting it', async () => {
    const opened = await open(
      { address: STEFAN.label, lat: STEFAN.lat, lng: STEFAN.lng },
      'mobile',
    );

    expect((radius(opened.step) as HTMLInputElement).value).toBe('20');
    expect(shown()?.km).toBe(20);
    expect(opened.emitted).toEqual([]);
  });

  it('draws no circle for a workshop even when its section holds a radius', async () => {
    await open({ address: STEFAN.label, radiusKm: 35 }, 'company');

    expect(map.show).not.toHaveBeenCalledWith(
      expect.objectContaining({ km: 35 }),
    );
  });

  it('recovers from a refused radius when a good one is typed after it', async () => {
    const opened = await open({ address: STEFAN.label }, 'mobile');
    const area = radius(opened.step) as HTMLInputElement;

    for (const typed of ['500', '50']) {
      area.value = typed;
      area.dispatchEvent(new Event('input'));
      await settle(opened.fixture);
    }

    expect(opened.emitted.at(-1)?.radiusKm).toBe(50);
    expect(area.getAttribute('aria-invalid')).not.toBe('true');
  });
});
