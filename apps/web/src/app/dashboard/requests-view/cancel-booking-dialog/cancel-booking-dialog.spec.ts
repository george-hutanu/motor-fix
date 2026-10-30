import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BookingsService } from '@motor-fix/data-access';
import { formatSlot, I18n } from '@motor-fix/i18n';
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
  language = 'ro',
  startsIn = 3 * HOUR,
}: {
  language?: 'ro' | 'en';
  startsIn?: number;
} = {}) {
  cancel = jest.fn(async () => ({ status: 'cancelled' }));
  data = {
    bookingId: 'booking-1',
    garage: 'Service Auto Militari',
    startsAt: new Date(Date.now() + startsIn).toISOString(),
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
describe('the cancel booking dialog: what it asks', () => {
  it('asks to cancel, naming the garage and the slot under the title', async () => {
    await open();

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Anulezi programarea?',
    );
    expect(text()).toContain(
      `Service Auto Militari · ${formatSlot(data.startsAt, 'ro', new Date())}`,
    );
  });

  it('offers the four driver reasons in order, none picked, the confirm disabled', async () => {
    await open();

    expect(radios().map(labelOf)).toEqual([
      'Mi s-au schimbat planurile',
      'Am găsit alt service',
      'S-a rezolvat problema',
      'Altceva',
    ]);
    expect(radios().some((r) => r.checked)).toBe(false);
    expect(new Set(radios().map((r) => r.name)).size).toBe(1);
    expect(button('Anulează programarea')?.disabled).toBe(true);

    await pick('Altceva');

    expect(button('Anulează programarea')?.disabled).toBe(false);
  });

  it('counts the details up to 500 and refuses more before any call', async () => {
    await open();
    await pick('Altceva');
    const counter = panel().querySelector(
      `#${details().getAttribute('aria-describedby')}`,
    );

    expect(text()).toContain('Detalii (opțional)');
    expect(details().getAttribute('maxlength')).toBe('500');
    expect(counter?.textContent?.trim()).toBe('0/500');
    expect(counter?.getAttribute('aria-live')).toBe('polite');

    await write('a'.repeat(120));
    expect(counter?.textContent?.trim()).toBe('120/500');

    await write('a'.repeat(500));
    expect(counter?.textContent?.trim()).toBe('500/500');
    expect(button('Anulează programarea')?.disabled).toBe(false);

    await write('a'.repeat(501));
    expect(button('Anulează programarea')?.disabled).toBe(true);
    await press();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('reads in English', async () => {
    await open({ language: 'en' });

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Cancel the booking?',
    );
    expect(radios().map(labelOf)).toEqual([
      'Plans changed',
      'Found another garage',
      'Problem solved',
      'Other',
    ]);
    expect(text()).toContain('Details (optional)');
    expect(button('Cancel the booking')).toBeDefined();
    expect(button('Keep the booking')).toBeDefined();
  });

  it('closes on Păstrează programarea sending nothing', async () => {
    await open();

    await press('Păstrează programarea');

    await expect(result).resolves.toBe('cancelled');
    expect(cancel).not.toHaveBeenCalled();
  });
});

// @traces 1385-FR-005
describe('the cancel booking dialog: the late warning', () => {
  it('says nothing three hours ahead', async () => {
    await open({ startsIn: 3 * HOUR });

    expect(warning()).toBeUndefined();
  });

  it('warns in a status region at one hour thirty', async () => {
    await open({ startsIn: 90 * MINUTE });

    expect(warning()?.textContent?.trim()).toBe(
      'Anulezi cu mai puțin de 2 ore înainte. Se înregistrează ca anulare târzie, fără penalizare.',
    );
  });

  it('says nothing at exactly two hours before, then warns once the minute passes', async () => {
    jest.useFakeTimers({
      advanceTimers: true,
      now: new Date('2026-10-20T08:00:00.000Z'),
    });
    cancel = jest.fn();
    data = {
      bookingId: 'booking-1',
      garage: 'Service Auto Militari',
      startsAt: '2026-10-20T10:00:00.000Z',
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
    const host = TestBed.createComponent(Host);
    result = host.componentInstance.overlays.open(CancelBookingDialog, {
      data,
      shape: 'dialog',
      title: 'driver.requests.cancelBookingDialog.title',
    });
    await settle();

    expect(warning()).toBeUndefined();

    jest.advanceTimersByTime(MINUTE);
    await settle();

    expect(warning()).toBeDefined();
  });
});

// @traces 1385-FR-006
// @traces 1385-FR-010
describe('the cancel booking dialog: cancelling', () => {
  it('sends the reason and the trimmed details, then closes with Programare anulată', async () => {
    await open();
    await pick('Am găsit alt service');
    await write('  Am găsit mai aproape.  ');

    await press();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel.mock.calls[0][0]).toEqual({
      body: { note: 'Am găsit mai aproape.', reason: 'found_another_garage' },
      id: 'booking-1',
    });
    await expect(result).resolves.toBe('done');
    expect(toast).toHaveBeenCalledWith('Programare anulată');
  });

  it('sends no note for details that are only spaces', async () => {
    await open();
    await pick('Mi s-au schimbat planurile');
    await write('   \n ');

    await press();

    expect(cancel.mock.calls[0][0].body).toEqual({ reason: 'plans_changed' });
    await expect(result).resolves.toBe('done');
  });

  it('says Booking cancelled in English', async () => {
    await open({ language: 'en' });
    await pick('Problem solved');

    await press('Cancel the booking');

    await expect(result).resolves.toBe('done');
    expect(toast).toHaveBeenCalledWith('Booking cancelled');
  });

  // @traces 1315-optimistic-toggles-FR-009
  it('disables both buttons and every field while cancelling, the dialog open', async () => {
    await open();
    await pick('Altceva');
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
    expect(radios().every((r) => r.matches(':disabled'))).toBe(true);
    expect(details().matches(':disabled')).toBe(true);
    expect(button('Păstrează programarea')?.matches(':disabled')).toBe(true);
    expect(panel()).not.toBeNull();

    answer({ status: 'cancelled' });
    await settle();
    await expect(result).resolves.toBe('done');
  });

  it('closes on a 409 invalid_transition with Programarea nu mai poate fi anulată.', async () => {
    await open();
    await pick('Altceva');
    cancel.mockRejectedValueOnce(
      refusal(409, { code: 'invalid_transition', status: 409 }),
    );

    await press();

    await expect(result).resolves.toBe('refused');
    expect(toast).toHaveBeenCalledWith('Programarea nu mai poate fi anulată.');
  });

  it('closes on a 404 with the shared not found text', async () => {
    await open();
    await pick('Altceva');
    cancel.mockRejectedValueOnce(
      refusal(404, { code: 'not_found', status: 404 }),
    );

    await press();

    await expect(result).resolves.toBe('refused');
    expect(toast).toHaveBeenCalledWith(
      'Nu mai găsim ce voiai să salvezi. Reîncarcă pagina.',
    );
  });

  it('stays open after another failure with the reason and details kept, and retries', async () => {
    await open();
    await pick('S-a rezolvat problema');
    await write('Merge acum.');
    cancel.mockRejectedValueOnce(refusal(500, { code: 'internal_error' }));

    await press();

    expect(text()).toContain('Ceva nu a mers la noi. Încearcă din nou.');
    expect(radio('S-a rezolvat problema').checked).toBe(true);
    expect(details().value).toBe('Merge acum.');
    expect(button('Anulează programarea')?.disabled).toBe(false);
    expect(button('Păstrează programarea')?.disabled).toBe(false);
    expect(toast).not.toHaveBeenCalled();

    await press();

    expect(cancel).toHaveBeenCalledTimes(2);
    await expect(result).resolves.toBe('done');
  });

  it('disables the confirm offline with the shared offline line', async () => {
    const online = jest.spyOn(navigator, 'onLine', 'get');
    online.mockReturnValue(false);
    await open();
    await pick('Altceva');
    window.dispatchEvent(new Event('offline'));
    await settle();

    expect(button('Anulează programarea')?.disabled).toBe(true);
    expect(text()).toContain(
      'Nu ești conectat. Încearcă din nou când revine conexiunea.',
    );

    online.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await settle();

    expect(button('Anulează programarea')?.disabled).toBe(false);
  });
});
