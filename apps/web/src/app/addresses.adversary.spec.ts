import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { I18n } from '@motor-fix/i18n';

import {
  alternates,
  PUBLIC_PATHS,
  provideLanguageAddresses,
  SITE_ORIGIN,
} from './addresses';
import { routes } from './app.routes';

const ORIGIN = 'https://motorfix.ro';

function setUp(extra: object[] = []) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      provideLanguageAddresses(),
      { provide: SITE_ORIGIN, useValue: ORIGIN },
      ...extra,
    ],
  });
}

async function settle(harness: RouterTestingHarness) {
  for (let i = 0; i < 3; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
    await harness.fixture.whenStable();
  }
}

async function open(url: string) {
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await settle(harness);
  return harness;
}

const url = () => TestBed.inject(Router).url;
const lang = () => document.documentElement.lang;
const text = (harness: RouterTestingHarness) =>
  harness.routeNativeElement?.textContent ?? '';
const href = (selector: string) =>
  document.head.querySelector(selector)?.getAttribute('href');
const robots = () =>
  [...document.head.querySelectorAll('meta[name="robots"]')].map((m) =>
    m.getAttribute('content'),
  );

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = 'ro';
  window.matchMedia = ((query: string) => ({
    addEventListener: () => undefined,
    addListener: () => undefined,
    matches: false,
    media: query,
    removeEventListener: () => undefined,
    removeListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  document.head
    .querySelectorAll('link[rel="canonical"], link[hreflang], meta[name]')
    .forEach((element) => {
      element.remove();
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('language addresses under hostile input', () => {
  beforeEach(() => setUp());

  it('opens /ro/ with the trailing slash in Romanian', async () => {
    const harness = await open('/ro/');

    expect(lang()).toBe('ro');
    expect(text(harness)).toContain('versiune necunoscută');
    expect(href('link[rel="canonical"]')).toBe(`${ORIGIN}/ro/`);
  });

  it('opens /en/ with the trailing slash in English', async () => {
    const harness = await open('/en/');

    expect(lang()).toBe('en');
    expect(text(harness)).toContain('version unknown');
  });

  it('treats an upper-case prefix as an unknown address', async () => {
    const harness = await open('/EN');

    expect(lang()).toBe('ro');
    expect(text(harness)).toContain('Pagina nu există');
    expect(robots()).toEqual(['noindex']);
  });

  it('treats a locale-tagged prefix as an unknown address', async () => {
    const harness = await open('/en-GB/');

    expect(lang()).toBe('ro');
    expect(text(harness)).toContain('Pagina nu există');
  });

  it('shows English not-found for a deep unknown path under /en', async () => {
    const harness = await open('/en/a/b/c');

    expect(lang()).toBe('en');
    expect(text(harness)).toContain('Page not found');
    expect(robots()).toEqual(['noindex']);
    expect(href('link[rel="canonical"]')).toBeUndefined();
    expect(document.head.querySelectorAll('link[hreflang]')).toHaveLength(0);
  });

  it('links the not-found page back to Home', async () => {
    const harness = await open('/en/no-such-page');

    const links = [
      ...(harness.routeNativeElement?.querySelectorAll('a') ?? []),
    ].map((a) => a.getAttribute('href'));
    expect(links.some((h) => h === '/' || /^\/(en|ro)\/?$/.test(h ?? ''))).toBe(
      true,
    );
  });

  it('ignores a remembered value that is not a language on /en', async () => {
    localStorage.setItem('mf.lang', 'xx');

    await open('/en');

    expect(lang()).toBe('en');
    expect(localStorage.getItem('mf.lang')).toBe('en');
  });

  it('sends / to Romanian when the remembered value is not a language', async () => {
    localStorage.setItem('mf.lang', 'de');

    await open('/');

    expect(url()).toBe('/ro');
    expect(lang()).toBe('ro');
  });

  it('keeps the query string of / on its way to Romanian', async () => {
    await open('/?utm=a&utm=b');

    expect(url()).toBe('/ro?utm=a&utm=b');
  });

  it('still renders the address language when storage cannot be written', async () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    const harness = await open('/en');

    expect(lang()).toBe('en');
    expect(text(harness)).toContain('version unknown');
    expect(localStorage.getItem('mf.lang')).toBeNull();
  });

  it('moves / to Romanian when storage cannot be read', async () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    await open('/');

    expect(url()).toBe('/ro');
  });

  it('keeps query and fragment of a not-found address through a switch', async () => {
    const harness = await open('/ro/gone/page?x=1&y=2#frag');

    await TestBed.inject(I18n).use('en');
    await settle(harness);

    expect(url()).toBe('/en/gone/page?x=1&y=2#frag');
    expect(text(harness)).toContain('Page not found');
  });

  it('follows two switches back to the first address', async () => {
    const harness = await open('/ro?a=1');
    const i18n = TestBed.inject(I18n);

    await i18n.use('en');
    await settle(harness);
    await i18n.use('ro');
    await settle(harness);

    expect(url()).toBe('/ro?a=1');
    expect(lang()).toBe('ro');
  });

  it('does not add a history entry on a switch', async () => {
    const harness = await open('/ro');
    const before = history.length;

    await TestBed.inject(I18n).use('en');
    await settle(harness);

    expect(history.length).toBe(before);
  });

  it('marks the cockpit sample noindex with no canonical or alternates', async () => {
    await open('/cockpit');

    expect(robots()).toEqual(['noindex']);
    expect(href('link[rel="canonical"]')).toBeUndefined();
    expect(document.head.querySelectorAll('link[hreflang]')).toHaveLength(0);
  });

  it('does not move the cockpit address when the language changes', async () => {
    const harness = await open('/cockpit');

    await TestBed.inject(I18n).use('en');
    await settle(harness);

    expect(url()).toBe('/cockpit');
  });

  it('does not put the query string into the canonical link', async () => {
    await open('/en?utm=x#top');

    expect(href('link[rel="canonical"]')).toBe(`${ORIGIN}/en/`);
  });

  it('keeps exactly one canonical and one link per language after switching', async () => {
    const harness = await open('/ro');

    await TestBed.inject(I18n).use('en');
    await settle(harness);

    expect(
      document.head.querySelectorAll('link[rel="canonical"]'),
    ).toHaveLength(1);
    expect(href('link[rel="canonical"]')).toBe(`${ORIGIN}/en/`);
    expect(document.head.querySelectorAll('link[hreflang]')).toHaveLength(3);
  });

  it('never leaves a robots tag on a public page after leaving not-found', async () => {
    const harness = await open('/en/nope');
    await harness.navigateByUrl('/en');
    await settle(harness);

    expect(robots()).toEqual([]);
    expect(href('link[rel="canonical"]')).toBe(`${ORIGIN}/en/`);
  });
});

describe('language addresses on the server', () => {
  beforeEach(() => setUp([{ provide: PLATFORM_ID, useValue: 'server' }]));

  it('renders /en in English with the English canonical', async () => {
    const harness = await open('/en');

    expect(lang()).toBe('en');
    expect(text(harness)).toContain('version unknown');
    expect(href('link[rel="canonical"]')).toBe(`${ORIGIN}/en/`);
  });

  it('renders an unknown prefix in Romanian', async () => {
    const harness = await open('/de/');

    expect(lang()).toBe('ro');
    expect(text(harness)).toContain('Pagina nu există');
  });

  it('renders the cockpit sample in Romanian', async () => {
    await open('/cockpit');

    expect(lang()).toBe('ro');
    expect(robots()).toEqual(['noindex']);
  });
});

describe('alternates edge cases', () => {
  it('builds the language roots with a trailing slash for the empty path', () => {
    expect(alternates(ORIGIN, '')).toEqual({
      en: `${ORIGIN}/en/`,
      ro: `${ORIGIN}/ro/`,
      'x-default': `${ORIGIN}/ro/`,
    });
  });

  it('has the same keys in the same shape for every public path', () => {
    for (const path of PUBLIC_PATHS) {
      const result = alternates(ORIGIN, path);
      expect(Object.keys(result).sort()).toEqual(['en', 'ro', 'x-default']);
      expect(result['x-default']).toBe(result['ro']);
    }
  });

  it('lists only paths that carry no language prefix and no leading slash', () => {
    for (const path of PUBLIC_PATHS) {
      expect(path).not.toMatch(/^\/|^(ro|en)(\/|$)/);
    }
  });
});
