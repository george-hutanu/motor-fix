import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  BrandsService,
  CatalogueService,
  PlacesService,
  PublicHolidaysService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';

import { ListYourGarage } from './list-your-garage';
import { SignInDialog } from '../../sign-in/sign-in-dialog';
import { type BrowserDraft, STORAGE_KEY } from '../draft/draft';
import { PLACE_MAP, type PlaceMapEvents } from '../place-step/place-map';

// jsdom lays nothing out: each heading is placed by hand, the page is tall
// enough not to sit at its end, and scrolling is recorded, not done.
let tops = [1000, 2000, 3000, 4000, 5000, 6000];
const scrolls: ScrollIntoViewOptions[] = [];
const signIn = { start: jest.fn() };
// The catalogue behind step 2's chips, read through its own client.
const DACIA = {
  id: '7c1e4f2a-3b5d-4e6f-8a9b-0c1d2e3f4a5b',
  name: 'Dacia',
  popularity: 1,
  slug: 'dacia',
};
const catalogue = {
  brandsControllerSearch: jest.fn(async () => ({
    items: [DACIA],
    nextCursor: null,
    total: 1,
  })),
};
// The job catalogue behind step 3, read through its own client.
const jobId = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const JOBS = [
  { id: jobId(1), key: 'diagnosis', nameEn: 'Diagnosis', nameRo: 'Diagnoză' },
  { id: jobId(2), key: 'oil-service', nameEn: 'Oil', nameRo: 'Ulei' },
  { id: jobId(3), key: 'front-brakes', nameEn: 'Brakes', nameRo: 'Frâne' },
];
const jobs = {
  jobTypesControllerSearch: jest.fn(async () => ({ items: JOBS })),
};
// The legal holidays step 5 lists, read through their own client.
const holidays = { publicHolidaysControllerList: jest.fn(async () => []) };
// The address look-up and the map of step 5, both stood in for.
const places = {
  placesControllerSearch: jest.fn(async () => ({
    items: [{ label: 'Strada Exemplu 1, București', lat: 44.43, lng: 26.1 }],
  })),
};
let mapEvents: PlaceMapEvents | undefined;
const placeMap = jest.fn(async (_host: HTMLElement, events: PlaceMapEvents) => {
  mapEvents = events;
  return { destroy: jest.fn(), show: jest.fn() };
});

beforeEach(() => {
  localStorage.clear();
  signIn.start.mockReset();
  tops = [1000, 2000, 3000, 4000, 5000, 6000];
  scrolls.length = 0;
  jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      const sections = [...document.querySelectorAll('section h2')];
      const top = tops[sections.indexOf(this)] ?? 0;
      return { bottom: top + 40, height: 40, top } as DOMRect;
    });
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    value: 8000,
  });
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  Element.prototype.scrollIntoView = (options) => {
    scrolls.push(options as ScrollIntoViewOptions);
  };
});

afterEach(() => jest.restoreAllMocks());

async function open(path: string, reduced = false) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { component: ListYourGarage, path: ':lang/list-your-garage' },
      ]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: REDUCED_MOTION, useValue: signal(reduced) },
      { provide: SignInDialog, useValue: signIn },
      { provide: BrandsService, useValue: catalogue },
      { provide: PublicHolidaysService, useValue: holidays },
      { provide: CatalogueService, useValue: jobs },
      { provide: PlacesService, useValue: places },
      { provide: PLACE_MAP, useValue: placeMap },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (path.startsWith('/en/')) await i18n.use('en');
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(path);
  await settle(harness);
  const page = harness.routeNativeElement as HTMLElement;
  return { harness, i18n, page };
}

async function settle(harness: RouterTestingHarness) {
  for (let i = 0; i < 2; i++) {
    harness.detectChanges();
    await harness.fixture.whenStable();
    // The catalogue's answer takes a few turns of the microtask queue.
    for (let turn = 0; turn < 10; turn++) await Promise.resolve();
  }
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/‑/g, '-').replace(/\s+/g, ' ').trim();
const entries = (page: HTMLElement) => [
  ...page.querySelectorAll<HTMLButtonElement>('nav ol button'),
];
const current = (page: HTMLElement) =>
  [...page.querySelectorAll('[aria-current="step"]')].map(text);
// The steps the list marks complete, by number.
const ticked = (page: HTMLElement) =>
  [...page.querySelectorAll('nav ol li')].flatMap((li, i) =>
    li.querySelector('.done[aria-label="completat"]') ? [i + 1] : [],
  );
const bar = (page: HTMLElement) =>
  page.querySelector<HTMLButtonElement>('nav > button[aria-expanded]');
// What the browser fires once a scroll, the page's own jump included, has stopped.
const ended = () => window.dispatchEvent(new Event('scrollend'));

