import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type GarageRequestDetailJobDto,
  type GarageRequestDto,
  GarageRequestsService,
  type MeDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { OVERLAY_TASK, Overlays } from '@motor-fix/overlays';

import { RequestDrawer } from './request-drawer';
import { Live } from '../../live';
import { Session } from '../../session';
import { DeclineRequestDialog } from '../decline-request-dialog/decline-request-dialog';
import { fakeLive, wait } from '../garage-requests.testing';
import { SendQuoteDialog } from '../send-quote-dialog/send-quote-dialog';

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

const OIL = job({
  id: 'rj-2',
  jobTypeId: 'job-oil',
  nameEn: 'Oil change',
  nameRo: 'Schimb ulei',
  position: 1,
});

const detail = (over: Partial<GarageRequestDto> = {}): GarageRequestDto => ({
  booking: null,
  car: {
    brand: 'BMW',
    engine: '2.0',
    fuel: 'petrol',
    model: '330i',
    year: 2021,
  },
  closedAt: null,
  closedReason: null,
  createdAt: new Date(Date.now() - 12 * 60_000).toISOString(),
  description: 'Scârțâie la frânare.\nVezi https://exemplu.ro',
  descriptionLine: 'Scârțâie la frânare.',
  driver: { shortName: 'Vlad P.' },
  expiresAt: new Date(
    Date.now() + 6 * 86_400_000 + 2 * 3_600_000,
  ).toISOString(),
  id: 'req-1',
  jobs: [job(), OIL],
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

const owner = {
  capabilities: ['garage.requests'],
  garageAccess: [
    {
      features: {},
      garageId: 'garage-1',
      name: 'Service Auto',
      permissions: {
        canAnswerQuotes: false,
        canMoveBookings: false,
        canRecordFinalPrice: false,
      },
      role: 'owner',
      status: 'approved',
    },
  ],
  garageId: 'garage-1',
} as unknown as MeDto;

let read: jest.Mock;
let open: jest.Mock;
let close: jest.Mock;
let live: ReturnType<typeof fakeLive>;

const httpError = (status: number) =>
  new HttpErrorResponse({ error: { code: 'x' }, status });

async function render(
  answer: GarageRequestDto | HttpErrorResponse | Promise<never> = detail(),
  language: 'ro' | 'en' = 'ro',
) {
  read = jest.fn(async () => {
    if (answer instanceof HttpErrorResponse) throw answer;
    return answer;
  });
  open = jest.fn(async () => 'cancelled');
  close = jest.fn();
  live = fakeLive();
  const me = signal(owner);
  TestBed.configureTestingModule({
    providers: [
      { provide: Live, useValue: live },
      { provide: Session, useValue: { current: me, shown: me } },
      { provide: Overlays, useValue: { open } },
      {
        provide: GarageRequestsService,
        useValue: { garageRequestsControllerGet: read },
      },
      {
        provide: OVERLAY_TASK,
        useValue: { close, data: { id: 'req-1' }, markUnchanged: jest.fn() },
      },
    ],
  });
  await TestBed.inject(I18n).enter('garage');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(RequestDrawer);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await wait(0);
    }
  };
  await settle();
  return { element, settle };
}

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const button = (element: HTMLElement, name: string) =>
  [...element.querySelectorAll('button')].find((b) => text(b) === name);
const banner = (element: HTMLElement) =>
  element.querySelector('[role="status"]');

afterEach(() => TestBed.resetTestingModule());

