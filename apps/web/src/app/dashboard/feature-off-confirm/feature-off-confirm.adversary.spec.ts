import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { FeatureOffConfirm } from './feature-off-confirm';

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

async function open(key: string) {
  await TestBed.inject(I18n).enter('garage');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<true, { key: string }>(
    FeatureOffConfirm,
    {
      data: { key },
      shape: 'dialog',
      title: 'garage.features.confirm.title',
      titleParams: { name: 'X' },
    },
  );
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const buttons = () => [
  ...panel().querySelectorAll<HTMLButtonElement>(
    'mf-feature-off-confirm button',
  ),
];

afterEach(() => {
  document.body.innerHTML = '';
});

// @traces 398-FR-010
describe('the switch-off confirmation under odd input', () => {
  it('closes cancelled when the panel is dismissed with Escape', async () => {
    await open('whatsapp');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    panel().dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    expect(await result).not.toBe(true);
  });

  it('resolves once with true even when "Oprește" is tapped twice', async () => {
    await open('whatsapp');

    const off = buttons().find((b) => b.textContent?.trim() === 'Oprește');
    off?.click();
    off?.click();

    expect(await result).toBe(true);
  });
});