describe('the list your garage page', () => {
  it.each([
    [
      '/ro/list-your-garage',
      'PENTRU SERVICE-URI',
      'Pune-ți service-ul pe hartă',
      'Spune ce primești și ce refuzi. Cine îți cere o ofertă știe deja că lucrezi pe mașina lui.',
      [
        '1 Service-ul',
        '2 Mărci',
        '3 Prețuri',
        '4 Mecanici · opțional',
        '5 Fotografii și adresă',
        '6 Verificare · obligatoriu',
      ],
      'pasul',
    ],
    [
      '/en/list-your-garage',
      'FOR GARAGES',
      'Put your garage on the map',
      'Say what you take and what you turn down. Whoever asks you for a quote already knows you work on their car.',
      [
        '1 The garage',
        '2 Brands',
        '3 Prices',
        '4 Mechanics · optional',
        '5 Photos and place',
        '6 Verification · required',
      ],
      'step',
    ],
  ])(
    '%s shows the label, the heading, the introduction and the six numbered sections',
    async (path, label, heading, intro, headings, id) => {
      const { page } = await open(path);

      expect(text(page.querySelector('.label'))).toBe(label);
      expect(text(page.querySelector('h1'))).toBe(heading);
      expect(text(page.querySelector('.intro'))).toBe(intro);
      const sections = [...page.querySelectorAll('section')];
      expect(sections.map((s) => text(s.querySelector('h2')))).toEqual(
        headings,
      );
      expect(sections.map((s) => s.id)).toEqual(
        [1, 2, 3, 4, 5, 6].map((n) => `${id}-${n}`),
      );
      expect(entries(page).map(text)).toEqual(headings);
    },
  );

  it('holds the e-mail field and the details in step 1, and each other step its own part', async () => {
    const { page } = await open('/ro/list-your-garage');

    const sections = [...page.querySelectorAll('section')];
    expect(sections[0].querySelector('#listing-email')).not.toBeNull();
    expect(sections[0].querySelector('mf-details-step')).not.toBeNull();
    expect(sections[5].querySelector('#listing-cui')).not.toBeNull();
    expect(
      sections.slice(1, 5).map((s) => [...s.children].map((c) => c.tagName)),
    ).toEqual([
      ['H2', 'MF-BRANDS-STEP'],
      ['H2', 'MF-PRICES-STEP'],
      ['H2', 'MF-MECHANICS-STEP'],
      ['H2', 'MF-PHOTOS-STEP', 'MF-PLACE-STEP', 'MF-HOURS-STEP'],
    ]);
  });

  it('ticks only the optional step 4 on an empty form, and makes no request', async () => {
    const { page } = await open('/ro/list-your-garage');

    expect(ticked(page)).toEqual([4]);
    expect(stored()).toBeNull();
    TestBed.inject(HttpTestingController).verify();
  });

  it.each([
    ['/ro/list-your-garage', 'Pași'],
    ['/en/list-your-garage', 'Steps'],
  ])('%s has one step list, named %s', async (path, name) => {
    const { page } = await open(path);

    const navs = page.querySelectorAll('nav');
    expect(navs).toHaveLength(1);
    expect(navs[0].getAttribute('aria-label')).toBe(name);
    expect(navs[0].querySelectorAll('ol')).toHaveLength(1);
    expect(navs[0].querySelectorAll('ol > li')).toHaveLength(6);
  });

  it('puts the step list before the sections', async () => {
    const { page } = await open('/ro/list-your-garage');

    const nav = page.querySelector('nav') as HTMLElement;
    const first = page.querySelector('section') as HTMLElement;
    expect(
      nav.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('the current step', () => {
  it('is step 1 when the page opens, and only one entry is current', async () => {
    const { page } = await open('/ro/list-your-garage');

    expect(current(page)).toEqual(['1 Service-ul']);
  });

  it('follows the last heading that reached the top as the page scrolls', async () => {
    const { harness, page } = await open('/ro/list-your-garage');

    tops = [-2000, -1000, -10, 990, 1990, 2990];
    window.dispatchEvent(new Event('scroll'));
    await settle(harness);

    expect(current(page)).toEqual(['3 Prețuri']);
  });

  it('is step 6 at the end of the page', async () => {
    const { harness, page } = await open('/ro/list-your-garage');

    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: window.innerHeight + 3000,
    });
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 3000,
    });
    tops = [-3000, -2000, -1000, 100, 300, 500];
    window.dispatchEvent(new Event('scroll'));
    await settle(harness);

    expect(current(page)).toEqual(['6 Verificare · obligatoriu']);
  });

  it('becomes the tapped step, whose section scrolls into view and whose heading takes focus', async () => {
    const { harness, page } = await open('/ro/list-your-garage');

    entries(page)[4].click();
    await settle(harness);

    expect(current(page)).toEqual(['5 Fotografii și adresă']);
    expect(scrolls).toEqual([{ behavior: 'smooth', block: 'start' }]);
    const heading = page.querySelectorAll('section h2')[4];
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute('tabindex')).toBe('-1');
  });

  it('stays the tapped step while the jump is still scrolling, then follows the scroll again', async () => {
    const { harness, page } = await open('/ro/list-your-garage');

    entries(page)[3].click();
    tops = [-2000, -1000, -10, 990, 1990, 2990];
    window.dispatchEvent(new Event('scroll'));
    await settle(harness);
    expect(current(page)).toEqual(['4 Mecanici · opțional']);

    ended();
    window.dispatchEvent(new Event('scroll'));
    await settle(harness);
    expect(current(page)).toEqual(['3 Prețuri']);
  });

  it('stays the tapped step through a jump whose scroll starts late, then follows the scroll once the jump has ended', async () => {
    const { harness, page } = await open('/ro/list-your-garage');

    entries(page)[3].click();
    await new Promise((resolve) => setTimeout(resolve, 250));
    for (const flight of [
      [990, 1990, 2990, 3990, 4990, 5990],
      [-10, 990, 1990, 2990, 3990, 4990],
      [-2010, -1010, -10, 990, 1990, 2990],
      [-3000, -2000, -1000, 0, 1000, 2000],
    ]) {
      tops = flight;
      window.dispatchEvent(new Event('scroll'));
      await settle(harness);
      expect(current(page)).toEqual(['4 Mecanici · opțional']);
    }

    ended();
    await settle(harness);
    expect(current(page)).toEqual(['4 Mecanici · opțional']);
    tops = [-2000, -1000, -10, 990, 1990, 2990];
    window.dispatchEvent(new Event('scroll'));
    await settle(harness);
    expect(current(page)).toEqual(['3 Prețuri']);
  });

  it('holds the tapped step until the page has been still for a moment, counted from its last movement, where the browser never says a scroll ended', async () => {
    const onscrollend = Object.getOwnPropertyDescriptor(window, 'onscrollend');
    delete (window as { onscrollend?: unknown }).onscrollend;
    try {
      const { harness, page } = await open('/ro/list-your-garage');
      jest.useFakeTimers({ doNotFake: ['setImmediate'] });

      entries(page)[3].click();
      await jest.advanceTimersByTimeAsync(200);
      tops = [990, 1990, 2990, 3990, 4990, 5990];
      window.dispatchEvent(new Event('scroll'));
      await settle(harness);
      expect(current(page)).toEqual(['4 Mecanici · opțional']);

      await jest.advanceTimersByTimeAsync(140);
      tops = [-10, 990, 1990, 2990, 3990, 4990];
      window.dispatchEvent(new Event('scroll'));
      await settle(harness);
      expect(current(page)).toEqual(['4 Mecanici · opțional']);

      await jest.advanceTimersByTimeAsync(140);
      tops = [-2010, -1010, -10, 990, 1990, 2990];
      window.dispatchEvent(new Event('scroll'));
      await settle(harness);
      expect(current(page)).toEqual(['4 Mecanici · opțional']);

      await jest.advanceTimersByTimeAsync(160);
      tops = [-2000, -1000, -10, 990, 1990, 2990];
      window.dispatchEvent(new Event('scroll'));
      await settle(harness);
      expect(current(page)).toEqual(['3 Prețuri']);
    } finally {
      jest.useRealTimers();
      if (onscrollend)
        Object.defineProperty(window, 'onscrollend', onscrollend);
    }
  });

  it('holds nothing when the tapped heading is already at the line, so the next scroll is followed at once', async () => {
    const { harness, page } = await open('/ro/list-your-garage');
    tops = [-1000, 0, 1000, 2000, 3000, 4000];

    entries(page)[1].click();
    await settle(harness);
    expect(current(page)).toEqual(['2 Mărci']);

    tops = [-2000, -1000, -10, 990, 1990, 2990];
    window.dispatchEvent(new Event('scroll'));
    await settle(harness);
    expect(current(page)).toEqual(['3 Prețuri']);
  });

  it('stays the tapped step after the jump while its heading is on screen, when the page cannot bring it up to the line', async () => {
    const { harness, page } = await open('/ro/list-your-garage');

    entries(page)[2].click();
    tops = [-200, -50, 420, 470, 520, 570];
    window.dispatchEvent(new Event('scroll'));
    ended();
    tops = [-450, -300, 170, 220, 270, 320];
    window.dispatchEvent(new Event('scroll'));
    await settle(harness);
    expect(current(page)).toEqual(['3 Prețuri']);

    tops = [-300, -100, 900, 950, 1000, 1050];
    window.dispatchEvent(new Event('scroll'));
    await settle(harness);
    expect(current(page)).toEqual(['2 Mărci']);
  });

  it('jumps without a smooth scroll when the device asks for reduced motion', async () => {
    const { harness, page } = await open('/ro/list-your-garage', true);

    entries(page)[1].click();
    await settle(harness);

    expect(scrolls).toEqual([{ behavior: 'auto', block: 'start' }]);
  });

  it('makes each entry a button, so Enter and Space activate it', async () => {
    const { page } = await open('/ro/list-your-garage');

    for (const entry of entries(page)) {
      expect(entry.tagName).toBe('BUTTON');
      expect(entry.getAttribute('type')).toBe('button');
    }
  });
});

