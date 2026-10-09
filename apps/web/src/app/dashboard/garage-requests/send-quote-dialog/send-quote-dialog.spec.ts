import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { todayInBucharest } from '@motor-fix/contracts/garage-hours';
import {
  type GarageQuoteDto,
  type GarageRequestDetailJobDto,
  type GarageRequestDto,
  GarageRequestsService,
  QuotesService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';

import {
  type SendQuoteData,
  SendQuoteDialog,
  type SendQuoteResult,
} from './send-quote-dialog';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const job = (
  over: Partial<GarageRequestDetailJobDto> = {},
): GarageRequestDetailJobDto => ({
  id: 'rj-1',
  jobTypeId: 'job-brakes',
  nameEn: 'Front brakes',
  nameRo: 'Frâne față',
  offered: true,
  position: 0,
  price: { durationMinutes: 120, fromBani: 70_000, toBani: 100_000 },
  ...over,
});

const GEARBOX = job({
  id: 'rj-2',
  jobTypeId: 'job-gearbox',
  nameEn: 'Gearbox',
  nameRo: 'Cutie de viteze',
  offered: false,
  position: 1,
  price: { durationMinutes: 600, fromBani: 300_000, toBani: 500_000 },
});

const detail = (over: Partial<GarageRequestDto> = {}): GarageRequestDto => ({
  booking: null,
  car: {
    brand: 'BMW',
    engine: null,
    fuel: 'petrol',
    model: '330i',
    year: 2021,
  },
  closedAt: null,
  closedReason: null,
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  description: null,
  descriptionLine: null,
  driver: { shortName: 'Vlad P.' },
  expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  id: 'req-1',
  jobs: [job()],
  quote: null,
  recipient: {
    answeredAt: null,
    declinedAt: null,
    declineReason: null,
    source: 'search',
    status: 'waiting',
  },
  status: 'sent',
  ...over,
});

const QUOTE = { id: 'quote-1' } as GarageQuoteDto;

let read: jest.Mock;
let send: jest.Mock;
let result: Promise<SendQuoteResult | 'cancelled'>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  request: GarageRequestDto = detail(),
  {
    language = 'ro',
    readFails = false,
  }: { language?: 'ro' | 'en'; readFails?: boolean } = {},
) {
  read = jest.fn(async () => request);
  if (readFails) read.mockRejectedValueOnce(new Error('network'));
  send = jest.fn(async () => QUOTE);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: GarageRequestsService,
        useValue: { garageRequestsControllerGet: read },
      },
      { provide: QuotesService, useValue: { quotesControllerSend: send } },
    ],
  });
  await TestBed.inject(I18n).enter('garage');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<SendQuoteResult, SendQuoteData>(
    SendQuoteDialog,
    {
      data: { requestId: request.id },
      shape: 'dialog',
      title: 'garage.quotes.send.title',
    },
  );
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const text = () => (panel()?.textContent ?? '').replace(/\s+/g, ' ');

const button = (name: string) =>
  [...panel().querySelectorAll('button')].find(
    (b) => b.textContent?.replace(/\s+/g, ' ').trim() === name,
  ) as HTMLButtonElement | undefined;

// A field by its label's text.
const field = <T extends HTMLElement = HTMLInputElement>(label: string) => {
  const found = [...panel().querySelectorAll('label')].find(
    (l) => l.textContent?.trim() === label,
  );
  return document.getElementById(found?.htmlFor ?? '') as unknown as T;
};

// The message the field points at with aria-describedby.
const said = (label: string) =>
  field(label)
    .getAttribute('aria-describedby')
    ?.split(' ')
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
    .join(' ')
    .trim() ?? '';

async function fill(label: string, value: string) {
  const input = field<HTMLInputElement | HTMLSelectElement>(label);
  input.value = value;
  input.dispatchEvent(
    new Event(input.tagName === 'SELECT' ? 'change' : 'input', {
      bubbles: true,
    }),
  );
  input.dispatchEvent(new Event('blur'));
  await settle();
}

async function blur(label: string) {
  field(label).dispatchEvent(new Event('blur'));
  await settle();
}

const DAY = 86_400_000;
const tomorrow = () => todayInBucharest(new Date(Date.now() + DAY));

