import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { QuotesService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import {
  type AcceptQuoteData,
  AcceptQuoteDialog,
  type AcceptQuoteResult,
} from './accept-quote-dialog';
import { Live } from '../../live';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

let accept: jest.Mock;
let reread: jest.Mock;
let offline: ReturnType<typeof signal<boolean>>;
let result: Promise<AcceptQuoteResult | 'cancelled'>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(answers: unknown[] = []) {
  let call = 0;
  accept = jest.fn(() => {
    const answer = answers[Math.min(call++, answers.length - 1)];
    return answer instanceof Error || answer instanceof HttpErrorResponse
      ? Promise.reject(answer)
      : ((answer as Promise<unknown>) ?? Promise.resolve({}));
  });
  reread = jest.fn();
  offline = signal(false);
  TestBed.configureTestingModule({
    providers: [
      { provide: QuotesService, useValue: { acceptControllerAccept: accept } },
      { provide: Live, useValue: { offline } },
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<
    AcceptQuoteResult,
    AcceptQuoteData
  >(AcceptQuoteDialog, {
    data: {
      garage: 'Garaj Nordic',
      quoteId: 'q-1',
      range: '120 – 180 lei',
      reread,
      slot: 'mâine, 09:00',
    },
    shape: 'dialog',
    title: 'driver.quotes.acceptDialog.title',
    titleParams: { name: 'Garaj Nordic' },
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const button = (name: string) =>
  [...panel().querySelectorAll('button')].find(
    (b) => b.textContent?.replace(/\s+/g, ' ').trim() === name,
  ) as HTMLButtonElement | undefined;
const tick = () =>
  panel().querySelector<HTMLInputElement>('input[type="checkbox"]');
const alert = () =>
  panel().querySelector('[role="alert"]')?.textContent?.trim();
const keyOf = (call: number) =>
  (accept.mock.calls[call][0] as { 'Idempotency-Key': string })[
    'Idempotency-Key'
  ];

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  TestBed.resetTestingModule();
});

// @traces 314-FR-023
describe('the accept dialog, keyboard and focus', () => {
  it('closes on Escape exactly as Renunță, sending nothing', async () => {
    await open();

    panel().dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    await expect(result).resolves.toBe('cancelled');
    expect(accept).not.toHaveBeenCalled();
  });

  it('puts focus inside the dialog when it opens', async () => {
    await open();

    const dialog = panel().closest('[role="dialog"]');
    expect(dialog?.contains(document.activeElement)).toBe(true);
  });

  it('gives the history box an accessible name', async () => {
    await open();

    expect(tick()?.labels?.[0]?.textContent?.trim()).toBe(
      'Le arăt istoricul mașinii',
    );
  });
});

// @traces 314-FR-003
describe('the accept dialog, retries', () => {
  it('keeps the ticked box through a network failure and the retry shares the history under the same key', async () => {
    await open([new HttpErrorResponse({ status: 0 }), Promise.resolve({})]);
    tick()?.click();
    await settle();

    button('Confirmă')?.click();
    await settle();
    button('Confirmă')?.click();
    await settle();

    expect(accept.mock.calls[0][0].body).toEqual({ historyShared: true });
    expect(accept.mock.calls[1][0].body).toEqual({ historyShared: true });
    expect(keyOf(1)).toBe(keyOf(0));
  });

  it('sends the key as a non-empty uuid and not the quote id', async () => {
    await open();

    button('Confirmă')?.click();
    await settle();

    expect(keyOf(0)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('treats a thrown plain Error as a network failure, open and retryable', async () => {
    await open([new Error('boom')]);

    button('Confirmă')?.click();
    await settle();

    expect(alert()).toBe(
      'Nu am putut trimite. Verifică conexiunea și încearcă din nou.',
    );
    expect(button('Confirmă')?.disabled).toBe(false);
  });

  it('keeps the dialog open with the server’s own words for a suspended garage and reads the panel again', async () => {
    await open([
      new HttpErrorResponse({
        error: {
          code: 'invalid_transition',
          currentStatus: 'withdrawn',
          message: 'Service‑ul nu mai primește cereri',
        },
        status: 409,
      }),
    ]);

    button('Confirmă')?.click();
    await settle();

    expect(alert()).toBe('Service‑ul nu mai primește cereri');
    expect(reread).toHaveBeenCalledTimes(1);
  });

  it('falls back to the withdrawn line when the server sends no message', async () => {
    await open([
      new HttpErrorResponse({
        error: { code: 'invalid_transition', currentStatus: 'withdrawn' },
        status: 409,
      }),
    ]);

    button('Confirmă')?.click();
    await settle();

    expect(alert()).toBe('Service‑ul a retras oferta');
  });

  it('lets Renunță close an offline dialog with nothing sent', async () => {
    await open();
    offline.set(true);
    await settle();

    button('Renunță')?.click();
    await settle();

    await expect(result).resolves.toBe('cancelled');
    expect(accept).not.toHaveBeenCalled();
  });

  it('enables Confirmă again when the channel comes back online', async () => {
    await open();
    offline.set(true);
    await settle();
    offline.set(false);
    await settle();

    expect(button('Confirmă')?.disabled).toBe(false);
  });
});