describe('the phone bar', () => {
  it('shows the current step as "n / 6 · label" and follows it', async () => {
    const { harness, page } = await open('/ro/list-your-garage');

    expect(text(bar(page))).toBe('1 / 6 · Service-ul');

    entries(page)[2].click();
    await settle(harness);
    expect(text(bar(page))).toBe('3 / 6 · Prețuri');
  });

  it('opens and closes the list, saying so through aria-expanded', async () => {
    const { harness, page } = await open('/ro/list-your-garage');

    expect(bar(page)?.getAttribute('aria-expanded')).toBe('false');
    bar(page)?.click();
    await settle(harness);
    expect(bar(page)?.getAttribute('aria-expanded')).toBe('true');
    bar(page)?.click();
    await settle(harness);
    expect(bar(page)?.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes after a step is tapped', async () => {
    const { harness, page } = await open('/ro/list-your-garage');

    bar(page)?.click();
    await settle(harness);
    entries(page)[4].click();
    await settle(harness);

    expect(bar(page)?.getAttribute('aria-expanded')).toBe('false');
    expect(current(page)).toEqual(['5 Fotografii și adresă']);
  });

  it('closes on a tap outside it, without jumping', async () => {
    const { harness, page } = await open('/ro/list-your-garage');

    bar(page)?.click();
    await settle(harness);
    page.querySelector('h1')?.click();
    await settle(harness);

    expect(bar(page)?.getAttribute('aria-expanded')).toBe('false');
    expect(current(page)).toEqual(['1 Service-ul']);
    expect(scrolls).toEqual([]);
  });

  it('closes on Escape and gives the focus back to the bar', async () => {
    const { harness, page } = await open('/ro/list-your-garage');

    bar(page)?.click();
    await settle(harness);
    entries(page)[2].focus();
    entries(page)[2].dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle(harness);

    expect(bar(page)?.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(bar(page));
    expect(current(page)).toEqual(['1 Service-ul']);
    expect(scrolls).toEqual([]);
  });
});

describe('switching the language', () => {
  it('keeps the current step and the page, and renames the sections', async () => {
    const { harness, i18n, page } = await open('/ro/list-your-garage');
    const heading = page.querySelector('h1');

    entries(page)[3].click();
    await settle(harness);
    await i18n.use('en');
    await settle(harness);

    expect(page.querySelector('h1')).toBe(heading);
    expect(text(heading)).toBe('Put your garage on the map');
    expect(current(page)).toEqual(['4 Mechanics · optional']);
    expect(text(bar(page))).toBe('4 / 6 · Mechanics');
    expect([...page.querySelectorAll('section')].map((s) => s.id)).toEqual(
      [1, 2, 3, 4, 5, 6].map((n) => `step-${n}`),
    );
  });
});

const API = '/api/v1/listing-drafts';
const field = (page: HTMLElement) =>
  page.querySelector<HTMLInputElement>('#listing-email') as HTMLInputElement;
const note = (page: HTMLElement) =>
  text(page.querySelector('.sections > p.note'));
const saveButton = (page: HTMLElement) =>
  page.querySelector<HTMLButtonElement>('.actions button') as HTMLButtonElement;
const stored = (): BrowserDraft | null =>
  JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
const seed = (draft: Partial<BrowserDraft>) =>
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      data: {},
      dirty: false,
      language: 'ro',
      savedAt: '2026-10-07T10:00:00.000Z',
      step: 1,
      ...draft,
    }),
  );

function type(harness: RouterTestingHarness, page: HTMLElement, value: string) {
  field(page).value = value;
  field(page).dispatchEvent(new Event('input'));
  harness.detectChanges();
}

function leave(harness: RouterTestingHarness, page: HTMLElement) {
  field(page).dispatchEvent(new Event('blur'));
  harness.detectChanges();
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 1));

async function requests(count = 1): Promise<TestRequest[]> {
  const http = TestBed.inject(HttpTestingController);
  let found: TestRequest[] = [];
  for (let i = 0; i < 200 && found.length < count; i++) {
    found = [...found, ...http.match(() => true)];
    if (found.length < count) await pause();
  }
  return found;
}

const request = async () => (await requests(1))[0] as TestRequest;

const created = (overrides = {}) => ({
  email: 'ion@service.test',
  id: 'd1',
  language: 'ro',
  linkSent: true,
  status: 'open',
  step: 1,
  token: 't1',
  updatedAt: '2026-10-07T12:00:00.000Z',
  ...overrides,
});

async function answered(
  harness: RouterTestingHarness,
  req: TestRequest,
  body: object | null,
  status = 200,
) {
  if (status === 0) req.error(new ProgressEvent('error'), { status: 0 });
  else req.flush(body, { status, statusText: status === 200 ? 'OK' : 'no' });
  for (let i = 0; i < 5; i++) await pause();
  await settle(harness);
}

async function withServerCopy(path = '/ro/list-your-garage') {
  seed({ draftId: 'd1', email: 'ion@service.test', token: 't1' });
  const opened = await open(path);
  const fetch = await request();
  await answered(opened.harness, fetch, {
    data: {},
    email: 'ion@service.test',
    id: 'd1',
    language: 'ro',
    status: 'open',
    step: 1,
    updatedAt: '2026-10-07T11:00:00.000Z',
  });
  return opened;
}

