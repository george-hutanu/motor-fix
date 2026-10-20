import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { I18n } from '@motor-fix/i18n';

import { PublicFrame } from './frame';
import { provideLanguageAddresses, SITE_ORIGIN } from '../../addresses';
import { Session } from '../../dashboard/session';
import { BrandChoice } from '../../home/brand-choice/brand-choice';
import { SignInDialog } from '../../sign-in/sign-in-dialog';

@Component({ selector: 'mf-page', template: '<h1>page</h1>' })
class Page {}

let signIn: { start: jest.Mock };
let harness: RouterTestingHarness;
const session = {
  current: signal<{ id: string } | null>(null),
  load: jest.fn(),
};

async function open(
  address: string,
  language: 'ro' | 'en' = 'ro',
  before: () => void = () => undefined,
) {
  signIn = { start: jest.fn(async () => undefined) };
  session.current.set(null);
  session.load.mockReset();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          children: [
            { component: Page, path: '' },
            { component: Page, path: 'garages' },
            { component: Page, path: 'garages/:garage' },
            { component: Page, path: 'list-your-garage' },
          ],
          component: PublicFrame,
          path: ':lang',
        },
      ]),
      provideLanguageAddresses(),
      { provide: SITE_ORIGIN, useValue: 'https://motorfix.ro' },
      { provide: SignInDialog, useValue: signIn },
      { provide: Session, useValue: session },
    ],
  });
  before();
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  await i18n.use(language);
  harness = await RouterTestingHarness.create(address);
  harness.fixture.detectChanges();
  await harness.fixture.whenStable();
}

const bar = () =>
  (harness.fixture.nativeElement as HTMLElement).querySelector(
    'mf-public-frame > header',
  ) as HTMLElement;
const link = (name: string) =>
  [...bar().querySelectorAll('a')].find(
    (a) =>
      a.textContent?.trim() === name || a.getAttribute('aria-label') === name,
  );
const button = (name: string) =>
  [...bar().querySelectorAll('button')].find(
    (b) =>
      b.textContent?.trim() === name || b.getAttribute('aria-label') === name,
  ) as HTMLButtonElement | undefined;

// @traces 307-FR-009 307-FR-016
describe('the public site bar', () => {
  it('leads home from the logo and from "Găsește un mecanic", and to the listing form', async () => {
    await open('/ro/garages/service-auto-militari');

    expect(link('MotorFix, pagina principală')?.getAttribute('href')).toBe(
      '/ro',
    );
    expect(link('Găsește un mecanic')?.getAttribute('href')).toBe('/ro');
    expect(link('Înscrie‑ți service‑ul')?.getAttribute('href')).toBe(
      '/ro/list-your-garage',
    );
  });

  // @traces 267-FR-015
  it('names the link home "Căutare nouă" on Results, and "New search" in English', async () => {
    await open('/ro/garages?brand=dacia');

    expect(link('Căutare nouă')?.getAttribute('href')).toBe('/ro');
    expect(link('Găsește un mecanic')).toBeUndefined();

    TestBed.resetTestingModule();
    await open('/en/garages?brand=dacia', 'en');

    expect(link('New search')?.getAttribute('href')).toBe('/en');
  });

  it('opens the sign-in dialog from "Autentificare" and from the account button', async () => {
    await open('/ro');

    button('Autentificare')?.click();
    button('Cont')?.click();

    expect(signIn.start).toHaveBeenCalledTimes(2);
  });

  // @traces 1345-FR-006
  it('opens the sign-in dialog without asking for the session again after a dashboard sent the visitor here', async () => {
    await open('/ro');

    await TestBed.inject(Router).navigateByUrl('/ro', {
      onSameUrlNavigation: 'reload',
      state: { signIn: true },
    });

    expect(signIn.start).toHaveBeenCalledWith({ signedOut: true });
  });

  it('names its links in English on an English page', async () => {
    await open('/en', 'en');

    expect(link('MotorFix, home page')?.getAttribute('href')).toBe('/en');
    expect(link('Find a mechanic')).toBeDefined();
    expect(link('List your garage')?.getAttribute('href')).toBe(
      '/en/list-your-garage',
    );
    expect(button('Sign in')).toBeDefined();
    expect(button('Account')).toBeDefined();
  });

  it('holds the language switch, which opens the same page in English with the brand kept', async () => {
    await open('/ro/garages/service-auto-militari?brand=dacia');

    const en = [...bar().querySelectorAll('[role="group"] button')].find(
      (b) => b.textContent?.trim() === 'EN',
    ) as HTMLButtonElement;
    en.click();
    await harness.fixture.whenStable();

    expect(TestBed.inject(Router).url).toBe(
      '/en/garages/service-auto-militari?brand=dacia',
    );
  });

  it('labels its links apart from the tab bar', async () => {
    await open('/ro');

    expect(bar().querySelector('nav')?.getAttribute('aria-label')).toBe(
      'Meniul site‑ului',
    );
  });

  it('hides the links under 640 px behind a 44 px account button, and never scrolls sideways', () => {
    const css = readFileSync(join(__dirname, 'frame.css'), 'utf8');

    expect(css).toMatch(/@media \(min-width: 640px\)/);
    expect(css).toMatch(/\.account\s*\{[^}]*min-(width|height): 44px/);
    expect(css).toMatch(/overflow-x: clip/);
  });
});

