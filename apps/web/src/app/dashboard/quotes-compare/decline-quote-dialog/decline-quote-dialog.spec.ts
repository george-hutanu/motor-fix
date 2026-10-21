import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { QuotesService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import {
  type DeclineQuoteData,
  DeclineQuoteDialog,
  type DeclineQuoteResult,
} from './decline-quote-dialog';
import { Live } from '../../live';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

let decline: jest.Mock;
let reread: jest.Mock;
let offline: ReturnType<typeof signal<boolean>>;
let result: Promise<DeclineQuoteResult | 'cancelled'>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open({
  language = 'ro',
  answer,
}: {
  language?: 'ro' | 'en';
  answer?: Promise<unknown> | HttpErrorResponse;
} = {}) {
  decline = jest.fn(() =>
    answer instanceof HttpErrorResponse
      ? Promise.reject(answer)
      : (answer ?? Promise.resolve({})),
  );
  reread = jest.fn();
  offline = signal(false);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: QuotesService,
        useValue: { declineQuoteControllerDecline: decline },
      },
      { provide: Live, useValue: { offline } },
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<
    DeclineQuoteResult,
    DeclineQuoteData
  >(DeclineQuoteDialog, {
    data: { garage: 'Volt Auto', quoteId: 'q-2', reread },
    shape: 'dialog',
    title: 'driver.quotes.declineDialog.title',
    titleParams: { name: 'Volt Auto' },
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const button = (name: string) =>
  [...panel().querySelectorAll('button')].find(
    (b) => b.textContent?.replace(/\s+/g, ' ').trim() === name,
  ) as HTMLButtonElement | undefined;
const alert = () =>
  panel().querySelector('[role="alert"]')?.textContent?.trim();

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  TestBed.resetTestingModule();
});

// @traces 314-FR-010
// @traces 314-FR-023
describe('the decline dialog', () => {
  it('asks to decline the garage’s quote, with no reason asked', async () => {
    await open();

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Refuzi oferta Volt Auto?',
    );
    expect(panel().querySelectorAll('input').length).toBe(0);
    expect(button('Confirmă')).toBeDefined();
    expect(button('Renunță')).toBeDefined();
  });

  it('reads in English', async () => {
    await open({ language: 'en' });

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Decline the Volt Auto quote?',
    );
    expect(button('Confirm')).toBeDefined();
  });

  it('declines once on Confirmă, then closes', async () => {
    await open();

    button('Confirmă')?.click();
    button('Confirmă')?.click();
    await settle();

    expect(decline).toHaveBeenCalledTimes(1);
    expect(decline).toHaveBeenCalledWith({ id: 'q-2' });
    await expect(result).resolves.toBe('declined');
  });

  it('closes on Renunță without declining', async () => {
    await open();

    button('Renunță')?.click();
    await settle();

    await expect(result).resolves.toBe('cancelled');
    expect(decline).not.toHaveBeenCalled();
  });

  // @traces 314-FR-022
  it('keeps Confirmă disabled while offline', async () => {
    await open();
    offline.set(true);
    await settle();

    expect(button('Confirmă')?.disabled).toBe(true);
  });
});

// @traces 314-FR-012
describe('the decline dialog: refusals', () => {
  it.each([
    ['accepted', 'Oferta a fost deja acceptată'],
    ['expired', 'Oferta a expirat'],
    ['declined_by_driver', 'Ai refuzat deja această ofertă'],
  ])(
    'says a %s quote cannot be declined and reads the panel again',
    async (currentStatus, said) => {
      await open({
        answer: new HttpErrorResponse({
          error: { code: 'invalid_transition', currentStatus, detail: said },
          status: 409,
        }),
      });

      button('Confirmă')?.click();
      await settle();

      expect(alert()).toBe(said);
      expect(reread).toHaveBeenCalledTimes(1);
      expect(button('Confirmă')?.disabled).toBe(true);
    },
  );
});
