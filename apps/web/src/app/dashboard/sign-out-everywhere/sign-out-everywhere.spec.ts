import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { SignOutEverywhere } from './sign-out-everywhere';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(language: 'ro' | 'en' = 'ro') {
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  const result: Promise<OverlayResult<boolean>> =
    host.componentInstance.overlays.open<boolean>(SignOutEverywhere, {
      shape: 'dialog',
      title: 'shell.signOutEverywhere.title',
    });
  await settle();
  return result;
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const buttons = () =>
  [...panel().querySelectorAll('mf-sign-out-everywhere button')].map((b) =>
    b.textContent?.trim(),
  );
const press = (name: string) =>
  (
    [...panel().querySelectorAll('mf-sign-out-everywhere button')].find(
      (b) => b.textContent?.trim() === name,
    ) as HTMLButtonElement
  ).click();

describe('the "sign out on all devices" confirmation', () => {
  it('asks the question as its title and says what happens', async () => {
    void open();
    await settle();

    expect(panel().textContent).toContain('Ieși de pe toate dispozitivele?');
    expect(panel().textContent).toContain(
      'Va trebui să te autentifici din nou peste tot.',
    );
    expect(buttons()).toEqual(['Ieși', 'Renunță']);
  });

  it('closes with true on "Ieși"', async () => {
    const result = open();
    await settle();

    press('Ieși');

    expect(await result).toBe(true);
  });

  it('closes with false on "Renunță"', async () => {
    const result = open();
    await settle();

    press('Renunță');

    expect(await result).toBe(false);
  });

  it('reads English', async () => {
    void open('en');
    await settle();

    expect(panel().textContent).toContain('Sign out on all devices?');
    expect(panel().textContent).toContain(
      'You will need to sign in again everywhere.',
    );
    expect(buttons()).toEqual(['Sign out', 'Cancel']);
  });
});
