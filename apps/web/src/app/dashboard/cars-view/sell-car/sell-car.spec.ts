import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type CarDto,
  type CarSaleDto,
  CarsService,
  type CarTransferSentDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { openSellCar } from './open-sell-car';
import type { SellCarResult } from './sell-car';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const bmw: CarDto = {
  brandId: 'bmw',
  brandName: 'BMW',
  createdAt: '2026-10-07T09:00:00.000Z',
  engine: null,
  fuel: 'diesel',
  id: 'car-1',
  itpUntil: null,
  model: '320d',
  nextServiceKm: null,
  odometerKm: 148200,
  plate: null,
  rcaUntil: null,
  rovinietaUntil: null,
  serviceDueOn: null,
  transfer: null,
  updatedAt: '2026-10-07T09:00:00.000Z',
  year: 2019,
};

const history: CarSaleDto = {
  canStart: true,
  reason: null,
  repairs: [
    {
      doneOn: '2026-09-20',
      garageName: 'Service Unu',
      id: 'r-2',
      source: 'motorfix',
      what: 'Schimb de ulei',
    },
    {
      doneOn: '2026-05-03',
      garageName: 'Atelier Doi',
      id: 'r-1',
      source: 'logged',
      what: 'Plăcuțe de frână',
    },
  ],
  transfer: null,
};

const LINK = 'https://motorfix.ro/ro/transfer/abc123';
const sentAnswer = (
  whatsapp: 'sent' | 'failed' = 'sent',
): CarTransferSentDto => ({
  link: LINK,
  transfer: { expiresAt: '2026-10-15T09:00:00.000Z', id: 't-1' },
  whatsapp,
});

const refusal = (status: number, body: object) =>
  new HttpErrorResponse({ error: body, status });

