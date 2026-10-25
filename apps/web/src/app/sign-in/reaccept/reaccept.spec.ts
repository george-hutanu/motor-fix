import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MeService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { Reaccept, type Versions } from './reaccept';
import { Session } from '../../dashboard/session';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const VERSIONS: Versions = {
  privacyVersion: '2026-10-24',
  termsVersion: '2026-10-12',
};

let accept: jest.Mock;
let signOut: jest.Mock;
let navigateByUrl: jest.Mock;
let result: Promise<OverlayResult<'accepted' | 'signed-out'>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(language: 'ro' | 'en' = 'ro') {
  accept = jest.fn(async () => undefined);
  signOut = jest.fn(async () => undefined);
  navigateByUrl = jest.fn(async () => true);
  TestBed.configureTestingModule({
    providers: [
      { provide: MeService, useValue: { acceptanceControllerAccept: accept } },
      { provide: Session, useValue: { signOut } },
      { provide: Router, useValue: { navigateByUrl } },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open(Reaccept, {
    data: VERSIONS,
    dismissible: false,
    shape: 'dialog',
    title: 'public.reaccept.title',
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const button = (name: string) =>
  [...panel().querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  ) as HTMLButtonElement;
const link = (href: string) =>
  panel().querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
const alertText = () =>
  panel().querySelector('[role="alert"]')?.textContent?.trim() ?? '';

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
});

// @traces 1204-FR-007
describe('the acceptance of new terms', () => {
  it.each([
    [
      'ro',
      'Termenii de utilizare',
      'Nota de informare privind datele personale',
      'versiunea',
      'Accept',
      'Deconectare',
    ],
    ['en', 'Terms of use', 'Privacy notice', 'version', 'Accept', 'Sign out'],
  ] as const)(
    'in %s names both texts with their links and versions, and offers accept and sign out',
    async (language, terms, privacy, version, acceptLabel, signOutLabel) => {
      await open(language);

      const termsLink = link(`/${language}/terms`);
      const privacyLink = link(`/${language}/privacy`);
      expect(termsLink?.textContent?.trim()).toBe(terms);
      expect(privacyLink?.textContent?.trim()).toBe(privacy);
      for (const a of [termsLink, privacyLink]) {
        expect(a?.getAttribute('target')).toBe('_blank');
        expect(a?.getAttribute('rel')).toBe('noopener');
      }
      expect(panel().textContent).toContain(`${version} 2026-10-12`);
      expect(panel().textContent).toContain(`${version} 2026-10-24`);
      expect(button(acceptLabel).hasAttribute('autofocus')).toBe(true);
      expect(button(signOutLabel)).toBeTruthy();
    },
  );

  it('offers no close control', async () => {
    await open();

    expect(panel().querySelector('.mf-overlay-close')).toBeNull();
  });

  it('records the versions shown and closes once accepted', async () => {
    await open();

    button('Accept').click();
    await settle();

    expect(accept).toHaveBeenCalledTimes(1);
    expect(accept).toHaveBeenCalledWith({ body: VERSIONS });
    expect(await result).toBe('accepted');
  });

  it('sends one request per press: the button waits while it is out', async () => {
    await open();
    let finish: () => void = () => undefined;
    accept.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    button('Accept').click();
    await settle();
    expect(button('Accept').disabled).toBe(true);
    button('Accept').click();
    finish();
    await settle();

    expect(accept).toHaveBeenCalledTimes(1);
  });

  it('says it failed and lets the person try again', async () => {
    await open();
    accept.mockRejectedValueOnce(
      new HttpErrorResponse({ error: { code: 'error' }, status: 500 }),
    );

    button('Accept').click();
    await settle();

    expect(alertText()).toBe('Nu am putut salva acceptarea. Încearcă din nou.');
    expect(button('Accept').disabled).toBe(false);
    expect(panel()).toBeTruthy();
  });

  it('shows the versions now in force when the shown ones went stale, and stays open', async () => {
    await open();
    accept.mockRejectedValueOnce(
      new HttpErrorResponse({
        error: {
          code: 'consent_required',
          privacyVersion: '2026-11-02',
          termsVersion: '2026-11-01',
        },
        status: 400,
      }),
    );

    button('Accept').click();
    await settle();

    expect(panel().textContent).toContain('versiunea 2026-11-01');
    expect(panel().textContent).toContain('versiunea 2026-11-02');
    expect(panel().textContent).not.toContain('2026-10-12');

    button('Accept').click();
    await settle();
    expect(accept).toHaveBeenLastCalledWith({
      body: { privacyVersion: '2026-11-02', termsVersion: '2026-11-01' },
    });
    expect(await result).toBe('accepted');
  });

  it('signs out, goes home and closes on sign out', async () => {
    await open('en');

    button('Sign out').click();
    await settle();

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledWith('/en');
    expect(accept).not.toHaveBeenCalled();
    expect(await result).toBe('signed-out');
  });
});