describe('the e-mail field and the save button', () => {
  it('names the field and points it at its hint', async () => {
    const { page } = await open('/ro/list-your-garage');

    const input = field(page);
    expect(input.type).toBe('email');
    expect(input.getAttribute('autocomplete')).toBe('email');
    expect(text(page.querySelector('label[for="listing-email"]'))).toBe(
      'E-mail',
    );
    expect(input.getAttribute('aria-describedby')).toBe('listing-email-hint');
    expect(text(page.querySelector('#listing-email-hint'))).toBe(
      'Îți trimitem un link ca să continui de pe orice dispozitiv.',
    );
  });

  it('names an invalid address when the field is left, and asks nothing of the server', async () => {
    const { harness, page } = await open('/ro/list-your-garage');

    type(harness, page, 'ion@service');
    leave(harness, page);
    await settle(harness);

    expect(field(page).getAttribute('aria-describedby')).toBe(
      'listing-email-error',
    );
    expect(field(page).getAttribute('aria-invalid')).toBe('true');
    expect(text(page.querySelector('#listing-email-error'))).toBe(
      'Scrie o adresă de e-mail validă.',
    );
    TestBed.inject(HttpTestingController).verify();
  });

  it('places one secondary save button after the sections, and one status note', async () => {
    const { page } = await open('/en/list-your-garage');

    const button = saveButton(page);
    expect(text(button)).toBe('Save draft');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('variant')).toBe('secondary');
    const sections = [...page.querySelectorAll('section')];
    expect(
      (sections.at(-1) as HTMLElement).compareDocumentPosition(button) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const notes = page.querySelectorAll('.sections > [role="status"]');
    expect(notes).toHaveLength(1);
    expect(notes[0].getAttribute('aria-live')).toBe('polite');
  });

  it('keeps the browser copy at once without an e-mail, and asks for one in the field', async () => {
    const { harness, page } = await open('/ro/list-your-garage');

    saveButton(page).click();
    await settle(harness);

    expect(stored()).toMatchObject({ data: {}, dirty: false, step: 1 });
    expect(text(page.querySelector('#listing-email-error'))).toBe(
      'Adaugă un e-mail ca să continui de pe alt dispozitiv',
    );
    expect(document.activeElement).toBe(field(page));
    TestBed.inject(HttpTestingController).verify();
  });

  it('keeps what was typed in the browser a second after the typing stops', async () => {
    const { harness, page } = await open('/ro/list-your-garage');
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      type(harness, page, 'ion@');
      await jest.advanceTimersByTimeAsync(900);
      expect(stored()).toBeNull();

      await jest.advanceTimersByTimeAsync(200);
      expect(stored()).toMatchObject({ email: 'ion@', step: 1 });
    } finally {
      jest.useRealTimers();
    }
  });

  it('opens a kept copy again at its step, with what was typed', async () => {
    seed({ email: 'ion@', step: 3 });

    const { page } = await open('/ro/list-your-garage');

    expect(field(page).value).toBe('ion@');
    expect(current(page)).toEqual(['3 Prețuri']);
    TestBed.inject(HttpTestingController).verify();
  });

  it('opens an empty form at step 1 when the kept copy holds data the server would refuse', async () => {
    seed({
      data: { steps: { '1': { name: 'a'.repeat(200) } } },
      email: 'ion@',
      step: 3,
      token: 't1',
    });

    const { page } = await open('/ro/list-your-garage');

    expect(field(page).value).toBe('');
    expect(current(page)).toEqual(['1 Service-ul']);
    TestBed.inject(HttpTestingController).verify();
  });

  it('keeps a kept copy at its step when a scroll leaves that heading on screen below the line', async () => {
    seed({ email: 'ion@', step: 3 });
    const { harness, page } = await open('/ro/list-your-garage');
    // The jump back to the kept step starts late, as on a page still busy opening.
    await new Promise((resolve) => setTimeout(resolve, 250));
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      for (const flight of [
        [990, 1990, 2990, 3990, 4990, 5990],
        [-10, 990, 1990, 2990, 3990, 4990],
      ]) {
        tops = flight;
        window.dispatchEvent(new Event('scroll'));
        await settle(harness);
        expect(current(page)).toEqual(['3 Prețuri']);
      }
      tops = [-450, -300, 170, 220, 270, 320];
      window.dispatchEvent(new Event('scroll'));
      ended();
      window.dispatchEvent(new Event('scroll'));
      await settle(harness);
      await jest.advanceTimersByTimeAsync(1100);

      expect(current(page)).toEqual(['3 Prețuri']);
      expect(stored()).toMatchObject({ step: 3 });
    } finally {
      jest.useRealTimers();
    }
  });

  it('goes on in memory when the browser keeps nothing, and says so', async () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    const { harness, page } = await open('/ro/list-your-garage');
    type(harness, page, 'ion@');
    saveButton(page).click();
    await settle(harness);

    expect(note(page)).toBe(
      'Browserul nu poate păstra ciorna. O păstrăm pe server după ce adaugi un e-mail.',
    );
    expect(field(page).value).toBe('ion@');
  });

  it('keeps the typed address, the step and the note when the language changes', async () => {
    const { harness, i18n, page } = await open('/ro/list-your-garage');

    type(harness, page, 'ion@');
    saveButton(page).click();
    entries(page)[2].click();
    await settle(harness);
    await i18n.use('en');
    await settle(harness);

    expect(field(page).value).toBe('ion@');
    expect(current(page)).toEqual(['3 Prices']);
    expect(text(page.querySelector('#listing-email-error'))).toBe(
      'Enter a valid e-mail address.',
    );
  });
});

