import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { PublicFooter } from './footer';
import { CookieSettings } from '../../consent/cookie-settings/cookie-settings';
import { Session } from '../../dashboard/session';
import { SignInDialog } from '../../sign-in/sign-in-dialog';

let overlays: { open: jest.Mock };
let signIn: { start: jest.Mock };
const session = {
  current: signal<{ id: string } | null>(null),
  load: jest.fn(),
};

async function render(language: 'ro' | 'en' = 'ro') {
  overlays = { open: jest.fn(async () => undefined) };
  signIn = { start: jest.fn(async () => undefined) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: Overlays, useValue: overlays },
      { provide: SignInDialog, useValue: signIn },
      { provide: Session, useValue: session },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('consent');
  await i18n.enter('public');
  await i18n.use(language);
  const fixture = TestBed.createComponent(PublicFooter);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

// The legal row, under the MotorFix links.
const legal = (host: HTMLElement) =>
  host.querySelector('nav.legal') as HTMLElement;
const links = (host: HTMLElement) =>
  [...legal(host).querySelectorAll('a')].map((a) => [
    a.textContent?.trim(),
    a.getAttribute('href'),
  ]);

// @traces 244-FR-006 244-FR-014
describe('the public footer', () => {
  it('holds the terms, the privacy notice and "Setări cookie"', async () => {
    const host = await render();

    expect(links(host)).toEqual([
      ['Termeni de utilizare', '/ro/terms'],
      ['Nota de informare', '/ro/privacy'],
      ['Contact', '/ro/contact'],
    ]);
    expect(legal(host).querySelector('button')?.textContent?.trim()).toBe(
      'Setări cookie',
    );
  });

  it('reads English', async () => {
    const host = await render('en');

    expect(links(host)).toEqual([
      ['Terms of use', '/en/terms'],
      ['Privacy notice', '/en/privacy'],
      ['Contact', '/en/contact'],
    ]);
    expect(legal(host).querySelector('button')?.textContent?.trim()).toBe(
      'Cookie settings',
    );
  });

  // @traces 280-FR-002
  it('ends its row with the link to the contact page', async () => {
    const host = await render();

    const last = legal(host).lastElementChild;
    expect(last?.tagName).toBe('A');
    expect(last?.getAttribute('href')).toBe('/ro/contact');
  });

  it('spaces the items apart with no "·" glyph, so a narrow phone never starts or ends a line with one', async () => {
    const host = await render();

    expect(host.textContent).not.toContain('·');
    expect(host.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
    expect(
      legal(host).querySelectorAll(':scope > a, :scope > button'),
    ).toHaveLength(4);
  });

  it('opens the cookie settings dialog', async () => {
    const host = await render();

    legal(host).querySelector('button')?.click();
    // The dialog loads with its first opening.
    for (let i = 0; i < 50 && !overlays.open.mock.calls.length; i++)
      await new Promise((resolve) => setTimeout(resolve));

    expect(overlays.open).toHaveBeenCalledWith(
      CookieSettings,
      expect.objectContaining({ title: 'consent.dialog.title' }),
    );
  });
});

// @traces 228-FR-017
describe('the MotorFix links above the legal row', () => {
  const top = (host: HTMLElement) =>
    host.querySelector('nav.site') as HTMLElement;

  it('leads home from the wordmark, and to find a mechanic and the listing form', async () => {
    const host = await render();
    const wordmark = host.querySelector('a.wordmark');

    expect(wordmark?.getAttribute('href')).toBe('/ro');
    expect(wordmark?.getAttribute('aria-label')).toBe(
      'MotorFix, pagina principală',
    );
    expect(top(host).getAttribute('aria-label')).toBe('Legături MotorFix');
    expect(
      [...top(host).querySelectorAll('a')].map((a) => [
        a.textContent?.trim(),
        a.getAttribute('href'),
      ]),
    ).toEqual([
      ['Găsește un mecanic', '/ro'],
      ['Înscrie‑ți service‑ul', '/ro/list-your-garage'],
    ]);
  });

  it('opens the sign-in dialog from "Autentificare"', async () => {
    const host = await render();
    const button = top(host).querySelector('button');

    expect(button?.textContent?.trim()).toBe('Autentificare');
    button?.click();

    expect(signIn.start).toHaveBeenCalledTimes(1);
  });

  it('reads English', async () => {
    const host = await render('en');

    expect(
      [...top(host).querySelectorAll('a, button')].map((a) =>
        a.textContent?.trim(),
      ),
    ).toEqual(['Find a mechanic', 'List your garage', 'Sign in']);
    expect(host.querySelector('a.wordmark')?.getAttribute('href')).toBe('/en');
  });

  it('shows the account entry in place of sign in once the visit knows the session, and never asks the server for it', async () => {
    session.current.set({ id: 'u1' });
    try {
      const host = await render();

      expect(top(host).querySelector('button')).toBeNull();
      expect(
        [...top(host).querySelectorAll('a')].map((a) => [
          a.textContent?.trim(),
          a.getAttribute('href'),
        ]),
      ).toContainEqual(['Cont', '/ro/account']);
      expect(session.load).not.toHaveBeenCalled();
    } finally {
      session.current.set(null);
    }
  });

  it('puts the MotorFix links above the legal row', async () => {
    const host = await render();

    expect(
      top(host).compareDocumentPosition(legal(host)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('gives each link a 44 px target', () => {
    const css = readFileSync(join(__dirname, 'footer.css'), 'utf8');

    expect(css).toMatch(/\.site[^{]*\{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.site[^{]*\{[^}]*min-width: 44px/);
  });

  // @traces 228-FR-017 228-FR-018
  it('sets its links at 16 px and the wordmark at 16 px on a phone', () => {
    const css = readFileSync(join(__dirname, 'footer.css'), 'utf8');
    const phone =
      /@media \(max-width: 767\.98px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';

    expect(css).toMatch(/\.site \{[^}]*font-size: var\(--mf-size-body\)/);
    expect(phone).toMatch(/\.wordmark \{[^}]*font-size: var\(--mf-size-body\)/);
  });

  // Every part of the page sits in a landmark: the wordmark too (axe region).
  // @traces 228-FR-017
  it('holds the wordmark and both rows in one footer landmark', async () => {
    const host = await render();
    const footer = host.querySelector('footer');

    expect(footer).not.toBeNull();
    expect(footer?.contains(host.querySelector('.wordmark'))).toBe(true);
    expect(footer?.contains(top(host))).toBe(true);
    expect(footer?.contains(legal(host))).toBe(true);
  });
});
