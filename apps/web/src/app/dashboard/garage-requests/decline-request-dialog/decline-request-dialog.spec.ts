import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GarageRequestsService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';

import {
  type DeclineRequestData,
  DeclineRequestDialog,
  type DeclineRequestResult,
} from './decline-request-dialog';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const DATA: DeclineRequestData = {
  car: 'Renault Mégane · 2019',
  driver: 'Vlad P.',
  requestId: 'req-1',
};

const DECLINED = {
  answeredAt: '2026-10-10T09:00:00.000Z',
  declinedAt: '2026-10-10T09:00:00.000Z',
  declineReason: 'need_to_see_car',
  source: 'search',
  status: 'declined',
};

let decline: jest.Mock;
let result: Promise<DeclineRequestResult | 'cancelled'>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open({ language = 'ro' }: { language?: 'ro' | 'en' } = {}) {
  decline = jest.fn(async () => DECLINED);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: GarageRequestsService,
        useValue: { garageRequestsControllerDecline: decline },
      },
    ],
  });
  await TestBed.inject(I18n).enter('garage');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<
    DeclineRequestResult,
    DeclineRequestData
  >(DeclineRequestDialog, {
    data: DATA,
    shape: 'dialog',
    title: 'garage.requests.decline.title',
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

const radios = () => [
  ...panel().querySelectorAll<HTMLInputElement>('input[type="radio"]'),
];

// A radio's visible label.
const labelOf = (radio: HTMLInputElement) =>
  (radio.closest('label')?.textContent ?? '').replace(/\s+/g, ' ').trim();

const radio = (label: string) =>
  radios().find((r) => labelOf(r) === label) as HTMLInputElement;

async function pick(label: string) {
  radio(label).click();
  await settle();
}

const press = async (name = 'Refuză') => {
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

// @traces 345-FR-014
describe('the decline dialog: what it asks', () => {
  it('asks why, naming the driver and the car under the title', async () => {
    await open();

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'De ce refuzați cererea?',
    );
    expect(text()).toContain('Vlad P. · Renault Mégane · 2019');
  });

  it('offers exactly the four reasons, in order, none picked', async () => {
    await open();

    expect(radios().map(labelOf)).toEqual([
      'Suntem ocupați complet',
      'Nu facem această lucrare',
      'Nu lucrăm pe această marcă, model sau motor',
      'Trebuie să vedem mașina mai întâi',
    ]);
    expect(radios().some((r) => r.checked)).toBe(false);
    expect(new Set(radios().map((r) => r.name)).size).toBe(1);
  });

  // Every text in both languages; the layout half is the QA sweep's.
  // @traces 345-FR-019
  it('reads in English', async () => {
    await open({ language: 'en' });

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Why are you declining the request?',
    );
    expect(radios().map(labelOf)).toEqual([
      'We are fully booked',
      "We don't do this job",
      "We don't work on this make, model or engine",
      'We need to see the car first',
    ]);
    expect(button('Decline')).toBeDefined();
    expect(button('Cancel')).toBeDefined();
  });

  it('keeps Refuză disabled until a reason is picked', async () => {
    await open();

    expect(button('Refuză')?.disabled).toBe(true);

    await pick('Suntem ocupați complet');

    expect(button('Refuză')?.disabled).toBe(false);
  });

  it('closes on Renunță without declining', async () => {
    await open();

    await press('Renunță');

    await expect(result).resolves.toBe('cancelled');
    expect(decline).not.toHaveBeenCalled();
  });
});

// @traces 345-FR-014
// @traces 345-FR-015
describe('the decline dialog: declining', () => {
  it('declines with the picked reason, then closes with Cerere refuzată', async () => {
    await open();
    await pick('Trebuie să vedem mașina mai întâi');

    await press();

    expect(decline).toHaveBeenCalledTimes(1);
    expect(decline.mock.calls[0][0]).toMatchObject({
      body: { reason: 'need_to_see_car' },
      id: 'req-1',
    });
    await expect(result).resolves.toBe('declined');
    expect(toast).toHaveBeenCalledWith('Cerere refuzată');
  });

  it('says Request declined in English', async () => {
    await open({ language: 'en' });
    await pick('We are fully booked');

    await press('Decline');

    await expect(result).resolves.toBe('declined');
    expect(toast).toHaveBeenCalledWith('Request declined');
  });

  it('spins Refuză and disables the reasons and Renunță while declining, the dialog open', async () => {
    await open();
    await pick('Suntem ocupați complet');
    let answer: (value: unknown) => void = () => undefined;
    decline.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );

    await press();

    const submit = panel().querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    expect(submit.getAttribute('aria-busy')).toBe('true');
    expect(submit.querySelector('.mf-task-spinner')).not.toBeNull();
    expect(radios().every((r) => r.matches(':disabled'))).toBe(true);
    expect(button('Renunță')?.matches(':disabled')).toBe(true);

    answer(DECLINED);
    await settle();
    await expect(result).resolves.toBe('declined');
  });

  it.each([
    ['already_answered', 'Altcineva a răspuns deja la această cerere'],
    ['request_not_open', 'Cererea nu mai este deschisă'],
  ])(
    'closes on a 409 %s with its message as the toast',
    async (code, message) => {
      await open();
      await pick('Suntem ocupați complet');
      decline.mockRejectedValueOnce(refusal(409, { code, status: 409 }));

      await press();

      await expect(result).resolves.toBe('refused');
      expect(toast).toHaveBeenCalledWith(message);
    },
  );

  it.each([
    [403, 'forbidden', 'Nu ai dreptul să răspunzi la cereri'],
    [404, 'not_found', 'Cererea nu mai este disponibilă'],
  ])(
    'closes on a %s with its message as the toast',
    async (status, code, message) => {
      await open();
      await pick('Suntem ocupați complet');
      decline.mockRejectedValueOnce(refusal(status, { code, status }));

      await press();

      await expect(result).resolves.toBe('refused');
      expect(toast).toHaveBeenCalledWith(message);
    },
  );

  it('stays open after another failure with the reason kept, and retries', async () => {
    await open();
    await pick('Nu facem această lucrare');
    decline.mockRejectedValueOnce(refusal(500, { code: 'internal_error' }));

    await press();

    expect(text()).toContain('Ceva nu a mers la noi. Încearcă din nou.');
    expect(radio('Nu facem această lucrare').checked).toBe(true);
    expect(toast).not.toHaveBeenCalled();

    await press();

    expect(decline).toHaveBeenCalledTimes(2);
    expect(decline.mock.calls[1][0].body).toEqual({ reason: 'job_not_done' });
    await expect(result).resolves.toBe('declined');
  });

  it('disables Refuză offline with Ești offline and keeps the reason', async () => {
    const online = jest.spyOn(navigator, 'onLine', 'get');
    online.mockReturnValue(false);
    await open();
    await pick('Suntem ocupați complet');
    window.dispatchEvent(new Event('offline'));
    await settle();

    expect(button('Refuză')?.disabled).toBe(true);
    expect(text()).toContain('Ești offline');

    online.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await settle();

    expect(button('Refuză')?.disabled).toBe(false);
    expect(radio('Suntem ocupați complet').checked).toBe(true);
  });
});
