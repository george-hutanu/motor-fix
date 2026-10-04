import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { MeDto } from '@motor-fix/data-access';
import { LanguageChoice } from '@motor-fix/i18n';

import { provideLanguageAddresses, SITE_ORIGIN } from '../addresses';
import { routes } from '../app.routes';
import { Session } from '../dashboard/session';

// The bar only cares that /cockpit is outside the public frame. The real
// sample page renders the whole kit, which takes longer than a test's 5 s on
// a loaded CI runner.
jest.mock('@motor-fix/ui-cockpit/sample', () => {
  const { Component } = jest.requireActual('@angular/core');
  return { CockpitSamplePage: Component({ selector: 'mf-cockpit-sample', template: '' })(class {}) };
});

const ORIGIN = 'https://motorfix.ro';
const GARAGES = 'Service‑uri';

const DRIVER = {
  capabilities: [],
  email: null,
  garageId: null,
  id: 'account-1',
  landing: '/app/driver',
  language: 'ro',
  name: 'Ioana Pop',
  role: 'driver',
  roles: ['driver'],
} as unknown as MeDto;

let answers: Array<MeDto | null>;
let load: jest.Mock;
let harness: RouterTestingHarness | undefined;

function setUp(...replies: Array<MeDto | null>) {
  answers = replies;
  const current = signal<MeDto | null>(null);
  load = jest.fn(async () => {
    const next = answers.length > 1 ? answers.shift() : answers[0];
    current.set(next ?? null);
    return next ?? null;
  });
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      provideLanguageAddresses(),
      { provide: SITE_ORIGIN, useValue: ORIGIN },
      { provide: Session, useValue: { current, load } },
    ],
  });
}

async function settle() {
  for (let i = 0; i < 4; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
    await harness?.fixture.whenStable();
  }
}

async function open(url: string) {
  harness ??= await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await settle();
}

async function restart(...replies: Array<MeDto | null>) {
  TestBed.resetTestingModule();
  harness = undefined;
  setUp(...replies);
}

const url = () => TestBed.inject(Router).url;
const page = () => harness?.fixture.nativeElement as HTMLElement;
const bars = () => page().querySelectorAll('mf-public-tab-bar');
const bar = () => page().querySelector<HTMLElement>('mf-public-tab-bar');
const tabs = () => [...(bar()?.querySelectorAll('a') ?? [])];
const labels = () => tabs().map((a) => a.textContent?.trim());
const current = () =>
  tabs()
    .filter((a) => a.getAttribute('aria-current') === 'page')
    .map((a) => a.textContent?.trim());
const href = (label: string) =>
  tabs()
    .find((a) => a.textContent?.trim() === label)
    ?.getAttribute('href');
const head = (selector: string) =>
  document.head.querySelector(selector)?.getAttribute('href');
const heading = () => page().querySelector('h1')?.textContent?.trim() ?? '';
const line = () => page().querySelector('p')?.textContent?.trim() ?? '';

async function focusField(make: () => HTMLElement) {
  const field = make();
  document.body.append(field);
  field.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  await settle();
  const hidden = bar()?.hidden;
  field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  field.remove();
  await settle();
  return hidden;
}

const input = (type: string) => () => {
  const field = document.createElement('input');
  field.type = type;
  return field;
};

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
  harness = undefined;
  setUp(null);
});

describe('which tab is current', () => {
  it.each([
    ['/ro', 'Caută'],
    ['/ro/', 'Caută'],
    ['/ro/garages', GARAGES],
    ['/ro/garages/', GARAGES],
    ['/ro/garages?brand=bmw', GARAGES],
    ['/ro/garages/atelier-pop', GARAGES],
    ['/ro/garages/atelier-pop?brand=bmw', GARAGES],
    ['/ro/mechanics/ion', GARAGES],
    ['/ro/account', 'Cont'],
    ['/en', 'Search'],
    ['/en/garages', 'Garages'],
    ['/en/mechanics/ion', 'Garages'],
    ['/en/account', 'Account'],
  ])('marks exactly one tab current at %s', async (address, expected) => {
    await open(address);

    expect(current()).toEqual([expected]);
    expect(tabs().filter((a) => a.hasAttribute('aria-current'))).toHaveLength(
      1,
    );
  });

  it('keeps the garage tab current for a slug with percent-encoded unicode', async () => {
    await open('/ro/garages/%C8%99tefan-auto');

    expect(bars()).toHaveLength(1);
    expect(current()).toEqual([GARAGES]);
  });

  it('moves the current tab when the visitor goes from one screen to another', async () => {
    await open('/ro');
    await open('/ro/garages/x');
    await open('/ro/account');
    await open('/ro');

    expect(current()).toEqual(['Caută']);
  });
});

