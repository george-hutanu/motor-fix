import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { VerificationReopen } from './verification-reopen';

// @traces 306-FR-009 306-FR-010

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

let result: Promise<OverlayResult<true>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(language: 'ro' | 'en' = 'ro') {
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<true>(VerificationReopen, {
    shape: 'dialog',
    title: 'admin.file.reopen.title',
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const text = () => (panel().textContent ?? '').replace(/\s+/g, ' ');
const button = (name: string) =>
  [...panel().querySelectorAll('button')].find(
    (b) => (b.textContent ?? '').trim() === name,
  ) as HTMLButtonElement;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the reopen confirmation', () => {
  it('asks in Romanian, with the two answers', async () => {
    await open();

    expect(text()).toContain(
      'Redeschizi dosarul? Decizia rămâne până iei una nouă.',
    );
    expect(button('Redeschide')).toBeDefined();
    expect(button('Renunță')).toBeDefined();
  });

  it('asks in English', async () => {
    await open('en');

    expect(text()).toContain(
      'Reopen the file? The decision stands until you take a new one.',
    );
    expect(button('Reopen')).toBeDefined();
    expect(button('Cancel')).toBeDefined();
  });

  it('resolves true when confirmed', async () => {
    await open();

    button('Redeschide').click();
    await settle();

    await expect(result).resolves.toBe(true);
  });

  it('resolves cancelled when declined', async () => {
    await open();

    button('Renunță').click();
    await settle();

    await expect(result).resolves.toBe('cancelled');
  });
});
