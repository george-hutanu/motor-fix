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

async function open(answers: unknown[] = [], language: 'ro' | 'en' = 'ro') {
  let call = 0;
  decline = jest.fn(() => {
    const answer = answers[Math.min(call++, answers.length - 1)];
    return answer instanceof Error || answer instanceof HttpErrorResponse
      ? Promise.reject(answer)
      : ((answer as Promise<unknown>) ?? Promise.resolve({}));
  });
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
const refusal = (status: number, body: Record<string, unknown>) =>
  new HttpErrorResponse({ error: body, status });

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  TestBed.resetTestingModule();
});

// @traces 314-FR-023
describe('the decline dialog, keyboard and focus', () => {
  it('closes on Escape exactly as Renunță, sending nothing', async () => {
    await open();

    panel().dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    await expect(result).resolves.toBe('cancelled');
    expect(decline).not.toHaveBeenCalled();
  });

  it('puts focus inside the dialog when it opens', async () => {
    await open();

    const dialog = panel().closest('[role="dialog"]');
    expect(dialog?.contains(document.activeElement)).toBe(true);
  });
});

// @traces 314-FR-010
describe('the decline dialog, failing calls', () => {
  it('stays open on a network failure with the network line, and a second Confirmă declines', async () => {
    await open([new HttpErrorResponse({ status: 0 }), Promise.resolve({})]);

    button('Confirmă')?.click();
    await settle();

    expect(alert()).toBe(
      'Nu am putut trimite. Verifică conexiunea și încearcă din nou.',
    );
    expect(button('Confirmă')?.disabled).toBe(false);
    button('Confirmă')?.click();
    await settle();
    expect(decline).toHaveBeenCalledTimes(2);
    await expect(result).resolves.toBe('declined');
  });

  it('treats a thrown plain Error as a network failure and stays open', async () => {
    await open([new Error('boom')]);

    button('Confirmă')?.click();
    await settle();

    expect(panel()).not.toBeNull();
    expect(alert()).toBe(
      'Nu am putut trimite. Verifică conexiunea și încearcă din nou.',
    );
  });

  it('says an already-declined quote in the server’s words and reads the panel again', async () => {
    await open([
      refusal(409, {
        code: 'invalid_transition',
        currentStatus: 'declined_by_driver',
        detail: 'Ai refuzat deja această ofertă',
      }),
    ]);

    button('Confirmă')?.click();
    await settle();

    expect(alert()).toBe('Ai refuzat deja această ofertă');
    expect(reread).toHaveBeenCalledTimes(1);
  });

  it('says an English refusal as the server words it', async () => {
    await open(
      [
        refusal(409, {
          code: 'invalid_transition',
          currentStatus: 'accepted',
          detail: 'The quote was already accepted',
        }),
      ],
      'en',
    );

    button('Confirm')?.click();
    await settle();

    expect(alert()).toBe('The quote was already accepted');
  });

  it('says a vanished quote is gone and reads the panel again', async () => {
    await open([refusal(404, { code: 'not_found' })]);

    button('Confirmă')?.click();
    await settle();

    expect(alert()).toBe('Oferta nu mai există');
    expect(reread).toHaveBeenCalledTimes(1);
  });

  it('shows a server message as text, never as markup', async () => {
    await open([
      refusal(409, {
        code: 'invalid_transition',
        detail: '<img src=x onerror=alert(1)>',
      }),
    ]);

    button('Confirmă')?.click();
    await settle();

    expect(alert()).toBe('<img src=x onerror=alert(1)>');
    expect(panel().querySelector('img')).toBeNull();
  });

  it('lets Renunță close an offline dialog with nothing sent', async () => {
    await open();
    offline.set(true);
    await settle();

    button('Renunță')?.click();
    await settle();

    await expect(result).resolves.toBe('cancelled');
    expect(decline).not.toHaveBeenCalled();
  });

  it('enables Confirmă again when the channel comes back online', async () => {
    await open();
    offline.set(true);
    await settle();
    offline.set(false);
    await settle();

    expect(button('Confirmă')?.disabled).toBe(false);
  });

  it('shows a spinner and disables both buttons while the call runs', async () => {
    await open([new Promise(() => undefined)]);

    button('Confirmă')?.click();
    await settle();

    expect(button('Confirmă')?.getAttribute('aria-busy')).toBe('true');
    expect(button('Confirmă')?.disabled).toBe(true);
    expect(button('Renunță')?.disabled).toBe(true);
  });
});