// The Bucharest wall clock of an instant, "2026-10-10 09:00".
const bucharest = (iso: string) =>
  new Intl.DateTimeFormat('sv-SE', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Bucharest',
    year: 'numeric',
  }).format(new Date(iso));

async function fillValid() {
  await fill('Preț de la (lei)', '650');
  await fill('până la (lei)', '800');
  await fill('Ore', '2');
  await fill('Minute', '0');
  await fill('Ziua', tomorrow());
  await fill('Ora', '09:00');
}

const press = async () => {
  button('Trimite')?.click();
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

// @traces 344-FR-010, 344-FR-011
describe('the send-quote dialog: what it names and starts with', () => {
  it('reads the request, names the driver and the job under the title and pre-fills the price list’s brand range', async () => {
    await open();

    expect(read).toHaveBeenCalledWith({ id: 'req-1' });
    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Trimite oferta',
    );
    expect(text()).toContain('Vlad P. · Frâne față');
    expect(text()).not.toContain('Nu face');
    expect(field('Preț de la (lei)').value).toBe('700');
    expect(field('până la (lei)').value).toBe('1000');
    expect(field('Ore').value).toBe('2');
    expect(field<HTMLSelectElement>('Minute').value).toBe('0');
    expect(field('Ziua').value).toBe('');
    expect(field('Ora').value).toBe('');
    expect(field<HTMLTextAreaElement>('Mesaj pentru client').value).toBe('');
  });

  it('holds the fields, the hint and the buttons in order, with no mechanic field', async () => {
    await open();

    const names = [...panel().querySelectorAll('label, legend')].map((n) =>
      n.textContent?.trim(),
    );
    const order = [
      'Preț de la (lei)',
      'până la (lei)',
      'Durată',
      'Primul loc liber',
      'Mesaj pentru client',
    ].map((name) => names.indexOf(name));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text()).toContain(
      'Intervalul acoperă piese și manoperă, cu TVA, pentru mașina exactă a clientului; prețul final se stabilește după ce vezi mașina.',
    );
    expect(button('Renunță')).toBeDefined();
    expect(button('Trimite')).toBeDefined();
    expect(text()).not.toContain('Mecanic');
    expect(text()).toContain('0/500');
  });

  it('names the jobs left out and pre-fills from the offered jobs only', async () => {
    await open(detail({ jobs: [job(), GEARBOX] }));

    expect(text()).toContain('Vlad P. · Frâne față');
    expect(text()).not.toContain('Vlad P. · Frâne față · Cutie de viteze');
    expect(text()).toContain('Nu face: Cutie de viteze');
    expect(field('Preț de la (lei)').value).toBe('700');
    expect(field('până la (lei)').value).toBe('1000');
    expect(field('Ore').value).toBe('2');
  });

  it('sums the included jobs, leaving the top empty when one row is open-ended', async () => {
    await open(
      detail({
        jobs: [
          job(),
          job({
            id: 'rj-3',
            jobTypeId: 'job-oil',
            nameRo: 'Schimb ulei',
            position: 1,
            price: { durationMinutes: 30, fromBani: 20_000, toBani: null },
          }),
        ],
      }),
    );

    expect(text()).toContain('Vlad P. · Frâne față · Schimb ulei');
    expect(field('Preț de la (lei)').value).toBe('900');
    expect(field('până la (lei)').value).toBe('');
    expect(field('Ore').value).toBe('2');
    expect(field<HTMLSelectElement>('Minute').value).toBe('30');
  });

  it('starts with the default range and no duration when the row has none', async () => {
    await open(
      detail({
        jobs: [
          job({
            price: { durationMinutes: null, fromBani: 60_000, toBani: 90_000 },
          }),
        ],
      }),
    );

    expect(field('Preț de la (lei)').value).toBe('600');
    expect(field('până la (lei)').value).toBe('900');
    expect(field('Ore').value).toBe('');
  });

  it('sums the jobs that have a price row, a job with none adding nothing', async () => {
    await open(
      detail({
        jobs: [
          job(),
          job({
            id: 'rj-3',
            jobTypeId: 'job-oil',
            nameRo: 'Schimb ulei',
            position: 1,
            price: null,
          }),
        ],
      }),
    );

    expect(field('Preț de la (lei)').value).toBe('700');
    expect(field('până la (lei)').value).toBe('1000');
    expect(field('Ore').value).toBe('2');
  });

  it('sums the durations it has when one job’s row has none', async () => {
    await open(
      detail({
        jobs: [
          job(),
          job({
            id: 'rj-3',
            jobTypeId: 'job-oil',
            nameRo: 'Schimb ulei',
            position: 1,
            price: { durationMinutes: null, fromBani: 20_000, toBani: 30_000 },
          }),
        ],
      }),
    );

    expect(field('Preț de la (lei)').value).toBe('900');
    expect(field('până la (lei)').value).toBe('1300');
    expect(field('Ore').value).toBe('2');
    expect(field<HTMLSelectElement>('Minute').value).toBe('0');
  });

  it('says the read failed and reads again on Încearcă din nou', async () => {
    await open(detail(), { readFails: true });

    expect(panel().querySelector('p[role="alert"]')).not.toBeNull();
    expect(field('Preț de la (lei)')).toBeNull();

    button('Încearcă din nou')?.click();
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(panel().querySelector('p[role="alert"]')).toBeNull();
    expect(field('Preț de la (lei)').value).toBe('700');
  });

  it('starts empty when the price list has no row for the job', async () => {
    await open(detail({ jobs: [job({ price: null })] }));

    expect(field('Preț de la (lei)').value).toBe('');
    expect(field('până la (lei)').value).toBe('');
    expect(field('Ore').value).toBe('');
  });

  it('keeps a duration sum over 5 days as it is, marked, with Trimite disabled', async () => {
    await open(
      detail({
        jobs: [
          job({
            price: {
              durationMinutes: 7_500,
              fromBani: 70_000,
              toBani: 100_000,
            },
          }),
        ],
      }),
    );

    expect(field('Ore').value).toBe('125');
    expect(said('Ore')).toContain('Durata maximă este 5 zile');
    expect(button('Trimite')?.disabled).toBe(true);
  });

  it('names the description’s first line, cut at 60 characters, for a request with no jobs', async () => {
    const line = `Scârțâie ceva în față ${'la frânare '.repeat(8)}`.trim();
    await open(detail({ descriptionLine: line, jobs: [] }));

    expect(text()).toContain(`Vlad P. · ${line.slice(0, 60)}`);
    expect(text()).not.toContain(line.slice(0, 61));
    expect(field('Preț de la (lei)').value).toBe('');
  });

  it('reads in English', async () => {
    await open(detail({ jobs: [job(), GEARBOX] }), { language: 'en' });

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Send a quote',
    );
    expect(text()).toContain('Vlad P. · Front brakes');
    expect(text()).toContain('Not offered: Gearbox');
    expect(field('Price from (lei)').value).toBe('700');
    expect(field('to (lei)').value).toBe('1000');
    expect(field('Message to the customer')).toBeTruthy();
    expect(text()).toContain('Duration');
    expect(text()).toContain('First free slot');
    expect(text()).toContain(
      'The range covers parts and labour, VAT included, for the customer’s exact car; the final price is set after you see the car.',
    );
    expect(button('Cancel')).toBeDefined();
    expect(button('Send')).toBeDefined();
  });
});

