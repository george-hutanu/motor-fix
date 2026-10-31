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

const loggedRepair = (id: string, what: string) => ({
  doneOn: '2026-01-01',
  garageName: 'G',
  id,
  source: 'logged' as const,
  what,
});

const tick = (row: HTMLElement) =>
  (row.querySelector('input[type="checkbox"]') as HTMLInputElement).click();

// @traces 1392-FR-002
describe('the buyer’s phone field under hostile input', () => {
  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['letters', 'abcdefgh'],
    ['arabic-indic digits', '٠٧٢٢١٢٣٤٥٦'],
    ['a script tag', '<script>alert(1)</script>'],
  ])('refuses %s in the field, sending nothing', async (_name, value) => {
    await open();
    await toList();

    type(value);
    button('Trimite').click();
    await settle();

    expect(fieldError()).toBe('Scrie un număr de telefon valid.');
    expect(send).not.toHaveBeenCalled();
  });

  it('sends again after a refused send, with the second answer shown', async () => {
    let calls = 0;
    await open({
      answer: async () => {
        calls += 1;
        if (calls === 1) throw refusal(500, { code: 'error', title: 'no' });
        return sentAnswer();
      },
    });
    await toList();
    type('+40722123456');
    button('Trimite').click();
    await settle();
    expect(alert()).toContain('Ceva nu a mers. Încearcă din nou.');

    button('Trimite').click();
    await settle();

    expect(send).toHaveBeenCalledTimes(2);
    expect(said()).toContain('Linkul a plecat pe WhatsApp');
    expect(alert()).toBe('');
  });

  it('clears the API’s phone refusal from the field once a send goes through', async () => {
    let calls = 0;
    await open({
      answer: async () => {
        calls += 1;
        if (calls === 1) throw refusal(400, { code: 'own_phone', title: 'no' });
        return sentAnswer();
      },
    });
    await toList();
    type('+40722123456');
    button('Trimite').click();
    await settle();
    expect(fieldError()).toBe('Nu poți trimite linkul pe numărul tău.');

    type('+40733123456');
    button('Trimite').click();
    await settle();

    expect(send).toHaveBeenLastCalledWith({
      body: { buyerPhone: '+40733123456', repairIds: [] },
      id: 'car-1',
    });
    expect(said()).toContain('Linkul a plecat pe WhatsApp');
  });
});

// @traces 1392-FR-002
describe('the repairs list under odd data', () => {
  it('sends no repair when a tick is set and cleared again', async () => {
    await open();
    await toList();

    tick(rows()[1]);
    tick(rows()[1]);
    type('+40722123456');
    button('Trimite').click();
    await settle();

    expect(send).toHaveBeenCalledWith({
      body: { buyerPhone: '+40722123456', repairIds: [] },
      id: 'car-1',
    });
  });

  it('sends every ticked logged repair and never a MotorFix one', async () => {
    await open({
      read: async () => ({
        ...history,
        repairs: [
          ...history.repairs,
          loggedRepair('r-3', 'Anvelope'),
          loggedRepair('r-4', 'Baterie'),
        ],
      }),
    });
    await toList();

    for (const row of rows()) {
      row.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
    }
    type('+40722123456');
    button('Trimite').click();
    await settle();

    const ids = send.mock.calls[0][0].body.repairIds as string[];
    expect([...ids].sort()).toEqual(['r-1', 'r-3', 'r-4']);
  });

  it('shows repair text as text, never as markup', async () => {
    await open({
      read: async () => ({
        ...history,
        repairs: [
          {
            ...history.repairs[0],
            garageName: '<img src=x onerror=alert(1)>',
            what: '<b id="pwn">gras</b>',
          },
        ],
      }),
    });
    await toList();

    expect(body().querySelector('#pwn')).toBeNull();
    expect(body().querySelector('img')).toBeNull();
    expect(said()).toContain('<b id="pwn">gras</b>');
  });

  it('lists ten thousand repairs, one row each', async () => {
    await open({
      read: async () => ({
        ...history,
        repairs: Array.from({ length: 10000 }, (_, i) =>
          loggedRepair(`r-${i}`, `Lucrare ${i}`),
        ),
      }),
    });
    await toList();

    expect(rows()).toHaveLength(10000);
  }, 120000);

  it('offers no choice for a refusal reason it does not know', async () => {
    await open({
      read: async () =>
        ({ ...history, canStart: false, reason: 'something_new' }) as never,
    });

    expect(buttons()).not.toContain('Transmit istoricul noului proprietar');
    expect(buttons()).not.toContain('Nu transmit istoricul');
    expect(buttons()).toEqual(['Închide']);
  });
});

// @traces 1392-FR-003 1392-FR-006
describe('closing the sale dialog', () => {
  const pressEscape = () =>
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
  const clipboard = { writeText: jest.fn(async () => undefined) };

  beforeEach(() => {
    clipboard.writeText.mockReset();
    clipboard.writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: clipboard,
    });
  });

  it('closes with cancelled on Escape at the question', async () => {
    await open();

    pressEscape();

    expect(await result).toBe('cancelled');
  });

  it('closes with cancelled on Escape while the sale is still being read', async () => {
    await open({ read: () => new Promise<CarSaleDto>(() => undefined) });

    pressEscape();

    expect(await result).toBe('cancelled');
  });

  // A dismissal answers `cancelled` (the overlays' contract); the list reads
  // the cars again on every answer but `remove`, so the sent link still shows.
  it('sends once and closes as dismissed when Escape closes the done state', async () => {
    await open();
    await toList();
    type('+40722123456');
    button('Trimite').click();
    await settle();

    pressEscape();

    expect(await result).toBe('cancelled');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps the link and Copiază linkul when the clipboard write is refused', async () => {
    clipboard.writeText.mockRejectedValue(new Error('denied'));
    await open();
    await toList();
    type('+40722123456');
    button('Trimite').click();
    await settle();

    button('Copiază linkul').click();
    await settle();

    expect(buttons()).toEqual(['Copiază linkul', 'Gata']);
    expect(buttons()).not.toContain('Copiat');
    expect(
      body().querySelector('[data-part="link"]')?.textContent?.trim(),
    ).toBe(LINK);
  });

  it('shows a link carrying markup as text', async () => {
    await open({
      answer: async () => ({
        ...sentAnswer(),
        link: 'https://motorfix.ro/ro/transfer/<i id="pwn">x</i>',
      }),
    });
    await toList();
    type('+40722123456');
    button('Trimite').click();
    await settle();

    expect(body().querySelector('#pwn')).toBeNull();
  });
});