// @traces 347-FR-002 347-FR-003 347-FR-004
describe('the request drawer’s fields', () => {
  it('shows the customer, the car, the jobs, the description, the mechanic and the times', async () => {
    const { element } = await render();

    expect(read).toHaveBeenCalledWith({ id: 'req-1' });
    expect(text(element)).toContain('Vlad P.');
    expect(text(element)).toContain('BMW 330i · 2021 · benzină · 2.0');
    expect(text(element)).toContain('Frâne față');
    expect(text(element)).toContain('Schimb ulei');
    expect(text(element)).toContain('orice mecanic');
    expect(text(element)).toContain('primită acum 12 min');
    expect(text(element)).toContain('expiră în 6 zile');
  });

  it('keeps the description’s line breaks and leaves links as text', async () => {
    const { element } = await render();

    const description = element.querySelector('.description');
    expect(description?.textContent).toContain(
      'Scârțâie la frânare.\nVezi https://exemplu.ro',
    );
    expect(readFileSync(join(__dirname, 'request-drawer.css'), 'utf8')).toMatch(
      /\.description\s*\{[^}]*white-space:\s*pre-line/,
    );
    expect(element.querySelector('a')).toBeNull();
  });

  it('reads in English', async () => {
    const { element } = await render(detail(), 'en');

    expect(text(element)).toContain('BMW 330i · 2021 · petrol · 2.0');
    expect(text(element)).toContain('any mechanic');
    expect(text(element)).toContain('received 12 min ago');
    expect(text(element)).toContain('expires in 6 days');
  });

  it('leaves the engine out of the car line when the car has none', async () => {
    const { element } = await render(
      detail({ car: { ...detail().car, engine: null } }),
    );

    expect(text(element)).toContain('BMW 330i · 2021 · benzină');
    expect(text(element)).not.toContain('benzină ·');
  });

  it.each([
    [[job({ offered: false })], 'Nu faceți această lucrare pe BMW'],
    [
      [job({ offered: false }), { ...OIL, offered: false }],
      'Nu faceți aceste lucrări pe BMW',
    ],
  ])('lists the jobs the garage does not do apart', async (jobs, heading) => {
    const { element } = await render(detail({ jobs }));

    const apart = element.querySelector('.not-offered');
    expect(text(apart)).toContain(heading);
    expect(text(apart)).toContain('Frâne față');
  });

  it('names the jobs not done in English', async () => {
    const { element } = await render(
      detail({ jobs: [job({ offered: false }), OIL] }),
      'en',
    );

    expect(text(element.querySelector('.not-offered'))).toContain(
      'You do not do this job on BMW',
    );
  });

  it.each([null, '   \n '])(
    'says the customer added no description for %p',
    async (description) => {
      const { element } = await render(detail({ description }));

      expect(text(element)).toContain('Clientul nu a adăugat o descriere.');
    },
  );
});

// @traces 347-FR-005
describe('what the drawer never shows', () => {
  it('shows no phone, plate or e-mail when the read carries none', async () => {
    const { element } = await render();

    expect(text(element)).not.toMatch(/\+40|@/);
    expect(element.querySelector('.phone')).toBeNull();
    expect(element.querySelector('.plate')).toBeNull();
  });

  it('shows the phone and the plate once the read carries them', async () => {
    const { element } = await render(
      detail({
        car: { ...detail().car, plate: 'B123ABC' },
        driver: { phone: '+40722111222', shortName: 'Vlad P.' },
      }),
    );

    expect(text(element.querySelector('.phone'))).toContain('+40722111222');
    expect(text(element.querySelector('.plate'))).toContain('B123ABC');
  });
});

// @traces 347-FR-006
describe('the drawer’s actions', () => {
  it('opens the send dialog and closes once the quote is sent', async () => {
    const { element, settle } = await render();
    open.mockResolvedValueOnce('sent');

    button(element, 'Trimite oferta')?.click();
    await settle();

    expect(open).toHaveBeenCalledWith(SendQuoteDialog, {
      data: { requestId: 'req-1' },
      shape: 'dialog',
      title: 'garage.quotes.send.title',
    });
    expect(close).toHaveBeenCalledWith('sent');
  });

  it('opens the decline dialog and closes once declined', async () => {
    const { element, settle } = await render();
    open.mockResolvedValueOnce('declined');

    button(element, 'Refuză')?.click();
    await settle();

    expect(open).toHaveBeenCalledWith(DeclineRequestDialog, {
      data: { car: 'BMW 330i · 2021', driver: 'Vlad P.', requestId: 'req-1' },
      shape: 'dialog',
      title: 'garage.requests.decline.title',
    });
    expect(close).toHaveBeenCalledWith('declined');
  });

  it('keeps the two buttons in view while the request scrolls', async () => {
    await render();

    expect(readFileSync(join(__dirname, 'request-drawer.css'), 'utf8')).toMatch(
      /\.actions\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0/,
    );
  });

  it('stays open when the dialog is cancelled', async () => {
    const { element, settle } = await render();

    button(element, 'Trimite oferta')?.click();
    await settle();

    expect(close).not.toHaveBeenCalled();
  });
});

// @traces 347-FR-012
describe('the drawer while it loads, fails or is offline', () => {
  it('shows skeleton lines and both buttons disabled while the read is in flight', async () => {
    const { element } = await render(new Promise<never>(() => {}));

    expect(element.querySelector('.skeleton')).not.toBeNull();
    expect(button(element, 'Trimite oferta')?.disabled).toBe(true);
    expect(button(element, 'Refuză')?.disabled).toBe(true);
  });

  it('offers a retry that reads again after a failed read', async () => {
    const { element, settle } = await render(httpError(503));

    expect(text(element)).toContain(
      'Nu am putut încărca cererea. Încearcă din nou.',
    );
    read.mockResolvedValueOnce(detail());
    button(element, 'Încearcă din nou')?.click();
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(text(element)).toContain('Vlad P.');
  });

  it('keeps what it loaded and disables the buttons when offline', async () => {
    const { element, settle } = await render();

    live.offline.set(true);
    await settle();

    expect(text(element)).toContain('Vlad P.');
    expect(text(element)).toContain('Fără conexiune. Ce vezi poate fi vechi.');
    expect(button(element, 'Trimite oferta')?.disabled).toBe(true);
    expect(button(element, 'Refuză')?.disabled).toBe(true);
  });
});