describe('the server copy', () => {
  it('is made once when a valid address is left, and says the link went', async () => {
    const { harness, page } = await open('/ro/list-your-garage');

    type(harness, page, ' Ion@Service.test ');
    leave(harness, page);
    const create = await request();
    expect(create.request.method).toBe('POST');
    expect(create.request.url).toBe(API);
    expect(create.request.body).toEqual({
      data: {},
      email: 'ion@service.test',
      language: 'ro',
      step: 1,
    });
    await answered(harness, create, created());

    expect(note(page)).toBe(
      'Ți-am trimis un link pe e-mail ca să continui de pe orice dispozitiv',
    );
    expect(stored()).toMatchObject({
      dirty: false,
      draftId: 'd1',
      token: 't1',
    });

    leave(harness, page);
    await settle(harness);
    TestBed.inject(HttpTestingController).verify();
  });

  it('says when the link was already sent, with the minutes to wait', async () => {
    const { harness, page } = await open('/ro/list-your-garage');

    type(harness, page, 'ion@service.test');
    leave(harness, page);
    await answered(
      harness,
      await request(),
      created({ linkSent: false, retryAfterSeconds: 540 }),
    );

    expect(note(page)).toBe(
      'Linkul a fost deja trimis. Îl poți trimite din nou în 9 min.',
    );
  });

  it('is read again when the page opens with a key and no unsent changes', async () => {
    seed({ draftId: 'd1', email: 'old@service.test', step: 2, token: 't1' });

    const { harness, page } = await open('/ro/list-your-garage');
    const fetch = await request();
    expect(fetch.request.method).toBe('GET');
    expect(fetch.request.url).toBe(`${API}/current`);
    expect(fetch.request.headers.get('x-listing-token')).toBe('t1');
    await answered(harness, fetch, {
      data: {},
      email: 'ion@service.test',
      id: 'd1',
      language: 'ro',
      status: 'open',
      step: 5,
      updatedAt: '2026-10-07T11:00:00.000Z',
    });

    expect(field(page).value).toBe('ion@service.test');
    expect(current(page)).toEqual(['5 Fotografii și adresă']);
  });

  it('is sent at once when the page opens with changes the server never had', async () => {
    seed({
      dirty: true,
      draftId: 'd1',
      email: 'ion@service.test',
      step: 4,
      token: 't1',
    });

    const { harness } = await open('/ro/list-your-garage');
    const save = await request();

    expect(save.request.method).toBe('PATCH');
    expect(save.request.url).toBe(`${API}/d1`);
    expect(save.request.headers.get('x-listing-token')).toBe('t1');
    expect(save.request.body).toEqual({ data: {}, language: 'ro', step: 4 });
    await answered(harness, save, created({ linkSent: undefined, step: 4 }));
    expect(stored()?.dirty).toBe(false);
  });

  it('is saved when the owner leaves a step', async () => {
    const { harness, page } = await withServerCopy();

    entries(page)[1].click();
    await settle(harness);
    const save = await request();

    expect(save.request.method).toBe('PATCH');
    expect(save.request.body).toMatchObject({ step: 2 });
  });

  it('is saved at most every five seconds while the owner types', async () => {
    const { harness, page } = await withServerCopy();
    const http = TestBed.inject(HttpTestingController);
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      type(harness, page, 'ion@service.t');
      await jest.advanceTimersByTimeAsync(3_000);
      type(harness, page, 'ion@service.te');
      await jest.advanceTimersByTimeAsync(1_900);
      expect(http.match(() => true)).toEqual([]);

      await jest.advanceTimersByTimeAsync(200);
      const saves = http.match(() => true);
      expect(saves).toHaveLength(1);
      expect(saves[0].request.method).toBe('PATCH');
    } finally {
      jest.useRealTimers();
    }
  });

  it('sends one save at a time and the latest one after it', async () => {
    const { harness, page } = await withServerCopy();

    entries(page)[1].click();
    const first = await request();
    entries(page)[2].click();
    entries(page)[3].click();
    await settle(harness);
    expect(TestBed.inject(HttpTestingController).match(() => true)).toEqual([]);

    await answered(harness, first, created({ linkSent: undefined }));
    const next = await requests(2);
    expect(next).toHaveLength(1);
    expect(next[0].request.body).toMatchObject({ step: 4 });
  });

  it('saves at once on the button, sends the link again and says the draft is saved', async () => {
    const { harness, page } = await withServerCopy();

    saveButton(page).click();
    const save = await request();
    expect(save.request.method).toBe('PATCH');
    await answered(harness, save, created({ linkSent: undefined }));
    const link = await request();
    expect(link.request.method).toBe('POST');
    expect(link.request.url).toBe(`${API}/d1/continue-link`);
    expect(link.request.headers.get('x-listing-token')).toBe('t1');
    await answered(harness, link, { sentAt: '2026-10-07T12:00:00.000Z' });

    expect(note(page)).toBe('Ciorna e salvată');
  });

  it('says when the link sent from the button must wait', async () => {
    const { harness, page } = await withServerCopy();

    saveButton(page).click();
    await answered(harness, await request(), created({ linkSent: undefined }));
    await answered(
      harness,
      await request(),
      { code: 'link_already_sent', retryAfterSeconds: 1200, status: 429 },
      429,
    );

    expect(note(page)).toBe(
      'Linkul a fost deja trimis. Îl poți trimite din nou în 20 min.',
    );
  });

  it('keeps unsent changes while offline and sends the whole draft on reconnect', async () => {
    const { harness, page } = await withServerCopy();

    entries(page)[2].click();
    await answered(harness, await request(), null, 0);

    expect(note(page)).toBe('Neconectat · salvăm când revii online');
    expect(stored()).toMatchObject({ dirty: true, step: 3 });

    window.dispatchEvent(new Event('online'));
    const again = await request();
    expect(again.request.body).toEqual({ data: {}, language: 'ro', step: 3 });
    await answered(harness, again, created({ linkSent: undefined, step: 3 }));
    expect(stored()?.dirty).toBe(false);
    expect(note(page)).toBe('');
  });

  it('says when the draft is too large for the server', async () => {
    const { harness, page } = await withServerCopy();

    saveButton(page).click();
    await answered(
      harness,
      await request(),
      { code: 'draft_too_large', status: 413 },
      413,
    );

    expect(note(page)).toBe('Ciorna e prea mare ca să fie salvată pe server.');
    expect(stored()?.dirty).toBe(true);
  });

  it('says the draft was not saved when the server fails', async () => {
    const { harness, page } = await withServerCopy();

    saveButton(page).click();
    await answered(
      harness,
      await request(),
      { code: 'internal_error', status: 500 },
      500,
    );

    expect(note(page)).toBe(
      'Ciorna nu a putut fi salvată pe server. Încearcă din nou.',
    );
    expect(stored()?.dirty).toBe(true);
  });

  it('drops the not-saved note once a later save goes through', async () => {
    const { harness, page } = await withServerCopy();

    entries(page)[2].click();
    await answered(
      harness,
      await request(),
      { code: 'internal_error', status: 500 },
      500,
    );
    entries(page)[3].click();
    await answered(
      harness,
      await request(),
      created({ linkSent: undefined, step: 4 }),
    );

    expect(note(page)).toBe('');
  });

  it('sends a changed address and takes the new key it answers with', async () => {
    const { harness, page } = await withServerCopy();

    type(harness, page, 'maria@service.test');
    leave(harness, page);
    const save = await request();
    expect(save.request.body).toMatchObject({ email: 'maria@service.test' });
    await answered(
      harness,
      save,
      created({ email: 'maria@service.test', token: 't2' }),
    );

    expect(stored()?.token).toBe('t2');
    entries(page)[1].click();
    expect((await request()).request.headers.get('x-listing-token')).toBe('t2');
  });
});

describe('opening the link from the e-mail', () => {
  const server = {
    data: {},
    email: 'ion@service.test',
    id: 'd9',
    language: 'ro',
    status: 'open',
    step: 4,
    updatedAt: '2026-10-07T11:00:00.000Z',
  };

  it('reads the server copy with the link key, over unsent changes, at its step, and drops the key from the address', async () => {
    seed({
      dirty: true,
      draftId: 'd1',
      email: 'mine@service.test',
      token: 't1',
    });

    const { harness, page } = await open('/ro/list-your-garage?draft=link-key');
    expect(text(page.querySelector('[role="status"]'))).toBe(
      'Se încarcă ciorna…',
    );
    const fetch = await request();
    expect(fetch.request.url).toBe(`${API}/current`);
    expect(fetch.request.headers.get('x-listing-token')).toBe('link-key');
    await answered(harness, fetch, server);
    await settle(harness);

    expect(field(page).value).toBe('ion@service.test');
    expect(current(page)).toEqual(['4 Mecanici · opțional']);
    await new Promise((resolve) => setTimeout(resolve, 250));
    tops = [990, 1990, 2990, 3990, 4990, 5990];
    window.dispatchEvent(new Event('scroll'));
    await settle(harness);
    expect(current(page)).toEqual(['4 Mecanici · opțional']);
    expect(stored()).toMatchObject({
      dirty: false,
      draftId: 'd9',
      token: 'link-key',
    });
    expect(TestBed.inject(Router).url).toBe('/ro/list-your-garage');
  });

  it('says a dead link is no longer valid, and starts again from an empty form without the old key', async () => {
    seed({ draftId: 'd1', email: 'mine@service.test', step: 2, token: 't1' });

    const { harness, page } = await open('/ro/list-your-garage?draft=dead');
    await answered(
      harness,
      await request(),
      { code: 'not_found', status: 404 },
      404,
    );

    expect(text(page.querySelector('h1'))).toBe('Linkul nu mai e valid');
    expect(text(page.querySelector('h1 + p'))).toBe(
      'Linkul e greșit, vechi sau ciorna a fost ștearsă.',
    );
    const again = page.querySelector<HTMLButtonElement>('button[hlmBtn]');
    expect(text(again)).toBe('Începe din nou');
    again?.click();
    await settle(harness);

    expect(field(page).value).toBe('');
    expect(stored()).toMatchObject({ data: {}, step: 1 });
    expect(stored()).not.toHaveProperty('email');
    expect(stored()).not.toHaveProperty('token');
    expect(stored()).not.toHaveProperty('draftId');
  });

  it('says a sent listing was sent, and offers the sign-in dialog', async () => {
    const { harness, page } = await open('/en/list-your-garage?draft=k');
    await answered(harness, await request(), {
      ...server,
      status: 'submitted',
    });

    expect(text(page.querySelector('h1'))).toBe('The listing was sent');
    expect(text(page.querySelector('h1 + p'))).toBe(
      'Sign in to see your garage.',
    );
    const button = page.querySelector<HTMLButtonElement>('button[hlmBtn]');
    expect(text(button)).toBe('Sign in');
    button?.click();
    expect(signIn.start).toHaveBeenCalledTimes(1);
  });

  it.each([
    [404, 'not_found', 'Linkul nu mai e valid'],
    [409, 'draft_submitted', 'Înscrierea a fost trimisă'],
  ])(
    'shows the matching page when a save is answered %s',
    async (status, code, title) => {
      const { harness, page } = await withServerCopy();

      entries(page)[1].click();
      await answered(harness, await request(), { code, status }, status);

      expect(text(page.querySelector('h1'))).toBe(title);
    },
  );
});

