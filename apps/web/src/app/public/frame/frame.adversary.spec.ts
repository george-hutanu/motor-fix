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

async function open(address: string, language: 'ro' | 'en' = 'ro') {
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
const nav = () => [...bar().querySelectorAll('nav.links > *')];
const names = () => nav().map((e) => e.textContent?.trim());
const refresh = async () => {
  harness.fixture.detectChanges();
  await harness.fixture.whenStable();
  harness.fixture.detectChanges();
};

// @traces 228-FR-001
describe('the site bar links in order', () => {
  it('lists find, how it works, sign in and list, in that order, in Romanian', async () => {
    await open('/ro');

    expect(names()).toEqual([
      'Găsește un mecanic',
      'Cum funcționează',
      'Autentificare',
      'Înscrie‑ți service‑ul',
    ]);
  });

  it('lists them in the same order in English', async () => {
    await open('/en', 'en');

    expect(names()).toEqual([
      'Find a mechanic',
      'How it works',
      'Sign in',
      'List your garage',
    ]);
  });

  it('keeps the link to the section in the right language when the page is English', async () => {
    await open('/en', 'en');

    const link = nav()[1] as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/en#how-it-works');
  });
});

// @traces 228-FR-002
describe('the link to how it works', () => {
  it.each([
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
    { button: 2 },
  ])('leaves a modified click %j to the browser', async (init) => {
    await open('/ro');
    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      ...init,
    });

    (nav()[1] as HTMLElement).dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('navigates in place to the fragment on a plain click, from another public page', async () => {
    await open('/ro/list-your-garage');

    (nav()[1] as HTMLElement).click();
    await refresh();

    const router = TestBed.inject(Router);
    expect(router.url).toBe('/ro#how-it-works');
  });

  it('takes the current language when the page is English', async () => {
    await open('/en/list-your-garage', 'en');

    (nav()[1] as HTMLElement).click();
    await refresh();

    expect(TestBed.inject(Router).url).toBe('/en#how-it-works');
  });

  it('runs the navigation again when clicked twice on Home', async () => {
    await open('/ro');
    const events: string[] = [];
    TestBed.inject(Router).events.subscribe((e) => {
      if (e.constructor.name === 'NavigationEnd')
        events.push(e.constructor.name);
    });

    (nav()[1] as HTMLElement).click();
    await refresh();
    (nav()[1] as HTMLElement).click();
    await refresh();

    expect(events).toHaveLength(2);
  });
});

// @traces 228-FR-003
describe('the find link with a brand shown', () => {
  it('opens Results for the brand shown on Home', async () => {
    await open('/ro');
    TestBed.inject(BrandChoice).shown.set('dacia');
    await refresh();

    expect(nav()[0].getAttribute('href')).toBe('/ro/garages?brand=dacia');
  });

  it('writes a hostile slug as one encoded query value', async () => {
    await open('/ro');
    TestBed.inject(BrandChoice).shown.set('a&b=c d#x');
    await refresh();

    const href = nav()[0].getAttribute('href') ?? '';
    expect(href).toBe('/ro/garages?brand=a%26b%3Dc%20d%23x');
  });

  it('goes back to Home when the brand is cleared', async () => {
    await open('/ro');
    const shown = TestBed.inject(BrandChoice).shown;
    shown.set('dacia');
    await refresh();
    shown.set(null);
    await refresh();

    expect(nav()[0].getAttribute('href')).toBe('/ro');
  });

  it('treats an empty slug as no brand', async () => {
    await open('/ro');
    TestBed.inject(BrandChoice).shown.set('');
    await refresh();

    expect(nav()[0].getAttribute('href')).toBe('/ro');
  });

  it('follows the page language when the brand stays the same', async () => {
    await open('/en', 'en');
    TestBed.inject(BrandChoice).shown.set('bmw');
    await refresh();

    expect(nav()[0].getAttribute('href')).toBe('/en/garages?brand=bmw');
  });
});

// @traces 228-FR-004
describe('the account entry', () => {
  it('replaces sign in with the account link when a session is known', async () => {
    await open('/ro');
    session.current.set({ id: 'u1' });
    await refresh();

    expect(names()).not.toContain('Autentificare');
    const account = nav().find((e) => e.getAttribute('href') === '/ro/account');
    expect(account?.textContent?.trim()).toBe('Cont');
  });

  it('keeps the account entry in the place sign in had', async () => {
    await open('/ro');
    session.current.set({ id: 'u1' });
    await refresh();

    expect(nav().map((e) => e.getAttribute('href'))).toEqual([
      '/ro',
      '/ro#how-it-works',
      '/ro/account',
      '/ro/list-your-garage',
    ]);
  });

  it('goes back to sign in when the session is dropped', async () => {
    await open('/ro');
    session.current.set({ id: 'u1' });
    await refresh();
    session.current.set(null);
    await refresh();

    expect(names()).toContain('Autentificare');
  });

  it('never asks the server for the session, signed in or not', async () => {
    await open('/ro');
    session.current.set({ id: 'u1' });
    await refresh();
    (harness.fixture.nativeElement as HTMLElement)
      .querySelector<HTMLElement>('button.account')
      ?.click();

    expect(session.load).not.toHaveBeenCalled();
  });
});
