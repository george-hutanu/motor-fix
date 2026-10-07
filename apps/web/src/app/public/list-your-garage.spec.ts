import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { I18n } from '@motor-fix/i18n';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';

import { ListYourGarage } from './list-your-garage';

// jsdom lays nothing out: each heading is placed by hand, the page is tall
// enough not to sit at its end, and scrolling is recorded, not done.
let tops = [1000, 2000, 3000, 4000, 5000, 6000];
const scrolls: ScrollIntoViewOptions[] = [];

beforeEach(() => {
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
  }
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/‑/g, '-').replace(/\s+/g, ' ').trim();
const entries = (page: HTMLElement) => [
  ...page.querySelectorAll<HTMLButtonElement>('nav ol button'),
];
const current = (page: HTMLElement) =>
  [...page.querySelectorAll('[aria-current="step"]')].map(text);
const bar = (page: HTMLElement) =>
  page.querySelector<HTMLButtonElement>('nav > button[aria-expanded]');

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

  it('leaves every section empty but for its heading', async () => {
    const { page } = await open('/ro/list-your-garage');

    for (const section of page.querySelectorAll('section'))
      expect([...section.children].map((c) => c.tagName)).toEqual(['H2']);
  });

  it('shows no completion tick and makes no request', async () => {
    const { page } = await open('/ro/list-your-garage');

    expect(page.textContent).not.toMatch(/[✓✔]/);
    expect(
      page.querySelector('[aria-checked], input[type="checkbox"]'),
    ).toBeNull();
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

    await new Promise((resolve) => setTimeout(resolve, 250));
    window.dispatchEvent(new Event('scroll'));
    await settle(harness);
    expect(current(page)).toEqual(['3 Prețuri']);
  });

  it('jumps without a smooth scroll when the device asks for reduced motion', async () => {
    const { harness, page } = await open('/ro/list-your-garage', true);

    entries(page)[1].click();
    await settle(harness);

    expect(scrolls).toEqual([{ behavior: 'auto', block: 'start' }]);
  });

  it('activates an entry from the keyboard', async () => {
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
