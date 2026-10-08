import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { MeDto } from '@motor-fix/data-access';
import { LanguageChoice } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { Subject } from 'rxjs';

import { provideLanguageAddresses, SITE_ORIGIN } from '../../addresses';
import { routes } from '../../app.routes';
import { Session } from '../../dashboard/session';

// Romanian keeps the word whole with a non-breaking hyphen.
const GARAGES = 'Service\u2011uri';

const DRIVER = {
  capabilities: [],
  email: null,
  garageAccess: [],
  garageId: null,
  id: 'account-1',
  landing: '/app/driver',
  language: 'ro',
  name: 'Ioana Pop',
  role: 'driver',
  roles: ['driver'],
} as unknown as MeDto;

let signedIn: MeDto | null;
let overlays: { open: jest.Mock };

function setUp(platform = 'browser') {
  signedIn = null;
  overlays = { open: jest.fn(async () => 'cancelled') };
  const current = signal<MeDto | null>(null);
  const load = jest.fn(async () => {
    current.set(signedIn);
    return signedIn;
  });
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      provideLanguageAddresses(),
      { provide: SITE_ORIGIN, useValue: 'https://motorfix.ro' },
      {
        provide: Session,
        useValue: {
          current,
          ended: new Subject<void>(),
          keepReturnTo: jest.fn(),
          load,
          shown: current,
          takeReturnTo: jest.fn((): string | null => null),
        },
      },
      { provide: PLATFORM_ID, useValue: platform },
      { provide: Overlays, useValue: overlays },
    ],
  });
  return load;
}

let harness: RouterTestingHarness | undefined;

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

const url = () => TestBed.inject(Router).url;
const page = () => harness?.fixture.nativeElement as HTMLElement;
const bar = () => page().querySelector<HTMLElement>('mf-public-tab-bar');
const nav = () => bar()?.querySelector('nav');
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
const tap = async (label: string) => {
  tabs()
    .find((a) => a.textContent?.trim() === label)
    ?.click();
  await settle();
};
// The Jest transform drops component styles, so they are read from the source.
const styles = () => readFileSync(join(__dirname, 'tab-bar.css'), 'utf8');

beforeEach(() => {
  localStorage.clear();
  harness = undefined;
});

describe('the account screen on the server', () => {
  it('renders the placeholder without asking for a session it cannot have', async () => {
    const load = setUp('server');
    signedIn = DRIVER;

    await open('/ro/account');

    expect(load).not.toHaveBeenCalled();
    expect(url()).toBe('/ro/account');
    expect(page().querySelector('h1')?.textContent?.trim()).toBe('Cont');
  });
});

