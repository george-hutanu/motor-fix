import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { MeDto } from '@motor-fix/data-access';
import { LanguageChoice } from '@motor-fix/i18n';

import { provideLanguageAddresses, SITE_ORIGIN } from '../addresses';
import { routes } from '../app.routes';
import { Session } from '../dashboard/session';

// Romanian keeps the word whole with a non-breaking hyphen.
const GARAGES = 'Service\u2011uri';

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

let signedIn: MeDto | null;

function setUp() {
  signedIn = null;
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
      { provide: Session, useValue: { current, load } },
    ],
  });
  return load;
}

let harness: RouterTestingHarness;

async function settle() {
  for (let i = 0; i < 4; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
    await harness.fixture.whenStable();
  }
}

async function open(url: string) {
  harness ??= await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await settle();
}

const url = () => TestBed.inject(Router).url;
const page = () => harness.fixture.nativeElement as HTMLElement;
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
const styles = () =>
  /styles: `([^`]*)`/.exec(
    readFileSync(join(__dirname, 'tab-bar.ts'), 'utf8'),
  )?.[1] ?? '';

beforeEach(() => {
  localStorage.clear();
  harness = undefined as unknown as RouterTestingHarness;
});

describe('the public tab bar', () => {
  beforeEach(setUp);

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
    await open('/ro/garages/atelier-dinamo?brand=bmw');
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

  it('shows the account placeholder to a visitor who is not signed in', async () => {
    await open('/ro');

    await tap('Cont');

    expect(url()).toBe('/ro/account');
    expect(current()).toEqual(['Cont']);
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