// @traces 347-FR-008 347-FR-012
describe('the drawer refused', () => {
  it.each([
    [403, 'ro', 'Nu ai dreptul să citești cererile'],
    [403, 'en', 'You are not allowed to read requests'],
    [404, 'ro', 'Cererea nu mai este disponibilă'],
    [400, 'ro', 'Cererea nu mai este disponibilă'],
    [404, 'en', 'The request is no longer available'],
  ] as const)(
    'says why on a %s in %s, with no data and no buttons',
    async (status, language, said) => {
      const { element } = await render(httpError(status), language);

      expect(text(element)).toContain(said);
      expect(element.querySelector('button')).toBeNull();
      expect(element.querySelector('.skeleton')).toBeNull();
    },
  );
});

// @traces 347-FR-010 347-FR-011
describe('the drawer once the request closed', () => {
  const closed = (
    closedReason: GarageRequestDto['closedReason'] | string,
    status: GarageRequestDto['recipient']['status'] = 'closed',
  ) =>
    detail({
      closedReason: closedReason as GarageRequestDto['closedReason'],
      recipient: { ...detail().recipient, status },
    });

  it.each([
    [closed('cancelled'), 'Cererea s‑a închis: clientul a anulat‑o'],
    [closed('expired', 'expired'), 'Cererea s‑a închis: a expirat'],
    [closed(null, 'quoted'), 'Cererea s‑a închis: un coleg a trimis o ofertă'],
    [
      closed('declined', 'declined'),
      'Cererea s‑a închis: un coleg a refuzat‑o',
    ],
    [
      closed('accepted_elsewhere'),
      'Cererea s‑a închis: clientul a ales alt service',
    ],
    [
      closed('account_closed'),
      'Cererea s‑a închis: contul clientului a fost închis',
    ],
    [
      closed('garage_suspended'),
      'Cererea s‑a închis: service‑ul este suspendat',
    ],
    [closed('something_new'), 'Cererea s‑a închis.'],
  ])(
    'says why in a live region and disables both buttons',
    async (request, said) => {
      const { element } = await render(request);

      expect(text(banner(element))).toBe(said);
      expect(button(element, 'Trimite oferta')?.disabled).toBe(true);
      expect(button(element, 'Refuză')?.disabled).toBe(true);
    },
  );

  it.each([
    [closed('cancelled'), 'The request closed: the customer cancelled it'],
    [closed('expired', 'expired'), 'The request closed: it expired'],
    [closed(null, 'quoted'), 'The request closed: a colleague sent a quote'],
    [
      closed('declined', 'declined'),
      'The request closed: a colleague declined it',
    ],
    [
      closed('accepted_elsewhere'),
      'The request closed: the customer chose another garage',
    ],
    [
      closed('account_closed'),
      'The request closed: the customer’s account was closed',
    ],
    [closed('garage_suspended'), 'The request closed: the garage is suspended'],
    [closed('something_new'), 'The request closed.'],
  ])('says why in English', async (request, said) => {
    const { element } = await render(request, 'en');

    expect(text(banner(element))).toBe(said);
  });

  it('shows no banner but disables the buttons once this garage’s quote is accepted', async () => {
    const { element } = await render(
      detail({
        quote: { status: 'accepted' } as GarageRequestDto['quote'],
        recipient: { ...detail().recipient, status: 'quoted' },
      }),
    );

    expect(banner(element)).toBeNull();
    expect(button(element, 'Trimite oferta')?.disabled).toBe(true);
    expect(button(element, 'Refuză')?.disabled).toBe(true);
  });

  it.each([
    'quote.sent',
    'request.declined',
    'request.cancelled',
    'request.expired',
    'quote.accepted',
  ] as const)(
    're-reads on %s for this request and shows the banner, keeping the fields',
    async (kind) => {
      const { element, settle } = await render();
      read.mockResolvedValueOnce(closed('cancelled'));

      live.emit(kind, 'req-1');
      await wait(350);
      await settle();

      expect(read).toHaveBeenCalledTimes(2);
      expect(text(banner(element))).toBe(
        'Cererea s‑a închis: clientul a anulat‑o',
      );
      expect(text(element)).toContain('Vlad P.');
    },
  );

  it('changes nothing on an event for another request', async () => {
    const { element, settle } = await render();

    live.emit('request.cancelled', 'req-other');
    await wait(350);
    await settle();

    expect(read).toHaveBeenCalledTimes(1);
    expect(banner(element)).toBeNull();
  });
});