let sale: jest.Mock;
let send: jest.Mock;
let result: Promise<OverlayResult<SellCarResult>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  options: {
    language?: 'ro' | 'en';
    read?: () => Promise<CarSaleDto>;
    answer?: () => Promise<CarTransferSentDto>;
  } = {},
) {
  sale = jest.fn(options.read ?? (async () => history));
  send = jest.fn(options.answer ?? (async () => sentAnswer()));
  TestBed.configureTestingModule({
    providers: [
      {
        provide: CarsService,
        useValue: {
          carSaleControllerSale: sale,
          carSaleControllerSend: send,
        },
      },
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  if (options.language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = openSellCar(host.componentInstance.overlays, bmw);
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const body = () => panel().querySelector('mf-sell-car') as HTMLElement;
const said = () => (body().textContent ?? '').replace(/\s+/g, ' ').trim();
const buttons = () =>
  [...body().querySelectorAll('button')].map((b) =>
    (b.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );
const button = (name: string) =>
  [...body().querySelectorAll('button')].find(
    (b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim() === name,
  ) as HTMLButtonElement;
const rows = () => [...body().querySelectorAll<HTMLElement>('li[data-repair]')];
const phone = () =>
  body().querySelector('input[type="tel"]') as HTMLInputElement;
const alert = () =>
  (body().querySelector('[role="alert"]')?.textContent ?? '').trim();
const fieldError = () =>
  (body().querySelector('mf-field-error')?.textContent ?? '').trim();

function type(value: string) {
  phone().value = value;
  phone().dispatchEvent(new Event('input', { bubbles: true }));
}

async function toList() {
  button('Transmit istoricul noului proprietar').click();
  await settle();
}

afterEach(() => {
  document.body.innerHTML = '';
});

// @traces 1392-FR-001 1392-FR-006
describe('the sale dialog’s question', () => {
  it('asks whether the history passes to the new owner, under the car’s title', async () => {
    await open();

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Ai vândut BMW 320d?',
    );
    expect(said()).toContain(
      'Transmiți istoricul reparațiilor noului proprietar?',
    );
    expect(buttons()).toEqual([
      'Transmit istoricul noului proprietar',
      'Nu transmit istoricul',
    ]);
    expect(sale).toHaveBeenCalledWith({ id: 'car-1' });
  });

  it('reads English', async () => {
    await open({ language: 'en' });

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Sold your BMW 320d?',
    );
    expect(said()).toContain(
      'Do you pass the repair history to the new owner?',
    );
    expect(buttons()).toEqual([
      'Pass the history to the new owner',
      "Don't pass the history",
    ]);
  });

  it('is a dialog named by its title', async () => {
    await open();

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const title = document.getElementById(
      dialog.getAttribute('aria-labelledby') ?? '',
    );
    expect(title?.textContent?.trim()).toBe('Ai vândut BMW 320d?');
  });

  it('shows the loading state until the sale is read, and no choice yet', async () => {
    let answer: (value: CarSaleDto) => void = () => undefined;
    await open({
      read: () =>
        new Promise<CarSaleDto>((resolve) => {
          answer = resolve;
        }),
    });

    expect(body().querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(buttons()).toEqual([]);

    answer(history);
    await settle();
    expect(body().querySelector('[aria-busy="true"]')).toBeNull();
    expect(buttons()).toHaveLength(2);
  });

  it('answers remove on "Nu transmit istoricul", sending nothing', async () => {
    await open();

    button('Nu transmit istoricul').click();

    expect(await result).toBe('remove');
    expect(send).not.toHaveBeenCalled();
  });
});

// @traces 1392-FR-001
describe('a car with a request under way', () => {
  const busy = async () => ({
    ...history,
    canStart: false,
    reason: 'open_request' as const,
  });

  it('says the sale waits for the request and offers only Închide', async () => {
    await open({ read: busy });

    expect(said()).toContain(
      'Mașina are o cerere în curs. Poți vinde mașina după ce se încheie.',
    );
    expect(buttons()).toEqual(['Închide']);

    button('Închide').click();
    expect(await result).toBe('cancelled');
  });

  it('says it in English', async () => {
    await open({ language: 'en', read: busy });

    expect(said()).toContain(
      'The car has a request under way. You can sell the car once it ends.',
    );
    expect(buttons()).toEqual(['Close']);
  });

  it('shows a failed read and reads again on Reîncearcă', async () => {
    let calls = 0;
    await open({
      read: async () => {
        calls += 1;
        if (calls === 1) throw refusal(500, { code: 'error', title: 'boom' });
        return history;
      },
    });

    expect(alert()).toContain('Ceva nu a mers. Încearcă din nou.');
    button('Reîncearcă').click();
    await settle();

    expect(sale).toHaveBeenCalledTimes(2);
    expect(buttons()).toContain('Nu transmit istoricul');
  });
});

// @traces 1392-FR-002 1392-FR-006 1392-SC-001
describe('the repairs list and the buyer’s phone', () => {
  it('lists the repairs as read, a MotorFix one passing with no tick and a logged one to tick', async () => {
    await open();
    await toList();

    expect(rows().map((r) => r.getAttribute('data-repair'))).toEqual([
      'r-2',
      'r-1',
    ]);
    const [motorfix, logged] = rows();
    expect(motorfix.textContent).toContain('Schimb de ulei');
    expect(motorfix.textContent).toContain('Service Unu');
    expect(motorfix.textContent).toContain('Se transmite');
    expect(motorfix.querySelector('input[type="checkbox"]')).toBeNull();
    const tick = logged.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(tick.checked).toBe(false);
    expect(tick.closest('label')?.textContent).toContain('Plăcuțe de frână');
    expect(logged.textContent).toContain('Adăugată de tine');
    expect(said()).toContain(
      'Reparațiile făcute prin MotorFix se transmit întotdeauna. Bifează ce ai adăugat tu și vrei să transmiți. Facturile nu se transmit.',
    );
    expect(said()).toContain(
      'Îi trimitem un link pe WhatsApp, valabil 7 zile.',
    );
    expect(
      body().querySelector(`label[for="${phone().id}"]`)?.textContent?.trim(),
    ).toBe('Telefonul cumpărătorului');
    expect(phone().getAttribute('autocomplete')).toBe('tel');
    expect(buttons()).toEqual(['Înapoi', 'Trimite']);
  });

  it('reads English', async () => {
    await open({ language: 'en' });
    button('Pass the history to the new owner').click();
    await settle();

    expect(said()).toContain('Passes on');
    expect(said()).toContain('Added by you');
    expect(said()).toContain(
      "Repairs done through MotorFix always pass on. Tick what you added yourself and want to pass. Invoices don't pass on.",
    );
    expect(said()).toContain('We send them a link on WhatsApp, valid 7 days.');
    expect(said()).toContain("The buyer's phone");
    expect(buttons()).toEqual(['Back', 'Send']);
  });

  it('says the buyer takes the car with no history when there is none', async () => {
    await open({ read: async () => ({ ...history, repairs: [] }) });
    await toList();

    expect(rows()).toHaveLength(0);
    expect(said()).toContain(
      'Nicio reparație încă. Cumpărătorul preia mașina fără istoric.',
    );
  });

  it('goes back to the question on Înapoi', async () => {
    await open();
    await toList();

    button('Înapoi').click();
    await settle();

    expect(buttons()).toEqual([
      'Transmit istoricul noului proprietar',
      'Nu transmit istoricul',
    ]);
  });

  it('refuses a number no rule can read in the field, sending nothing', async () => {
    await open();
    await toList();

    type('12');
    button('Trimite').click();
    await settle();

    expect(fieldError()).toBe('Scrie un număr de telefon valid.');
    expect(phone().getAttribute('aria-invalid')).toBe('true');
    expect(send).not.toHaveBeenCalled();
  });

  it('sends the phone as typed with the ticked repairs', async () => {
    await open();
    await toList();

    (
      rows()[1].querySelector('input[type="checkbox"]') as HTMLInputElement
    ).click();
    type('0722 123 456');
    button('Trimite').click();
    await settle();

    expect(send).toHaveBeenCalledWith({
      body: { buyerPhone: '0722 123 456', repairIds: ['r-1'] },
      id: 'car-1',
    });
  });

  it('sends no repair when none is ticked', async () => {
    await open();
    await toList();

    type('+40722123456');
    button('Trimite').click();
    await settle();

    expect(send).toHaveBeenCalledWith({
      body: { buyerPhone: '+40722123456', repairIds: [] },
      id: 'car-1',
    });
  });

  it.each([
    ['invalid_phone', 'Scrie un număr de telefon valid.'],
    ['own_phone', 'Nu poți trimite linkul pe numărul tău.'],
  ])('shows the API’s %s in the field', async (code, text) => {
    await open({
      answer: async () => {
        throw refusal(400, { code, title: 'no' });
      },
    });
    await toList();

    type('+40722123456');
    button('Trimite').click();
    await settle();

    expect(fieldError()).toBe(text);
    expect(body().isConnected).toBe(true);
  });

  it('shows the own number in English', async () => {
    await open({
      answer: async () => {
        throw refusal(400, { code: 'own_phone', title: 'no' });
      },
      language: 'en',
    });
    button('Pass the history to the new owner').click();
    await settle();

    type('+40722123456');
    button('Send').click();
    await settle();

    expect(fieldError()).toBe("You can't send the link to your own number.");
  });

  it.each([
    [
      409,
      'open_request',
      'Mașina are o cerere în curs. Poți vinde mașina după ce se încheie.',
    ],
    [
      400,
      'repair_not_tickable',
      'O reparație bifată nu mai poate fi transmisă. Închide și deschide din nou.',
    ],
    [500, 'error', 'Ceva nu a mers. Încearcă din nou.'],
  ])('keeps a %s %s refusal inside the dialog', async (status, code, text) => {
    await open({
      answer: async () => {
        throw refusal(status, { code, title: 'no' });
      },
    });
    await toList();

    type('+40722123456');
    button('Trimite').click();
    await settle();

    expect(alert()).toContain(text);
    expect(fieldError()).toBe('');
    expect(body().isConnected).toBe(true);
  });

  it('shows Trimite busy while the send is on its way, sends once, and Escape does not close it', async () => {
    let answer: (value: CarTransferSentDto) => void = () => undefined;
    await open({
      answer: () =>
        new Promise<CarTransferSentDto>((resolve) => {
          answer = resolve;
        }),
    });
    await toList();

    type('+40722123456');
    button('Trimite').click();
    await settle();
    // While busy the button also says it is sending.
    const submit = body().querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    expect(submit.getAttribute('aria-busy')).toBe('true');
    submit.click();
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    expect(send).toHaveBeenCalledTimes(1);
    expect(document.querySelector('mf-sell-car')).not.toBeNull();
    answer(sentAnswer());
    await settle();
    expect(said()).toContain('Linkul a plecat pe WhatsApp');
  });
});

// @traces 1392-FR-003 1392-FR-006 1392-SC-002
describe('the sent link', () => {
  const clipboard = { writeText: jest.fn(async () => undefined) };

  beforeEach(() => {
    clipboard.writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: clipboard,
    });
  });

  async function sent(
    whatsapp: 'sent' | 'failed' = 'sent',
    language: 'ro' | 'en' = 'ro',
  ) {
    await open({ answer: async () => sentAnswer(whatsapp), language });
    button(
      language === 'ro'
        ? 'Transmit istoricul noului proprietar'
        : 'Pass the history to the new owner',
    ).click();
    await settle();
    type('+40722123456');
    button(language === 'ro' ? 'Trimite' : 'Send').click();
    await settle();
  }

  it('says the link went by WhatsApp and shows it in full', async () => {
    await sent();

    expect(said()).toContain('Linkul a plecat pe WhatsApp');
    expect(
      body().querySelector('[data-part="link"]')?.textContent?.trim(),
    ).toBe(LINK);
    expect(buttons()).toEqual(['Copiază linkul', 'Gata']);
    expect(body().querySelector('[role="status"]')?.textContent).toContain(
      'Linkul a plecat pe WhatsApp',
    );
  });

  it('asks the seller to send the link when WhatsApp failed, changing nothing else', async () => {
    await sent('failed');

    expect(said()).toContain(
      'Nu am putut trimite linkul pe WhatsApp. Copiază‑l și trimite‑l tu cumpărătorului.',
    );
    expect(said()).not.toContain('Linkul a plecat pe WhatsApp');
    expect(
      body().querySelector('[data-part="link"]')?.textContent?.trim(),
    ).toBe(LINK);
    expect(buttons()).toEqual(['Copiază linkul', 'Gata']);
  });

  it('reads English', async () => {
    await sent('failed', 'en');

    expect(said()).toContain(
      "We couldn't send the link by WhatsApp. Copy it and send it to the buyer yourself.",
    );
    expect(buttons()).toEqual(['Copy the link', 'Done']);
  });

  it('copies the link, says Copiat for 2 seconds and announces it', async () => {
    await sent();

    button('Copiază linkul').click();
    await settle();

    expect(clipboard.writeText).toHaveBeenCalledWith(LINK);
    expect(buttons()).toContain('Copiat');
    expect(body().querySelector('[aria-live="polite"]')?.textContent).toContain(
      'Copiat',
    );
    await new Promise((resolve) => setTimeout(resolve, 2100));
    await settle();
    expect(buttons()).toContain('Copiază linkul');
  });

  it('leaves the link to select when there is no clipboard', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    await sent();

    expect(buttons()).toEqual(['Gata']);
    expect(
      body().querySelector('[data-part="link"]')?.textContent?.trim(),
    ).toBe(LINK);
  });

  it('closes with sent on Gata', async () => {
    await sent();

    button('Gata').click();

    expect(await result).toBe('sent');
  });
});