describe('the public tab bar', () => {
  beforeEach(() => setUp());

  it('shows Caută, Service-uri and Cont on Home, Caută the current page', async () => {
    await open('/ro');

    expect(nav()?.getAttribute('aria-label')).toBe('Navigare principală');
    expect(labels()).toEqual(['Caută', GARAGES, 'Cont']);
    expect(current()).toEqual(['Caută']);
    for (const tab of tabs()) {
      const icon = tab.querySelector('svg');
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it.each([
    ['/ro/garages', GARAGES],
    ['/ro/garages?brand=bmw', GARAGES],
    ['/ro/garages/atelier-dinamo', GARAGES],
    ['/ro/mechanics/ion-popescu', GARAGES],
    ['/ro/account', 'Cont'],
  ])('makes %s the screen of %s', async (address, tab) => {
    await open(address);

    expect(current()).toEqual([tab]);
    expect(labels()).toHaveLength(3);
  });

  it.each([
    ['/ro/garages', GARAGES],
    ['/ro/garages/atelier-dinamo', GARAGES],
    ['/ro/mechanics/ion-popescu', 'Mecanic'],
    ['/ro/account', 'Cont'],
  ])('shows a placeholder at %s', async (address, heading) => {
    await open(address);

    expect(page().querySelector('h1')?.textContent?.trim()).toBe(heading);
    expect(page().textContent).toContain('Pagina vine în curând.');
  });

  it('keeps every public screen in a main landmark, the bar after it', async () => {
    for (const address of ['/ro', '/ro/garages', '/ro/account']) {
      await open(address);
      const main = page().querySelectorAll('main');

      expect(main).toHaveLength(1);
      expect(main[0].querySelector('mf-public-tab-bar')).toBeNull();
      expect(main[0].nextElementSibling?.tagName).toBe('MF-PUBLIC-TAB-BAR');
      expect(main[0].textContent?.trim()).not.toBe('');
    }
  });

  it('is not on the not-found page or a dashboard', async () => {
    await open('/ro/no-such-page');
    expect(bar()).toBeNull();

    signedIn = DRIVER;
    await open('/app/driver');
    expect(url()).toBe('/app/driver');
    expect(bar()).toBeNull();
  });

  it('leads Caută home and Cont to the account screen', async () => {
    await open('/ro/garages');

    expect(href('Caută')).toBe('/ro');
    expect(href('Cont')).toBe('/ro/account');

    await tap('Caută');
    expect(url()).toBe('/ro');
    expect(current()).toEqual(['Caută']);
  });

  it('leads Service-uri to the results, then to the last brand opened', async () => {
    await open('/ro');
    expect(href(GARAGES)).toBe('/ro/garages');

    await open('/ro/garages?brand=bmw');
    await open('/ro/garages/atelier-dinamo?brand=audi');
    await open('/ro/garages');
    await open('/ro/garages?brand=');
    await open('/ro');

    expect(href(GARAGES)).toBe('/ro/garages?brand=bmw');

    signedIn = DRIVER;
    await open('/app/driver');
    await open('/ro');
    expect(href(GARAGES)).toBe('/ro/garages?brand=bmw');

    await tap(GARAGES);
    expect(url()).toBe('/ro/garages?brand=bmw');
  });

  it('opens the sign-in dialog over the current screen for a visitor who is not signed in', async () => {
    await open('/ro/garages');

    await tap('Cont');

    expect(url()).toBe('/ro/garages');
    expect(overlays.open).toHaveBeenCalledWith(expect.any(Function), {
      shape: 'dialog',
      title: 'public.signIn.title',
    });
  });

  it('keeps the account address on Cont for a new tab or a page without scripts', async () => {
    await open('/ro');

    const cont = tabs().find((a) => a.textContent?.trim() === 'Cont');
    cont?.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
      }),
    );
    await settle();

    expect(href('Cont')).toBe('/ro/account');
    expect(overlays.open).not.toHaveBeenCalled();
  });

  it('opens the dashboard of a signed-in person from Cont', async () => {
    signedIn = DRIVER;
    await open('/ro');

    await tap('Cont');

    expect(url()).toBe('/app/driver');
    expect(bar()).toBeNull();
  });

  it('reads English at /en', async () => {
    await open('/en');

    expect(nav()?.getAttribute('aria-label')).toBe('Main navigation');
    expect(labels()).toEqual(['Search', 'Garages', 'Account']);
  });

  it('changes its labels and addresses in place when the language changes', async () => {
    await open('/ro/garages?brand=bmw');
    const before = bar();

    await TestBed.inject(LanguageChoice).choose('en');
    await settle();

    expect(url()).toBe('/en/garages?brand=bmw');
    expect(bar()).toBe(before);
    expect(labels()).toEqual(['Search', 'Garages', 'Account']);
    expect(current()).toEqual(['Garages']);
    expect(href('Search')).toBe('/en');
    expect(href('Garages')).toBe('/en/garages?brand=bmw');
    expect(href('Account')).toBe('/en/account');
  });

  it('steps aside while a text field has focus', async () => {
    await open('/ro');
    const focus = async (type: string) => {
      const field = document.createElement(
        type === 'textarea' ? type : 'input',
      );
      if (field instanceof HTMLInputElement) field.type = type;
      document.body.append(field);
      field.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      await settle();
      const hidden = bar()?.hidden;
      field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      field.remove();
      await settle();
      return hidden;
    };

    expect(await focus('text')).toBe(true);
    expect(bar()?.hidden).toBe(false);
    expect(await focus('search')).toBe(true);
    expect(await focus('email')).toBe(true);
    expect(await focus('textarea')).toBe(true);
    expect(await focus('checkbox')).toBe(false);
    expect(await focus('radio')).toBe(false);
    expect(await focus('submit')).toBe(false);
  });

  it('spaces the bar and its tabs on the 4 px grid', () => {
    const css = styles().replace(/\s+/g, ' ');
    const nav = /nav \{[^}]*padding: ([^;]+);/.exec(css)?.[1] ?? '';
    const gap = /a \{[^}]*gap: ([^;]+);/.exec(css)?.[1] ?? '';

    for (const px of `${nav} ${gap}`.matchAll(/(\d+(?:\.\d+)?)px/g)) {
      expect(Number(px[1]) % 4).toBe(0);
    }
    expect(gap).toBe('4px');
  });

  it('sits at the bottom, clear of the home indicator, with phone-sized tabs, and only on a phone', async () => {
    const css = styles().replace(/\s+/g, ' ');

    expect(css).toMatch(/position: sticky/);
    expect(css).toMatch(/bottom: 0/);
    expect(css).toMatch(/padding:[^;]*max\([^;]*var\(--mf-safe-bottom\)\)/);
    expect(css).toMatch(/min-height: (4[4-9]|5\d)px/);
    expect(css).toMatch(/font-size: var\(--mf-size-label\)/);
    expect(css).toMatch(
      /\[aria-current=["']?page["']?\][^{]*\{[^}]*color: var\(--mf-amber-ink\)/,
    );
    expect(css).toMatch(
      /@media \(min-width: 768px\) \{[^{]*\{[^}]*display: none/,
    );
    expect(css).toMatch(/:host\(\[hidden\]\) \{ display: none/);
  });
});

describe('signing in from a public screen', () => {
  beforeEach(() => setUp());

  const signInButton = () =>
    [...page().querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Autentificare',
    );

  it('offers "Autentificare" above the content of every public screen', async () => {
    for (const address of ['/ro', '/ro/garages', '/ro/account']) {
      await open(address);
      const button = signInButton();
      expect(button).toBeDefined();
      expect(
        button?.compareDocumentPosition(page().querySelector('main') as Node),
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  it('opens the dialog from "Autentificare" without changing the address', async () => {
    await open('/ro/garages');

    signInButton()?.click();
    await settle();

    expect(url()).toBe('/ro/garages');
    expect(overlays.open).toHaveBeenCalledTimes(1);
  });

  it('reads "Sign in" in English', async () => {
    await open('/en');

    expect(
      [...page().querySelectorAll('button')].some(
        (b) => b.textContent?.trim() === 'Sign in',
      ),
    ).toBe(true);
  });

  it('opens Home with the dialog when a signed-out visitor types a dashboard address', async () => {
    await open('/app/admin');

    expect(url()).toBe('/ro');
    expect(overlays.open).toHaveBeenCalledTimes(1);
  });

  it('does not open the dialog on an ordinary visit', async () => {
    await open('/ro');
    await open('/ro/garages');

    expect(overlays.open).not.toHaveBeenCalled();
  });
});