describe('where the bar is absent', () => {
  it.each([
    '/ro/nope',
    '/en/garages/a/b',
    '/ro/mechanics',
    '/ro/mechanics/a/b',
    '/RO/garages',
    '/en/account/extra',
    '/cockpit',
    '/de',
  ])('does not render on %s', async (address) => {
    await open(address);

    expect(bars()).toHaveLength(0);
  });

  it('does not render on a dashboard', async () => {
    await restart(DRIVER);
    await open('/ro');
    await open('/app/driver');

    expect(bars()).toHaveLength(0);
  });

  it('renders exactly one bar on every public screen', async () => {
    for (const address of [
      '/ro',
      '/en',
      '/ro/garages',
      '/en/garages/a',
      '/ro/mechanics/b',
      '/en/account',
    ]) {
      await open(address);
      expect(bars()).toHaveLength(1);
    }
  });
});

describe('the bar for assistive technology', () => {
  it('is one navigation landmark named in Romanian with three labelled links in order', async () => {
    await open('/ro');

    const navs = bar()?.querySelectorAll('nav') ?? [];
    expect(navs).toHaveLength(1);
    expect(navs[0]?.getAttribute('aria-label')).toBe('Navigare principală');
    expect(labels()).toEqual(['Caută', GARAGES, 'Cont']);
  });

  it('is named Main navigation in English', async () => {
    await open('/en');

    expect(bar()?.querySelector('nav')?.getAttribute('aria-label')).toBe(
      'Main navigation',
    );
    expect(labels()).toEqual(['Search', 'Garages', 'Account']);
  });

  it('hides every icon from assistive technology and never leaves an icon alone', async () => {
    await open('/ro');

    const icons = [...(bar()?.querySelectorAll('svg') ?? [])];
    expect(icons).toHaveLength(3);
    for (const icon of icons) {
      expect(icon.getAttribute('aria-hidden')).toBe('true');
    }
    for (const tab of tabs()) {
      expect(tab.textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  it('uses real links with an address so each tab can take keyboard focus', async () => {
    await open('/ro');

    expect(tabs()).toHaveLength(3);
    for (const tab of tabs()) {
      expect(tab.getAttribute('href')).toMatch(/^\/ro/);
      expect(tab.getAttribute('tabindex')).not.toBe('-1');
    }
  });

  it('gives the inactive tabs no aria-current at all, not even false', async () => {
    await open('/ro/garages');

    const inactive = tabs().filter((a) => a.textContent?.trim() !== GARAGES);
    expect(inactive).toHaveLength(2);
    for (const tab of inactive) {
      expect(tab.hasAttribute('aria-current')).toBe(false);
    }
  });
});

describe('the Service-uri destination', () => {
  it('opens the results without a brand before any brand was opened', async () => {
    await open('/ro');

    expect(href(GARAGES)).toBe('/ro/garages');
  });

  it('keeps the remembered brand when a later results address has an empty brand', async () => {
    await open('/ro/garages?brand=bmw');
    await open('/ro/garages?brand=');

    expect(href(GARAGES)).toBe('/ro/garages?brand=bmw');
  });

  it('keeps the remembered brand when a later results address has no brand', async () => {
    await open('/ro/garages?brand=bmw');
    await open('/ro/garages');
    await open('/ro');

    expect(href(GARAGES)).toBe('/ro/garages?brand=bmw');
  });

  it('replaces the remembered brand with the newest non-empty one', async () => {
    await open('/ro/garages?brand=bmw');
    await open('/ro/garages?brand=audi');
    await open('/ro');

    expect(href(GARAGES)).toBe('/ro/garages?brand=audi');
  });

  it('records the brand only from the results address', async () => {
    await open('/ro?brand=bmw');
    await open('/ro/garages/atelier?brand=audi');
    await open('/ro/mechanics/ion?brand=opel');
    await open('/ro/account?brand=fiat');
    await open('/ro');

    expect(href(GARAGES)).toBe('/ro/garages');
  });

  it('carries a brand with spaces, ampersands and unicode through the address intact', async () => {
    await open('/ro/garages?brand=Citro%C3%ABn%20%26%20Co');
    await open('/ro');

    const target = new URL(href(GARAGES) ?? '', ORIGIN);
    expect(target.searchParams.get('brand')).toBe('Citroën & Co');
    expect(target.pathname).toBe('/ro/garages');
  });

  it('cannot be made to inject a second parameter through the brand', async () => {
    await open('/ro/garages?brand=a%26lang%3Den%23x');
    await open('/ro');

    const target = new URL(href(GARAGES) ?? '', ORIGIN);
    expect(target.searchParams.get('brand')).toBe('a&lang=en#x');
    expect([...target.searchParams.keys()]).toEqual(['brand']);
    expect(target.hash).toBe('');
  });

  it('follows the remembered brand into the other language', async () => {
    await open('/ro/garages?brand=bmw');
    await TestBed.inject(LanguageChoice).choose('en');
    await settle();

    expect(url()).toBe('/en/garages?brand=bmw');
    expect(labels()).toEqual(['Search', 'Garages', 'Account']);
    expect(href('Garages')).toBe('/en/garages?brand=bmw');
    expect(href('Search')).toBe('/en');
    expect(href('Account')).toBe('/en/account');
  });

  it('shares the remembered brand between the language prefixes', async () => {
    await open('/en/garages?brand=bmw');
    await open('/ro');

    expect(href(GARAGES)).toBe('/ro/garages?brand=bmw');
  });

  it('forgets the brand when the page reloads', async () => {
    await open('/ro/garages?brand=bmw');
    await restart(null);
    await open('/ro');

    expect(href(GARAGES)).toBe('/ro/garages');
  });
});

describe('language switching with the bar shown', () => {
  it('moves all three tabs to the new prefix and back again', async () => {
    await open('/ro');
    const language = TestBed.inject(LanguageChoice);

    await language.choose('en');
    await settle();
    expect(tabs().map((a) => a.getAttribute('href'))).toEqual([
      '/en',
      '/en/garages',
      '/en/account',
    ]);

    await language.choose('ro');
    await settle();
    expect(labels()).toEqual(['Caută', GARAGES, 'Cont']);
    expect(tabs().map((a) => a.getAttribute('href'))).toEqual([
      '/ro',
      '/ro/garages',
      '/ro/account',
    ]);
  });

  it('keeps the same bar element and the current tab through a switch', async () => {
    await open('/ro/mechanics/ion');
    const before = bar();

    await TestBed.inject(LanguageChoice).choose('en');
    await settle();

    expect(bar()).toBe(before);
    expect(current()).toEqual(['Garages']);
    expect(bar()?.querySelector('nav')?.getAttribute('aria-label')).toBe(
      'Main navigation',
    );
  });
});

describe('the Cont destination', () => {
  it('leads to the same address whether or not someone is signed in', async () => {
    await open('/ro');
    const signedOut = href('Cont');

    await restart(DRIVER);
    await open('/ro');

    expect(signedOut).toBe('/ro/account');
    expect(href('Cont')).toBe('/ro/account');
  });

  it('does not ask the session when a public page other than the account screen opens', async () => {
    await open('/ro');
    await open('/ro/garages');
    await open('/ro/mechanics/ion');

    expect(load).not.toHaveBeenCalled();
  });

  it('asks the session once for one visit to the account screen', async () => {
    await open('/ro/account');

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('answers a later visit with the new session after a signed-out answer', async () => {
    await restart(null, DRIVER);
    await open('/ro/account');
    expect(url()).toBe('/ro/account');
    await open('/ro');

    await open('/ro/account');

    expect(url()).toBe('/app/driver');
  });

  it('shows the placeholder to a visitor with no session answer', async () => {
    await open('/en/account');

    expect(url()).toBe('/en/account');
    expect(bars()).toHaveLength(1);
    expect(current()).toEqual(['Account']);
    expect(heading().length).toBeGreaterThan(0);
  });

  it('opens the dashboard of a signed-in person and drops the public bar', async () => {
    await restart(DRIVER);
    await open('/en/account');

    expect(url()).toBe('/app/driver');
    expect(bars()).toHaveLength(0);
  });
});

describe('placeholder screens', () => {
  it.each([
    '/ro/garages',
    '/ro/garages/atelier-pop',
    '/ro/mechanics/ion',
    '/ro/account',
    '/en/garages',
    '/en/garages/atelier-pop',
    '/en/mechanics/ion',
    '/en/account',
  ])('shows one heading and a line saying it comes later at %s', async (address) => {
    await open(address);

    expect(page().querySelectorAll('h1')).toHaveLength(1);
    expect(heading().length).toBeGreaterThan(0);
    expect(line().length).toBeGreaterThan(0);
  });

  it('writes the heading and line in the language of the address', async () => {
    await open('/ro/garages');
    const ro = heading();
    const roLine = line();
    await open('/en/garages');

    expect(heading()).not.toBe(ro);
    expect(line()).not.toBe(roLine);
  });

  it('names a different section on the account screen than on the garage screen', async () => {
    await open('/en/garages');
    const garages = heading();
    await open('/en/account');

    expect(heading()).not.toBe(garages);
  });

  it('gives a placeholder the canonical and alternate links of its address', async () => {
    await open('/en/garages/atelier-pop');

    expect(head('link[rel="canonical"]')).toBe(
      `${ORIGIN}/en/garages/atelier-pop`,
    );
    expect(head('link[hreflang="ro"]')).toBe(
      `${ORIGIN}/ro/garages/atelier-pop`,
    );
    expect(head('link[hreflang="en"]')).toBe(
      `${ORIGIN}/en/garages/atelier-pop`,
    );
  });

  it('marks no placeholder noindex', async () => {
    await open('/ro/mechanics/ion');

    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });
});

describe('the bar while a field has focus', () => {
  it.each([
    'text',
    'search',
    'email',
    'password',
    'number',
    'tel',
    'url',
    'date',
    'time',
    'month',
    'week',
    'datetime-local',
  ])('hides for an input of type %s', async (type) => {
    await open('/ro');

    expect(await focusField(input(type))).toBe(true);
  });

  it.each([
    'button',
    'checkbox',
    'color',
    'file',
    'image',
    'radio',
    'range',
    'reset',
    'submit',
  ])('stays for an input of type %s', async (type) => {
    await open('/ro');

    expect(await focusField(input(type))).toBe(false);
  });

  it('hides for a textarea', async () => {
    await open('/ro');

    expect(await focusField(() => document.createElement('textarea'))).toBe(
      true,
    );
  });

  it('hides for an editable element', async () => {
    await open('/ro');

    expect(
      await focusField(() => {
        const div = document.createElement('div');
        div.setAttribute('contenteditable', 'true');
        // jsdom does not compute isContentEditable; the browser test covers it.
        Object.defineProperty(div, 'isContentEditable', { value: true });
        return div;
      }),
    ).toBe(true);
  });

  it('hides for an input with an upper-case type attribute', async () => {
    await open('/ro');

    expect(
      await focusField(() => {
        const field = document.createElement('input');
        field.setAttribute('type', 'TEXT');
        return field;
      }),
    ).toBe(true);
  });

  it('hides for an input with no type attribute', async () => {
    await open('/ro');

    expect(await focusField(() => document.createElement('input'))).toBe(true);
  });

  it('stays for a plain element that is not editable', async () => {
    await open('/ro');

    expect(await focusField(() => document.createElement('div'))).toBe(false);
  });

  it('stays hidden while focus moves from one text field to another', async () => {
    await open('/ro');
    const first = input('text')();
    const second = input('email')();
    document.body.append(first, second);

    first.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await settle();
    first.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: second }),
    );
    second.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await settle();
    const hidden = bar()?.hidden;
    second.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await settle();
    first.remove();
    second.remove();

    expect(hidden).toBe(true);
    expect(bar()?.hidden).toBe(false);
  });

  it('shows again once the field loses focus', async () => {
    await open('/ro');
    await focusField(input('text'));

    expect(bar()?.hidden).toBe(false);
  });

  it('is shown on first render when no field has focus', async () => {
    await open('/ro/garages');

    expect(bar()?.hidden).toBe(false);
  });
});
