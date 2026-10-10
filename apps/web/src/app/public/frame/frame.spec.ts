import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { I18n } from '@motor-fix/i18n';

import { PublicFrame } from './frame';
import { provideLanguageAddresses, SITE_ORIGIN } from '../../addresses';
import { SignInDialog } from '../../sign-in/sign-in-dialog';

@Component({ selector: 'mf-page', template: '<h1>page</h1>' })
class Page {}

let signIn: { start: jest.Mock };
let harness: RouterTestingHarness;

async function open(address: string, language: 'ro' | 'en' = 'ro') {
  signIn = { start: jest.fn(async () => undefined) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        {
          children: [
            { component: Page, path: '' },
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

  it('opens the sign-in dialog from "Autentificare" and from the account button', async () => {
    await open('/ro');

    button('Autentificare')?.click();
    button('Cont')?.click();

    expect(signIn.start).toHaveBeenCalledTimes(2);
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