// @traces 244-FR-002 244-FR-006
describe('the public frame around the consent bar', () => {
  it('puts the footer and the consent bar after the page and before the tab bar', async () => {
    await open('/ro');

    const order = [
      ...((harness.fixture.nativeElement as HTMLElement).querySelector(
        'mf-public-frame',
      )?.children ?? []),
    ].map((child) => child.tagName.toLowerCase());
    expect(order.slice(order.indexOf('main'))).toEqual([
      'main',
      'mf-public-footer',
      'mf-consent-bar',
      'mf-public-tab-bar',
    ]);
  });

  it('gives the tab bar a height on a phone for the consent bar to sit on, none without one', () => {
    const css = readFileSync(join(__dirname, 'frame.css'), 'utf8');

    expect(css).toMatch(
      /@media \(max-width: 767\.98px\)\s*\{\s*:host\s*\{\s*--tab-bar:/,
    );
    expect(css).toMatch(/:host\(\.no-tab-bar\)\s*\{\s*--tab-bar: 0px/);
  });
});

// @traces 248-FR-011
describe('the contact link', () => {
  it.each([
    ['/ro', 'ro'],
    ['/ro/garages/service-auto-militari', 'ro'],
    ['/en/list-your-garage', 'en'],
  ] as const)('stays in the footer on %s', async (address, language) => {
    await open(address, language);
    const footer = (harness.fixture.nativeElement as HTMLElement).querySelector(
      'mf-public-frame > mf-public-footer',
    );

    expect(
      footer?.querySelector(`a[href="/${language}/contact"]`),
    ).not.toBeNull();
  });
});

// @traces 228-FR-001 228-FR-002
describe('the "Cum funcționează" link', () => {
  it('sits between "Găsește un mecanic" and "Autentificare", before the listing link', async () => {
    await open('/ro');

    expect(
      [...(bar().querySelector('nav')?.children ?? [])].map((child) =>
        child.textContent?.trim(),
      ),
    ).toEqual([
      'Găsește un mecanic',
      'Cum funcționează',
      'Autentificare',
      'Înscrie‑ți service‑ul',
    ]);
  });

  it('points at the section on Home, in the page language', async () => {
    await open('/ro/garages?brand=dacia');
    expect(link('Cum funcționează')?.getAttribute('href')).toBe(
      '/ro#how-it-works',
    );

    TestBed.resetTestingModule();
    await open('/en/list-your-garage', 'en');
    expect(link('How it works')?.getAttribute('href')).toBe('/en#how-it-works');
  });

  it('opens Home at the section from another page', async () => {
    await open('/ro/garages/service-auto-militari');

    link('Cum funcționează')?.click();
    await harness.fixture.whenStable();

    expect(TestBed.inject(Router).url).toBe('/ro#how-it-works');
  });

  it('jumps to the section again on Home, even when already there', async () => {
    await open('/ro');
    const router = TestBed.inject(Router);
    const navigate = jest.spyOn(router, 'navigate');

    link('Cum funcționează')?.click();
    await harness.fixture.whenStable();
    link('Cum funcționează')?.click();
    await harness.fixture.whenStable();

    expect(navigate).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenLastCalledWith(['/', 'ro'], {
      fragment: 'how-it-works',
      onSameUrlNavigation: 'reload',
    });
    expect(router.url).toBe('/ro#how-it-works');
  });
});

// @traces 228-FR-003
describe('"Găsește un mecanic" on Home', () => {
  it('opens Results for the brand Home shows', async () => {
    await open('/ro', 'ro', () => {
      TestBed.inject(BrandChoice).shown.set('dacia');
    });

    expect(link('Găsește un mecanic')?.getAttribute('href')).toBe(
      '/ro/garages?brand=dacia',
    );
  });

  it('follows the brand Home moves on to', async () => {
    await open('/ro');
    TestBed.inject(BrandChoice).shown.set('bmw');
    harness.fixture.detectChanges();

    expect(link('Găsește un mecanic')?.getAttribute('href')).toBe(
      '/ro/garages?brand=bmw',
    );
  });

  it('leads home while no brand is shown', async () => {
    await open('/ro/list-your-garage');

    expect(link('Găsește un mecanic')?.getAttribute('href')).toBe('/ro');
  });
});

// @traces 228-FR-004
describe('the site bar for a signed-in visitor', () => {
  it('shows the account entry in place of "Autentificare", fetching nothing', async () => {
    await open('/ro', 'ro', () => {
      session.current.set({ id: 'u1' });
    });

    expect(button('Autentificare')).toBeUndefined();
    expect(link('Cont')?.getAttribute('href')).toBe('/ro/account');
    expect(session.load).not.toHaveBeenCalled();
  });

  it('shows "Autentificare" again once the visitor signs out', async () => {
    await open('/ro', 'ro', () => {
      session.current.set({ id: 'u1' });
    });

    session.current.set(null);
    harness.fixture.detectChanges();

    expect(button('Autentificare')).toBeDefined();
  });
});

// @traces 228-FR-019
describe('the public frame source', () => {
  it('names no ticket in its comments', () => {
    const source = readFileSync(join(__dirname, 'frame.ts'), 'utf8');

    expect(source).not.toMatch(/\b(?:ST|EP)-\d+/);
  });
});