const cuiInput = (page: HTMLElement) =>
  page.querySelector<HTMLInputElement>('#listing-cui') as HTMLInputElement;
const rarInput = (page: HTMLElement) =>
  page.querySelector<HTMLInputElement>('#listing-rar') as HTMLInputElement;
const step6 = (page: HTMLElement) =>
  page.querySelectorAll('section')[5] as HTMLElement;
const counter = (page: HTMLElement) =>
  text(step6(page).querySelector('.count'));
const errorOf = (page: HTMLElement, input: HTMLInputElement) =>
  text(page.querySelector(`#${input.id}-error`));

function fillIn(
  harness: RouterTestingHarness,
  input: HTMLInputElement,
  value: string,
) {
  input.value = value;
  input.dispatchEvent(new Event('input'));
  harness.detectChanges();
}

function leaveField(harness: RouterTestingHarness, input: HTMLInputElement) {
  input.dispatchEvent(new Event('blur'));
  harness.detectChanges();
}

describe('the verification step', () => {
  it.each([
    [
      '/ro/list-your-garage',
      'Publicăm doar service-uri care funcționează legal în România. Verificăm firma și autorizația RAR înainte ca profilul să apară pe hartă.',
      'CUI-ul firmei',
      'Numărul autorizației tehnice RAR',
      'de pe autorizația afișată în atelier',
      '0 din 5 completate',
      'Comparăm datele firmei cu registrele publice (ANAF, ONRC, RAR). Documentele le vede doar echipa MotorFix.',
    ],
    [
      '/en/list-your-garage',
      'We only publish garages that operate legally in Romania. We check the company and the RAR authorisation before the profile appears on the map.',
      'Company tax ID',
      'RAR technical authorisation number',
      'from the authorisation displayed in the workshop',
      '0 of 5 completed',
      'We compare the company details with the public registers (ANAF, ONRC, RAR). Only the MotorFix team sees the documents.',
    ],
  ])(
    '%s shows the intro, the two fields, the counter and the note, in that order',
    async (path, intro, cui, rar, hint, count, note) => {
      const { page } = await open(path);

      const section = step6(page);
      const texts = [...section.querySelectorAll('p:not(.error), label')].map(
        text,
      );
      expect(texts).toEqual([intro, cui, rar, hint, count, note]);
      expect(text(section.querySelector('label[for="listing-cui"]'))).toBe(cui);
      expect(text(section.querySelector('label[for="listing-rar"]'))).toBe(rar);
      expect(cuiInput(page).maxLength).toBe(40);
      expect(rarInput(page).maxLength).toBe(40);
      expect(rarInput(page).getAttribute('aria-describedby')).toBe(
        'listing-rar-hint',
      );
      expect(section.querySelector('.count')?.getAttribute('aria-live')).toBe(
        'polite',
      );
    },
  );

  it('offers no look-up: no button, no company name, no register result', async () => {
    const { page } = await open('/ro/list-your-garage');

    const section = step6(page);
    expect(section.querySelectorAll('button, a')).toHaveLength(0);
    expect(text(section)).not.toMatch(
      /Verifică firma|Caută în registrul RAR|CAEN/,
    );
    TestBed.inject(HttpTestingController).verify();
  });

  it('names a wrong tax ID only once the field is left, and clears it when the value is right', async () => {
    const { harness, page } = await open('/ro/list-your-garage');
    const input = cuiInput(page);

    fillIn(harness, input, 'RO 18547291');
    expect(errorOf(page, input)).toBe('');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    leaveField(harness, input);

    expect(errorOf(page, input)).toBe('CUI invalid');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('listing-cui-error');
    expect(
      page.querySelector('#listing-cui-error')?.closest('[aria-live="polite"]'),
    ).not.toBeNull();
    expect(counter(page)).toBe('0 din 5 completate');

    fillIn(harness, input, 'RO18547290');
    expect(errorOf(page, input)).toBe('');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(counter(page)).toBe('1 din 5 completate');
    leaveField(harness, input);
    expect(input.value).toBe('18547290');
  });

  it('shows what was typed until the field is left', async () => {
    const { harness, page } = await open('/ro/list-your-garage');
    const input = cuiInput(page);

    fillIn(harness, input, 'ro 18 547 290');
    expect(input.value).toBe('ro 18 547 290');
    expect(counter(page)).toBe('1 din 5 completate');
    leaveField(harness, input);
    expect(input.value).toBe('18547290');
  });

  it('counts a RAR number of 3 characters, asks for more under 3, and shows it in capitals once left', async () => {
    const { harness, page } = await open('/ro/list-your-garage');
    const input = rarInput(page);

    fillIn(harness, input, ' ab ');
    leaveField(harness, input);
    expect(input.value).toBe('AB');
    expect(errorOf(page, input)).toBe('Cel puțin 3 caractere');
    expect(input.getAttribute('aria-describedby')).toBe('listing-rar-error');
    expect(counter(page)).toBe('0 din 5 completate');

    fillIn(harness, input, 'abc');
    expect(errorOf(page, input)).toBe('');
    expect(counter(page)).toBe('1 din 5 completate');
    fillIn(harness, cuiInput(page), '18547290');
    expect(counter(page)).toBe('2 din 5 completate');
  });

  it('keeps both values in the browser copy, stripped and in capitals, and drops an emptied one', async () => {
    const { harness, page } = await open('/ro/list-your-garage');
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      fillIn(harness, cuiInput(page), 'RO 18547290');
      fillIn(harness, rarInput(page), ' ab123 ');
      await jest.advanceTimersByTimeAsync(1_100);
      expect(stored()?.data).toEqual({
        steps: { '6': { cui: '18547290', rarNumber: 'AB123' } },
      });

      fillIn(harness, rarInput(page), '');
      await jest.advanceTimersByTimeAsync(1_100);
      expect(stored()?.data).toEqual({ steps: { '6': { cui: '18547290' } } });
    } finally {
      jest.useRealTimers();
    }
  });

  it('sends both values to the server copy with the rest of the draft', async () => {
    const { harness, page } = await withServerCopy();
    const http = TestBed.inject(HttpTestingController);
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      fillIn(harness, cuiInput(page), '18547290');
      fillIn(harness, rarInput(page), 'ab123');
      await jest.advanceTimersByTimeAsync(5_100);
      const saves = http.match(() => true);
      expect(saves).toHaveLength(1);
      expect(saves[0].request.body).toMatchObject({
        data: { steps: { '6': { cui: '18547290', rarNumber: 'AB123' } } },
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('opens a kept copy with its values, the stored form and the counter', async () => {
    seed({ data: { steps: { '6': { cui: '18547290', rarNumber: 'AB123' } } } });

    const { page } = await open('/ro/list-your-garage');

    expect(cuiInput(page).value).toBe('18547290');
    expect(rarInput(page).value).toBe('AB123');
    expect(counter(page)).toBe('2 din 5 completate');
  });

  it('names a kept tax ID that fails at once', async () => {
    seed({ data: { steps: { '6': { cui: '18547291' } } } });

    const { page } = await open('/ro/list-your-garage');

    expect(errorOf(page, cuiInput(page))).toBe('CUI invalid');
    expect(counter(page)).toBe('0 din 5 completate');
  });

  it('shows the values of the server copy opened from the link', async () => {
    const { harness, page } = await open('/ro/list-your-garage?draft=link-key');
    await answered(harness, await request(), {
      data: { steps: { '6': { cui: '18547290', rarNumber: 'AB123' } } },
      email: 'ion@service.test',
      id: 'd9',
      language: 'ro',
      status: 'open',
      step: 6,
      updatedAt: '2026-10-07T11:00:00.000Z',
    });
    await settle(harness);

    expect(cuiInput(page).value).toBe('18547290');
    expect(rarInput(page).value).toBe('AB123');
    expect(counter(page)).toBe('2 din 5 completate');
  });

  it('opens a server copy without the section with empty fields', async () => {
    const { page } = await withServerCopy();

    expect(cuiInput(page).value).toBe('');
    expect(rarInput(page).value).toBe('');
    expect(counter(page)).toBe('0 din 5 completate');
  });

  it('changes every text with the language and keeps the values and the count', async () => {
    const { harness, i18n, page } = await open('/ro/list-your-garage');
    fillIn(harness, cuiInput(page), 'RO 18547291');
    leaveField(harness, cuiInput(page));
    fillIn(harness, rarInput(page), 'abc');

    await i18n.use('en');
    await settle(harness);

    expect(errorOf(page, cuiInput(page))).toBe('Invalid tax ID');
    expect(counter(page)).toBe('1 of 5 completed');
    expect(cuiInput(page).value).toBe('18547291');
    expect(rarInput(page).value).toBe('abc');
    expect(text(step6(page))).toContain('We only publish garages');
  });
});

// @traces 040-FR-006
describe('the brands step in the draft', () => {
  const daciaChip = (page: HTMLElement) =>
    [...page.querySelectorAll<HTMLButtonElement>('.chips button')].find((c) =>
      text(c).startsWith('Dacia'),
    ) as HTMLButtonElement;

  it("keeps the marked brands and the texts as the draft's step 2 in the browser copy", async () => {
    const { harness, page } = await open('/ro/list-your-garage');
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      daciaChip(page).click();
      harness.detectChanges();
      await jest.advanceTimersByTimeAsync(1_100);

      expect(stored()?.data).toEqual({
        steps: {
          '2': {
            brands: [
              {
                brandId: '7c1e4f2a-3b5d-4e6f-8a9b-0c1d2e3f4a5b',
                name: 'Dacia',
                stance: 'works_on',
              },
            ],
          },
        },
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('restores the marked brands from a kept copy', async () => {
    seed({
      data: {
        steps: {
          '2': {
            brandNote: 'Doar diesel',
            brands: [
              {
                brandId: '7c1e4f2a-3b5d-4e6f-8a9b-0c1d2e3f4a5b',
                name: 'Dacia',
                stance: 'does_not_take',
              },
            ],
          },
        },
      },
    });

    const { page } = await open('/ro/list-your-garage');

    expect(daciaChip(page).getAttribute('aria-pressed')).toBe('true');
    expect(text(daciaChip(page))).toContain('nu o primești');
    expect(
      page.querySelector<HTMLInputElement>('input[name="brandNote"]')?.value,
    ).toBe('Doar diesel');
  });

  it('opens with no marked brand when the kept step 2 is not in its shape', async () => {
    seed({ data: { steps: { '2': { brands: 'Dacia' } } } });

    const { page } = await open('/ro/list-your-garage');

    expect(daciaChip(page).getAttribute('aria-pressed')).toBe('false');
  });

  it('sends the marked brands with the whole draft to the server copy', async () => {
    const { harness, page } = await withServerCopy();

    daciaChip(page).click();
    harness.detectChanges();
    saveButton(page).click();
    harness.detectChanges();
    const save = await request();

    expect(save.request.method).toBe('PATCH');
    expect(save.request.body).toMatchObject({
      data: {
        steps: {
          '2': {
            brands: [
              {
                brandId: '7c1e4f2a-3b5d-4e6f-8a9b-0c1d2e3f4a5b',
                name: 'Dacia',
                stance: 'works_on',
              },
            ],
          },
        },
      },
    });
  });
});

// @traces 109-FR-003 109-FR-010 109-FR-012
describe('the details, prices and mechanics in the draft', () => {
  const COMPLETE_DETAILS = {
    businessKind: 'company',
    knownFor: 'Frâne',
    name: 'Service Popescu',
    phone: '0722 123 456',
  };
  const detailsField = (page: HTMLElement, name: string) =>
    page.querySelector<HTMLInputElement>(
      `mf-details-step [name="${name}"]`,
    ) as HTMLInputElement;

  it("keeps what step 1 holds as the draft's steps['1'] in the browser copy", async () => {
    const { harness, page } = await open('/ro/list-your-garage');
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      fillIn(harness, detailsField(page, 'name'), 'Service Popescu');
      await jest.advanceTimersByTimeAsync(1_100);

      expect(stored()?.data).toEqual({
        steps: { '1': { name: 'Service Popescu' } },
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('restores step 1 from a kept copy and ticks it while it is complete', async () => {
    seed({ data: { steps: { '1': COMPLETE_DETAILS } } });

    const { harness, page } = await open('/ro/list-your-garage');

    expect(detailsField(page, 'name').value).toBe('Service Popescu');
    expect(ticked(page)).toEqual([1, 4]);

    fillIn(harness, detailsField(page, 'knownFor'), '');
    expect(ticked(page)).toEqual([4]);
  });

  const STEFAN = {
    address: 'Strada Ștefan cel Mare 12, Sector 2, București',
    lat: 44.4512,
    lng: 26.1207,
  };

  it('ticks step 5 once the kept place has an address and a position in Romania', async () => {
    seed({ data: { steps: { '5': { payments: ['cash'], place: STEFAN } } } });

    const { page } = await open('/ro/list-your-garage');

    expect(ticked(page)).toEqual([4, 5]);
    expect(
      page.querySelector<HTMLInputElement>('mf-place-step [name="address"]')
        ?.value,
    ).toBe(STEFAN.address);
  });

  it.each([
    ['no position', { address: STEFAN.address }],
    ['no address', { lat: STEFAN.lat, lng: STEFAN.lng }],
    ['a position outside Romania', { ...STEFAN, lat: 48.2, lng: 16.37 }],
  ])('leaves step 5 unticked for a place with %s', async (_, place) => {
    seed({ data: { steps: { '5': { place } } } });

    const { page } = await open('/ro/list-your-garage');

    expect(ticked(page)).toEqual([4]);
  });

  it('leaves step 5 unticked while no payment method is ticked', async () => {
    seed({ data: { steps: { '5': { place: STEFAN } } } });

    const { page } = await open('/ro/list-your-garage');

    expect(ticked(page)).toEqual([4]);
  });

  it('leaves step 5 unticked for a paid courtesy car with no price', async () => {
    seed({
      data: {
        steps: {
          '5': {
            courtesyCar: { paid: true },
            facilities: ['courtesy_car'],
            payments: ['card'],
            place: STEFAN,
          },
        },
      },
    });

    const { page } = await open('/ro/list-your-garage');

    expect(ticked(page)).toEqual([4]);
  });

  it('ticks step 5 once a payment method is ticked on the page', async () => {
    seed({ data: { steps: { '5': { place: STEFAN } } } });
    const { harness, page } = await open('/ro/list-your-garage');

    const cash = [
      ...page.querySelectorAll<HTMLButtonElement>(
        'mf-hours-step .payments button',
      ),
    ].find((c) => text(c).startsWith('Numerar'));
    if (!cash) throw new Error('no payment chip Numerar');
    cash.click();
    await settle(harness);

    expect(ticked(page)).toEqual([4, 5]);
  });

  it('opens a draft kept before payments and fuels existed without losing a value', async () => {
    seed({
      data: {
        steps: {
          '2': {
            brands: [{ brandId: DACIA.id, name: 'Dacia', stance: 'works_on' }],
          },
          '5': { facilities: ['courtesy_car'], place: STEFAN },
        },
      },
    });

    const { page } = await open('/ro/list-your-garage');

    const fuels = [
      ...page.querySelectorAll<HTMLButtonElement>(
        'mf-brands-step .fuels button',
      ),
    ];
    expect(fuels.map((f) => f.getAttribute('aria-pressed'))).toEqual([
      'true',
      'true',
      'true',
      'true',
    ]);
    const payments = [
      ...page.querySelectorAll<HTMLButtonElement>(
        'mf-hours-step .payments button',
      ),
    ];
    expect(payments).toHaveLength(3);
    for (const p of payments)
      expect(p.getAttribute('aria-pressed')).toBe('false');
    const free = [...page.querySelectorAll('mf-hours-step label')]
      .find((l) => text(l) === 'Gratuită')
      ?.querySelector<HTMLInputElement>('input[type="radio"]');
    expect(free?.checked).toBe(true);
    expect(
      page.querySelector<HTMLInputElement>('mf-place-step [name="address"]')
        ?.value,
    ).toBe(STEFAN.address);
  });

  it("ticks step 5 for a mobile mechanic's seat with no radius, as 20 stands in", async () => {
    seed({
      data: {
        steps: {
          '1': {
            ...COMPLETE_DETAILS,
            businessKind: 'mobile',
            mobileLegalForm: 'pfa',
          },
          '5': { payments: ['cash'], place: STEFAN },
        },
      },
    });

    const { page } = await open('/ro/list-your-garage');

    expect(ticked(page)).toEqual([1, 4, 5]);
    expect(
      page.querySelector<HTMLInputElement>('mf-place-step [name="radiusKm"]')
        ?.value,
    ).toBe('20');
  });

  it("keeps the place as steps['5'].place beside the hours", async () => {
    seed({
      data: { steps: { '5': { facilities: ['waiting_area'], place: STEFAN } } },
    });
    const { harness } = await open('/ro/list-your-garage');
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      mapEvents?.dragged({ lat: 44.452, lng: 26.121 });
      harness.detectChanges();
      await jest.advanceTimersByTimeAsync(1_100);

      expect(stored()?.data).toMatchObject({
        steps: {
          '5': {
            facilities: ['waiting_area'],
            place: { address: STEFAN.address, lat: 44.452, lng: 26.121 },
          },
        },
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('opens an empty step 1 when the kept one is not in its shape', async () => {
    seed({ data: { steps: { '1': { name: 42 } } } });

    const { page } = await open('/ro/list-your-garage');

    expect(detailsField(page, 'name').value).toBe('');
  });

  it('ticks step 3 for a complete kept price list, and step 4 not for a one-letter mechanic', async () => {
    seed({
      data: {
        steps: {
          '3': {
            jobs: [{ fromBani: 15_000, jobTypeId: jobId(3), toBani: 40_000 }],
            labour: { fromBani: 10_000, toBani: 20_000 },
          },
          '4': { mechanics: [{ name: 'I' }] },
        },
      },
    });

    const { page } = await open('/ro/list-your-garage');

    expect(ticked(page)).toEqual([3]);
    expect(
      [...page.querySelectorAll('mf-prices-step li.job .name')].map(text),
    ).toEqual(['Frâne']);
  });

  const LADA = jobId(900);

  it("drops a brand's price range once step 2 no longer takes the brand", async () => {
    seed({
      data: {
        steps: {
          '2': {
            brands: [{ brandId: LADA, name: 'Lada', stance: 'works_on' }],
          },
          '3': {
            jobs: [
              { jobTypeId: jobId(3) },
              { brandId: LADA, jobTypeId: jobId(3) },
            ],
          },
        },
      },
    });
    const { harness, page } = await open('/ro/list-your-garage');
    expect(page.querySelectorAll('mf-prices-step li.brand')).toHaveLength(1);
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      const lada = [
        ...page.querySelectorAll<HTMLButtonElement>('.chips button'),
      ].find((c) => text(c).startsWith('Lada')) as HTMLButtonElement;
      lada.click();
      harness.detectChanges();
      await jest.advanceTimersByTimeAsync(1_100);

      expect(stored()?.data).toMatchObject({
        steps: { '3': { jobs: [{ jobTypeId: jobId(3) }] } },
      });
      expect(page.querySelectorAll('mf-prices-step li.brand')).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps the mechanics as the draft's steps['4']", async () => {
    const { harness, page } = await open('/ro/list-your-garage');
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      page
        .querySelector<HTMLButtonElement>('mf-mechanics-step button.add')
        ?.click();
      harness.detectChanges();
      fillIn(
        harness,
        page.querySelector(
          'mf-mechanics-step input[name="name"]',
        ) as HTMLInputElement,
        'Ion Marin',
      );
      await jest.advanceTimersByTimeAsync(1_100);

      expect(stored()?.data).toEqual({
        steps: { '4': { mechanics: [{ name: 'Ion Marin' }] } },
      });
      expect(ticked(page)).toEqual([4]);
    } finally {
      jest.useRealTimers();
    }
  });
});
