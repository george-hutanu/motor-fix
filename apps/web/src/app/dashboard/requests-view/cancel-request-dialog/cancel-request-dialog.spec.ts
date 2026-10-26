import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { QuoteRequestsService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';

import {
  type CancelRequestData,
  CancelRequestDialog,
  type CancelRequestResult,
} from './cancel-request-dialog';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const DATA: CancelRequestData = {
  car: 'Dacia Logan 2017',
  requestId: 'req-1',
  what: 'Schimb ulei',
};

let cancel: jest.Mock;
let result: Promise<CancelRequestResult | 'cancelled'>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open({ language = 'ro' }: { language?: 'ro' | 'en' } = {}) {
  cancel = jest.fn(async () => ({ id: 'req-1', status: 'closed' }));
  TestBed.configureTestingModule({
    providers: [
      {
        provide: QuoteRequestsService,
        useValue: { cancelRequestControllerCancel: cancel },
      },
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<
    CancelRequestResult,
    CancelRequestData
  >(CancelRequestDialog, {
    data: DATA,
    shape: 'dialog',
    title: 'driver.requests.cancelRequestDialog.title',
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const text = () => (panel()?.textContent ?? '').replace(/\s+/g, ' ');
const buttons = () =>
  [...panel().querySelectorAll('button')].filter(
    (b) => !b.closest('header') && b.textContent?.trim(),
  );
const button = (name: string) =>
  buttons().find((b) => b.textContent?.replace(/\s+/g, ' ').trim() === name) as
    | HTMLButtonElement
    | undefined;

const press = async (name = 'Anulează cererea') => {
  button(name)?.click();
  await settle();
};

const refusal = (status: number, body: Record<string, unknown>) =>
  new HttpErrorResponse({ error: body, status });

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  (toast as unknown as jest.Mock).mockClear();
  jest.restoreAllMocks();
  TestBed.resetTestingModule();
});

// @traces 1385-FR-004
// @traces 1385-FR-007
describe('the cancel request dialog: what it asks', () => {
  it('asks to cancel, naming the car and the jobs, with what follows', async () => {
    await open();

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Anulezi cererea?',
    );
    expect(text()).toContain('Dacia Logan 2017 · Schimb ulei');
    expect(text()).toContain(
      'Service‑urile care așteaptă vor fi anunțate; ofertele primite se pierd.',
    );
    expect(panel().querySelectorAll('input, textarea')).toHaveLength(0);
    expect(button('Anulează cererea')).toBeDefined();
    expect(button('Păstrează cererea')).toBeDefined();
  });

  it('reads in English', async () => {
    await open({ language: 'en' });

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Cancel the request?',
    );
    expect(text()).toContain(
      'The garages still waiting will be told; the quotes received are lost.',
    );
    expect(button('Cancel the request')).toBeDefined();
    expect(button('Keep the request')).toBeDefined();
  });

  it('closes on Păstrează cererea sending nothing', async () => {
    await open();

    await press('Păstrează cererea');

    await expect(result).resolves.toBe('cancelled');
    expect(cancel).not.toHaveBeenCalled();
  });

  it('closes on Escape sending nothing', async () => {
    await open();

    panel().dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    await expect(result).resolves.toBe('cancelled');
    expect(cancel).not.toHaveBeenCalled();
  });
});

// @traces 1385-FR-006
// @traces 1385-FR-010
describe('the cancel request dialog: cancelling', () => {
  it('cancels the request, then closes with Cerere anulată', async () => {
    await open();

    await press();

    expect(cancel).toHaveBeenCalledWith({ id: 'req-1' });
    await expect(result).resolves.toBe('done');
    expect(toast).toHaveBeenCalledWith('Cerere anulată');
  });

  it('says Request cancelled in English', async () => {
    await open({ language: 'en' });

    await press('Cancel the request');

    await expect(result).resolves.toBe('done');
    expect(toast).toHaveBeenCalledWith('Request cancelled');
  });

  it('disables both buttons while cancelling, the dialog open', async () => {
    await open();
    let answer: (value: unknown) => void = () => undefined;
    cancel.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );

    await press();

    const submit = panel().querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    expect(submit.getAttribute('aria-busy')).toBe('true');
    expect(button('Păstrează cererea')?.matches(':disabled')).toBe(true);

    answer({ id: 'req-1', status: 'closed' });
    await settle();
    await expect(result).resolves.toBe('done');
  });

  it('closes on a 409 invalid_transition with Cererea nu mai poate fi anulată.', async () => {
    await open();
    cancel.mockRejectedValueOnce(
      refusal(409, { code: 'invalid_transition', status: 409 }),
    );

    await press();

    await expect(result).resolves.toBe('refused');
    expect(toast).toHaveBeenCalledWith('Cererea nu mai poate fi anulată.');
  });

  it('closes on a 404 with the shared not found text', async () => {
    await open();
    cancel.mockRejectedValueOnce(
      refusal(404, { code: 'not_found', status: 404 }),
    );

    await press();

    await expect(result).resolves.toBe('refused');
    expect(toast).toHaveBeenCalledWith(
      'Nu mai găsim ce voiai să salvezi. Reîncarcă pagina.',
    );
  });

  it('stays open after another failure with the shared error line, and retries', async () => {
    await open();
    cancel.mockRejectedValueOnce(refusal(500, { code: 'internal_error' }));

    await press();

    expect(text()).toContain('Ceva nu a mers la noi. Încearcă din nou.');
    expect(toast).not.toHaveBeenCalled();

    await press();

    expect(cancel).toHaveBeenCalledTimes(2);
    await expect(result).resolves.toBe('done');
  });

  it('disables the confirm offline with the shared offline line', async () => {
    const online = jest.spyOn(navigator, 'onLine', 'get');
    online.mockReturnValue(false);
    await open();
    window.dispatchEvent(new Event('offline'));
    await settle();

    expect(button('Anulează cererea')?.disabled).toBe(true);
    expect(text()).toContain(
      'Nu ești conectat. Încearcă din nou când revine conexiunea.',
    );
  });
});
