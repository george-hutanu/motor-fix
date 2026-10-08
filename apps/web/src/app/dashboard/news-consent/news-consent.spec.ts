import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { NewsConsent } from './news-consent';

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
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('driver');
  const host = TestBed.createComponent(Host);
  const result: Promise<OverlayResult<boolean>> =
    host.componentInstance.overlays.open<boolean>(NewsConsent, {
      shape: 'dialog',
      title: 'driver.notifications.consent.title',
    });
  await settle();
  // Wrapped, so awaiting the open does not wait for the answer.
  return { result };
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const press = (name: string) =>
  (
    [...panel().querySelectorAll('mf-news-consent button')].find(
      (b) => b.textContent?.trim() === name,
    ) as HTMLButtonElement
  ).click();

describe('the MotorFix news consent step', () => {
  it('asks the question and shows the consent text', async () => {
    await open();

    expect(panel().textContent).toContain('Primești noutăți MotorFix?');
    expect(panel().textContent).toContain(
      'Vreau să primesc pe e‑mail noutăți MotorFix, cel mult o dată pe lună. Pot renunța oricând, cu un clic.',
    );
  });

  it('answers yes only when the driver agrees', async () => {
    const { result } = await open();

    press('Sunt de acord');

    await expect(result).resolves.toBe(true);
  });

  it('answers no when the driver cancels', async () => {
    const { result } = await open();

    press('Renunță');

    await expect(result).resolves.toBe(false);
  });

  it('shows the English text to an English driver', async () => {
    await open('en');

    expect(panel().textContent).toContain(
      'I want to receive MotorFix news by e‑mail, at most once a month.',
    );
    expect(panel().textContent).toContain('I agree');
  });
});