// @traces 344-FR-012
describe('the send-quote dialog: what it refuses', () => {
  it('keeps Trimite disabled while a required field is empty and says Obligatoriu on blur', async () => {
    await open(detail({ jobs: [job({ price: null })] }));

    expect(button('Trimite')?.disabled).toBe(true);
    await blur('Preț de la (lei)');
    expect(said('Preț de la (lei)')).toContain('Obligatoriu');
    await blur('Ziua');
    expect(said('Ziua')).toContain('Obligatoriu');
  });

  it('marks both prices when the low one is above the high one', async () => {
    await open();
    await fillValid();
    await fill('Preț de la (lei)', '900');
    await fill('până la (lei)', '700');

    const message = 'Prețul de la nu poate fi mai mare decât prețul până la';
    expect(said('Preț de la (lei)')).toContain(message);
    expect(said('până la (lei)')).toContain(message);
    expect(button('Trimite')?.disabled).toBe(true);
  });

  it('refuses a price under 1 or over 1 000 000 lei', async () => {
    await open();
    await fillValid();

    await fill('Preț de la (lei)', '0');
    expect(said('Preț de la (lei)')).toContain('Prețul minim este 1 leu');
    expect(button('Trimite')?.disabled).toBe(true);

    await fill('Preț de la (lei)', '650');
    await fill('până la (lei)', '1000001');
    expect(said('până la (lei)')).toContain('Prețul maxim este 1.000.000 lei');
    expect(button('Trimite')?.disabled).toBe(true);
  });

  it('refuses a duration under 15 minutes, over 5 days or off the 15-minute grid', async () => {
    await open();
    await fillValid();

    await fill('Ore', '0');
    expect(said('Ore')).toContain('Durata minimă este 15 minute');
    expect(button('Trimite')?.disabled).toBe(true);

    await fill('Ore', '121');
    expect(said('Ore')).toContain('Durata maximă este 5 zile');

    await fill('Ore', '1.5');
    expect(said('Ore')).toContain('Durata merge din 15 în 15 minute');
    expect(button('Trimite')?.disabled).toBe(true);

    await fill('Ore', '1');
    await fill('Minute', '45');
    expect(said('Ore')).toBe('');
    expect(button('Trimite')?.disabled).toBe(false);
  });

  it('refuses a note over 500 characters and counts it', async () => {
    await open();
    await fillValid();

    await fill('Mesaj pentru client', 'a'.repeat(501));

    expect(text()).toContain('501/500');
    expect(said('Mesaj pentru client')).toContain('Scrie cel mult 500');
    expect(button('Trimite')?.disabled).toBe(true);
  });

  it('warns about a range wider than three times its bottom and still lets it go', async () => {
    await open();
    await fillValid();

    await fill('Preț de la (lei)', '300');
    await fill('până la (lei)', '1200');

    expect(text()).toContain(
      'Intervalul este foarte larg; șoferul așteaptă un interval strâns.',
    );
    expect(button('Trimite')?.disabled).toBe(false);

    await fill('până la (lei)', '900');
    expect(text()).not.toContain('Intervalul este foarte larg');
  });

  it('offers days from today in Bucharest and times on a 15-minute grid', async () => {
    await open();

    expect(field('Ziua').type).toBe('date');
    expect(field('Ziua').min).toBe(todayInBucharest());
    expect(field('Ora').type).toBe('time');
    expect(field('Ora').step).toBe('900');
  });

  it('refuses a past time of today and a time off the grid', async () => {
    await open();
    await fillValid();

    await fill('Ziua', todayInBucharest());
    await fill('Ora', '00:00');
    expect(said('Ora')).toContain('Alege un moment din viitor');
    expect(button('Trimite')?.disabled).toBe(true);

    await fill('Ziua', tomorrow());
    await fill('Ora', '09:10');
    expect(said('Ora')).toContain('Ora merge din 15 în 15 minute');
    expect(button('Trimite')?.disabled).toBe(true);

    await fill('Ora', '09:15');
    expect(said('Ora')).toBe('');
    expect(button('Trimite')?.disabled).toBe(false);
  });

  it('refuses a past day', async () => {
    await open();
    await fillValid();

    await fill('Ziua', todayInBucharest(new Date(Date.now() - DAY)));

    expect(said('Ziua')).toContain('Alege un moment din viitor');
    expect(button('Trimite')?.disabled).toBe(true);
  });

  it('sends on Enter in a text field once the form is valid, and not before', async () => {
    await open();
    const enter = () =>
      field('Preț de la (lei)').dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }),
      );

    enter();
    await settle();
    expect(send).not.toHaveBeenCalled();

    await fillValid();
    enter();
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

// @traces 344-FR-005, 344-FR-013
describe('the send-quote dialog: sending', () => {
  it('sends lei, the duration in minutes and the Bucharest slot with its offset, then closes with Ofertă trimisă', async () => {
    await open();
    await fillValid();
    await fill('Mesaj pentru client', 'Include plăcuțe și discuri');

    await press();

    expect(send).toHaveBeenCalledTimes(1);
    const [params] = send.mock.calls[0];
    expect(params['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    const { slot, ...body } = params.body;
    expect(body).toEqual({
      durationMinutes: 120,
      fromLei: 650,
      note: 'Include plăcuțe și discuri',
      requestId: 'req-1',
      toLei: 800,
    });
    expect(slot).toMatch(
      new RegExp(`^${tomorrow()}T09:00:00[+-]\\d{2}:\\d{2}$`),
    );
    expect(bucharest(slot)).toBe(`${tomorrow()} 09:00`);
    await expect(result).resolves.toBe('sent');
    expect(toast).toHaveBeenCalledWith('Ofertă trimisă');
  });

  it('sends a note of whitespace as no note', async () => {
    await open();
    await fillValid();
    await fill('Mesaj pentru client', '   ');

    await press();

    expect(send.mock.calls[0][0].body.note).toBeNull();
  });

  it('spins Trimite and disables every field and Renunță while sending, the dialog open', async () => {
    await open();
    await fillValid();
    let answer: (quote: GarageQuoteDto) => void = () => undefined;
    send.mockReturnValueOnce(
      new Promise<GarageQuoteDto>((resolve) => {
        answer = resolve;
      }),
    );

    await press();

    // Its name now also carries the spoken "sending" line.
    const submit = panel().querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    expect(submit.textContent).toContain('Trimite');
    expect(submit.getAttribute('aria-busy')).toBe('true');
    expect(submit.querySelector('.mf-task-spinner')).not.toBeNull();
    expect(field('Preț de la (lei)').matches(':disabled')).toBe(true);
    expect(field('Ora').matches(':disabled')).toBe(true);
    expect(
      field<HTMLTextAreaElement>('Mesaj pentru client').matches(':disabled'),
    ).toBe(true);
    expect(button('Renunță')?.matches(':disabled')).toBe(true);

    answer(QUOTE);
    await settle();
    await expect(result).resolves.toBe('sent');
  });

  it('closes on a 409 with the refusal’s message as the toast', async () => {
    await open();
    await fillValid();
    send.mockRejectedValueOnce(
      refusal(409, { code: 'already_answered', status: 409 }),
    );

    await press();

    await expect(result).resolves.toBe('refused');
    expect(toast).toHaveBeenCalledWith(
      'Altcineva a răspuns deja la această cerere',
    );
  });

  it('closes on request_not_open with its message in English', async () => {
    await open(detail(), { language: 'en' });
    await fill('Price from (lei)', '650');
    await fill('to (lei)', '800');
    await fill('Hours', '2');
    await fill('Day', tomorrow());
    await fill('Time', '09:00');
    send.mockRejectedValueOnce(
      refusal(409, { code: 'request_not_open', status: 409 }),
    );

    button('Send')?.click();
    await settle();

    await expect(result).resolves.toBe('refused');
    expect(toast).toHaveBeenCalledWith('The request is no longer open');
  });

  it('marks the field a 400 names and stays open', async () => {
    await open();
    await fillValid();
    send.mockRejectedValueOnce(
      refusal(400, {
        code: 'validation_failed',
        errors: [{ code: 'past', field: 'slot' }],
        status: 400,
      }),
    );

    await press();

    expect(said('Ora')).toContain('Alege un moment din viitor');
    expect(panel()).not.toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });

  it('keeps everything typed after a failure and retries with the same key', async () => {
    await open();
    await fillValid();
    send.mockRejectedValueOnce(refusal(500, { code: 'internal_error' }));

    await press();

    expect(field('Preț de la (lei)').value).toBe('650');
    expect(text()).toContain('Ceva nu a mers la noi. Încearcă din nou.');
    expect(toast).not.toHaveBeenCalled();

    await press();

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]['Idempotency-Key']).toBe(
      send.mock.calls[0][0]['Idempotency-Key'],
    );
    await expect(result).resolves.toBe('sent');
  });

  it('disables Trimite offline with Ești offline and keeps what was typed', async () => {
    const online = jest.spyOn(navigator, 'onLine', 'get');
    online.mockReturnValue(false);
    await open();
    await fillValid();
    window.dispatchEvent(new Event('offline'));
    await settle();

    expect(button('Trimite')?.disabled).toBe(true);
    expect(text()).toContain('Ești offline');

    online.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await settle();

    expect(button('Trimite')?.disabled).toBe(false);
    expect(field('Preț de la (lei)').value).toBe('650');
  });

  it('closes on Renunță without sending', async () => {
    await open();

    button('Renunță')?.click();
    await settle();

    await expect(result).resolves.toBe('cancelled');
    expect(send).not.toHaveBeenCalled();
  });
});
