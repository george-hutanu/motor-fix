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

type Answer = Promise<unknown> | HttpErrorResponse;

async function open({
  language = 'ro',
  answers = [],
}: {
  language?: 'ro' | 'en';
  answers?: Answer[];
} = {}) {
  let call = 0;
  accept = jest.fn(() => {
    const answer = answers[Math.min(call++, answers.length - 1)];
    if (answer instanceof HttpErrorResponse) return Promise.reject(answer);
    return answer ?? Promise.resolve({});
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
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  const data: AcceptQuoteData = {
    garage: 'Garaj Nordic',
    quoteId: 'q-1',
    range: '120 – 180 lei',
    reread,
    slot: 'mâine, 09:00',
  };
  result = host.componentInstance.overlays.open<
    AcceptQuoteResult,
    AcceptQuoteData
  >(AcceptQuoteDialog, {
    data,
    shape: 'dialog',
    title: 'driver.quotes.acceptDialog.title',
    titleParams: { name: 'Garaj Nordic' },
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const text = () => (panel()?.textContent ?? '').replace(/\s+/g, ' ');
const button = (name: string) =>
  [...panel().querySelectorAll('button')].find(
    (b) => b.textContent?.replace(/\s+/g, ' ').trim() === name,
  ) as HTMLButtonElement | undefined;
const tick = () =>
  panel().querySelector<HTMLInputElement>('input[type="checkbox"]');
const keyOf = (call: number) =>
  (accept.mock.calls[call][0] as { 'Idempotency-Key': string })[
    'Idempotency-Key'
  ];
const refusal = (status: number, body: Record<string, unknown>) =>
  new HttpErrorResponse({ error: body, status });

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  TestBed.resetTestingModule();
});

// @traces 314-FR-002
// @traces 314-FR-023
describe('the accept dialog: what it asks', () => {
  it('names the garage, its range and its slot, with the history box unticked', async () => {
    await open();

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Accepți oferta Garaj Nordic?',
    );
    expect(text()).toContain('120 – 180 lei · mâine, 09:00');
    expect(tick()?.checked).toBe(false);
    expect(tick()?.closest('label')?.textContent?.trim()).toBe(
      'Le arăt istoricul mașinii',
    );
    expect(button('Confirmă')).toBeDefined();
    expect(button('Renunță')).toBeDefined();
  });

  it('reads in English', async () => {
    await open({ language: 'en' });

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Accept the Garaj Nordic quote?',
    );
    expect(tick()?.closest('label')?.textContent?.trim()).toBe(
      'Share this car’s history with the garage',
    );
    expect(button('Confirm')).toBeDefined();
    expect(button('Cancel')).toBeDefined();
  });

  it('closes on Renunță without accepting', async () => {
    await open();

    button('Renunță')?.click();
    await settle();

    await expect(result).resolves.toBe('cancelled');
    expect(accept).not.toHaveBeenCalled();
  });
});

// @traces 314-FR-003
describe('the accept dialog: accepting', () => {
  it('accepts without sharing the history unless ticked, then closes', async () => {
    await open();

    button('Confirmă')?.click();
    await settle();

    expect(accept).toHaveBeenCalledWith({
      body: { historyShared: false },
      'Idempotency-Key': expect.stringMatching(/^[0-9a-f-]{36}$/),
      id: 'q-1',
    });
    await expect(result).resolves.toBe('accepted');
  });

  it('shares the history when the box is ticked', async () => {
    await open();

    tick()?.click();
    await settle();
    button('Confirmă')?.click();
    await settle();

    expect(accept.mock.calls[0][0]).toMatchObject({
      body: { historyShared: true },
    });
  });

  it('shows a spinner and disables both buttons while sending, and sends once', async () => {
    await open({ answers: [new Promise(() => undefined)] });

    button('Confirmă')?.click();
    button('Confirmă')?.click();
    await settle();

    expect(accept).toHaveBeenCalledTimes(1);
    expect(button('Confirmă')?.disabled).toBe(true);
    expect(button('Confirmă')?.getAttribute('aria-busy')).toBe('true');
    expect(button('Renunță')?.disabled).toBe(true);
  });

  it('stays open when the network fails, and retries with the same key', async () => {
    await open({
      answers: [new HttpErrorResponse({ status: 0 }), Promise.resolve({})],
    });

    button('Confirmă')?.click();
    await settle();

    expect(panel()).not.toBeNull();
    expect(panel().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'Nu am putut trimite. Verifică conexiunea și încearcă din nou.',
    );
    button('Confirmă')?.click();
    await settle();

    expect(accept).toHaveBeenCalledTimes(2);
    expect(keyOf(1)).toBe(keyOf(0));
    await expect(result).resolves.toBe('accepted');
  });

  // @traces 314-FR-022
  it('keeps Confirmă disabled while offline', async () => {
    await open();
    offline.set(true);
    await settle();

    expect(button('Confirmă')?.disabled).toBe(true);
    button('Confirmă')?.click();
    expect(accept).not.toHaveBeenCalled();
  });
});

// @traces 314-FR-004
describe('the accept dialog: refusals', () => {
  it.each([
    [
      { code: 'invalid_transition', currentStatus: 'expired' },
      'Oferta a expirat',
      'The quote has expired',
    ],
    [
      { code: 'invalid_transition', currentStatus: 'withdrawn' },
      'Service‑ul a retras oferta',
      'The garage withdrew the quote',
    ],
    [
      { code: 'invalid_transition', currentStatus: 'accepted' },
      'Oferta a fost deja acceptată',
      'The quote was already accepted',
    ],
    [
      { code: 'invalid_transition', currentStatus: 'lost' },
      'Oferta nu mai este disponibilă',
      'The quote is no longer available',
    ],
    [
      { code: 'invalid_transition', currentStatus: 'declined_by_driver' },
      'Ai refuzat deja această ofertă',
      'You already declined this quote',
    ],
    [
      { code: 'booking_pending' },
      'Ai deja o programare în așteptare',
      'You already have a booking waiting',
    ],
    [
      { code: 'slot_passed' },
      'Ora propusă a trecut',
      'The proposed time has passed',
    ],
  ])(
    'says %j in the driver’s language, keeps the dialog and reads the panel again',
    async (body, ro, en) => {
      await open({ answers: [refusal(409, body)] });
      button('Confirmă')?.click();
      await settle();

      expect(panel().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
        ro,
      );
      expect(reread).toHaveBeenCalledTimes(1);
      expect(button('Confirmă')?.disabled).toBe(true);

      document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
        n.innerHTML = '';
      });
      TestBed.resetTestingModule();
      await open({ answers: [refusal(409, body)], language: 'en' });
      button('Confirm')?.click();
      await settle();

      expect(panel().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
        en,
      );
    },
  );

  it('says the server’s own words when it gives them, as for a suspended garage', async () => {
    await open({
      answers: [
        refusal(409, {
          code: 'invalid_transition',
          currentStatus: 'withdrawn',
          message: 'Service‑ul nu mai primește cereri',
        }),
      ],
    });
    button('Confirmă')?.click();
    await settle();

    expect(panel().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'Service‑ul nu mai primește cereri',
    );
  });

  it('says a quote no longer the driver’s is gone', async () => {
    await open({ answers: [refusal(404, { code: 'not_found' })] });
    button('Confirmă')?.click();
    await settle();

    expect(panel().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'Oferta nu mai există',
    );
    expect(reread).toHaveBeenCalledTimes(1);
  });

  it('starts a new key once the dialog is opened again', async () => {
    await open();
    button('Confirmă')?.click();
    await settle();
    const first = keyOf(0);
    document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
      n.innerHTML = '';
    });
    TestBed.resetTestingModule();

    await open();
    button('Confirmă')?.click();
    await settle();

    expect(keyOf(0)).not.toBe(first);
  });
});
