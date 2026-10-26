import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BookingsService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';

import {
  type CancelBookingData,
  CancelBookingDialog,
  type CancelBookingResult,
} from './cancel-booking-dialog';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const HOUR = 3_600_000;
const MINUTE = 60_000;

let cancel: jest.Mock;
let result: Promise<CancelBookingResult | 'cancelled'>;
let data: CancelBookingData;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open({
  garage = 'Service Auto Militari',
  language = 'ro',
  startsAt,
  startsIn = 3 * HOUR,
}: {
  garage?: string;
  language?: 'ro' | 'en';
  startsAt?: string;
  startsIn?: number;
} = {}) {
  cancel = jest.fn(async () => ({ status: 'cancelled' }));
  data = {
    bookingId: 'booking-1',
    garage,
    startsAt: startsAt ?? new Date(Date.now() + startsIn).toISOString(),
  };
  TestBed.configureTestingModule({
    providers: [
      {
        provide: BookingsService,
        useValue: { cancelBookingControllerCancel: cancel },
      },
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<
    CancelBookingResult,
    CancelBookingData
  >(CancelBookingDialog, {
    data,
    shape: 'dialog',
    title: 'driver.requests.cancelBookingDialog.title',
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
const labelOf = (radio: HTMLInputElement) =>
  (radio.closest('label')?.textContent ?? '').replace(/\s+/g, ' ').trim();
const radio = (label: string) =>
  radios().find((r) => labelOf(r) === label) as HTMLInputElement;
const details = () => panel().querySelector('textarea') as HTMLTextAreaElement;
const warning = () =>
  [...panel().querySelectorAll('[role="status"]')].find((n) =>
    n.textContent?.includes('2 ore'),
  );

async function pick(label: string) {
  radio(label).click();
  await settle();
}

async function write(value: string) {
  details().value = value;
  details().dispatchEvent(new Event('input'));
  await settle();
}

const press = async (name = 'Anulează programarea') => {
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
  jest.useRealTimers();
  TestBed.resetTestingModule();
});

// @traces 1385-FR-005
// @traces 1385-FR-006
describe('the cancel booking dialog under hostile use', () => {
  it('sends one call when the confirm is clicked twice before the answer', async () => {
    await open();
    await pick('Altceva');
    cancel.mockReturnValueOnce(new Promise(() => undefined));

    button('Anulează programarea')?.click();
    button('Anulează programarea')?.click();
    await settle();

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('stays open on Escape while the call runs', async () => {
    await open();
    await pick('Altceva');
    let answer: (value: unknown) => void = () => undefined;
    cancel.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await press();

    panel().dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    expect(panel()).not.toBeNull();
    answer({ status: 'cancelled' });
    await settle();
    await expect(result).resolves.toBe('done');
  });

  it('shows a garage name with markup as text, not as elements', async () => {
    await open({ garage: '<img src=x onerror=alert(1)>Auto' });

    expect(panel().querySelector('img')).toBeNull();
    expect(text()).toContain('<img src=x onerror=alert(1)>Auto');
  });

  it('keeps inner line breaks and trims only the ends of the note', async () => {
    await open();
    await pick('Altceva');
    await write('\n  una\n\ndoua\t \n');

    await press();

    expect(cancel.mock.calls[0][0].body).toEqual({
      note: 'una\n\ndoua',
      reason: 'other',
    });
  });

  it('sends the reason picked last when the driver changes their mind', async () => {
    await open();
    await pick('Altceva');
    await pick('S-a rezolvat problema');

    await press();

    expect(cancel.mock.calls[0][0].body).toEqual({ reason: 'problem_solved' });
  });

  it('keeps the dialog, the reason and the details on a 400 validation_failed', async () => {
    await open();
    await pick('Altceva');
    await write('nota');
    cancel.mockRejectedValueOnce(
      refusal(400, { code: 'validation_failed', status: 400 }),
    );

    await press();

    expect(panel()).not.toBeNull();
    expect(radio('Altceva').checked).toBe(true);
    expect(details().value).toBe('nota');
    expect(toast).not.toHaveBeenCalled();
    expect(text()).toContain('Verifică câmpurile marcate.');
  });

  it('keeps the dialog open on a lost connection (status 0)', async () => {
    await open();
    await pick('Altceva');
    cancel.mockRejectedValueOnce(
      new HttpErrorResponse({ error: new ProgressEvent('error'), status: 0 }),
    );

    await press();

    expect(panel()).not.toBeNull();
    expect(toast).not.toHaveBeenCalled();
    expect(button('Anulează programarea')?.disabled).toBe(false);
  });

  it('keeps the dialog open when the call throws something that is not an HTTP error', async () => {
    await open();
    await pick('Altceva');
    cancel.mockRejectedValueOnce(new TypeError('boom'));

    await press();

    expect(panel()).not.toBeNull();
    expect(toast).not.toHaveBeenCalled();
    expect(button('Anulează programarea')?.disabled).toBe(false);
  });

  it('warns for a slot that already passed', async () => {
    await open({ startsIn: -10 * MINUTE });

    expect(warning()).toBeDefined();
  });

  it('still renders its title and reasons for a start time that is not a date', async () => {
    await open({ startsAt: 'not-a-date' });

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Anulezi programarea?',
    );
    expect(radios()).toHaveLength(4);
  });

  it('sends nothing when the confirm is pressed with no reason chosen', async () => {
    await open();
    await write('doar detalii');

    await press();

    expect(cancel).not.toHaveBeenCalled();
    expect(panel()).not.toBeNull();
  });
});
