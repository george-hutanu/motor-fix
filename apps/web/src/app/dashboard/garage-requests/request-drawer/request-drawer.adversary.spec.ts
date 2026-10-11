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
import { fakeLive, wait } from '../garage-requests.testing';

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
  description: 'Scârțâie la frânare.',
  descriptionLine: 'Scârțâie la frânare.',
  driver: { shortName: 'Vlad P.' },
  expiresAt: new Date(Date.now() + 6 * 86_400_000 + 3_600_000).toISOString(),
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
let live: ReturnType<typeof fakeLive>;

async function render(
  answer: GarageRequestDto | HttpErrorResponse = detail(),
  language: 'ro' | 'en' = 'ro',
) {
  read = jest.fn(async () => {
    if (answer instanceof HttpErrorResponse) throw answer;
    return answer;
  });
  live = fakeLive();
  const me = signal(owner);
  TestBed.configureTestingModule({
    providers: [
      { provide: Live, useValue: live },
      { provide: Session, useValue: { current: me, shown: me } },
      {
        provide: Overlays,
        useValue: { open: jest.fn(async () => 'cancelled') },
      },
      {
        provide: GarageRequestsService,
        useValue: { garageRequestsControllerGet: read },
      },
      {
        provide: OVERLAY_TASK,
        useValue: {
          close: jest.fn(),
          data: { id: 'req-1' },
          markUnchanged: jest.fn(),
        },
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
const recipient = (status: GarageRequestDto['recipient']['status']) => ({
  ...detail().recipient,
  status,
});

afterEach(() => TestBed.resetTestingModule());

// @traces 347-FR-004
describe('the drawer’s description under hostile text', () => {
  it.each(['', ' 　\t\r\n', ' \n\n '])(
    'says the customer added no description for %j',
    async (description) => {
      const { element } = await render(detail({ description }));

      expect(text(element)).toContain('Clientul nu a adăugat o descriere.');
    },
  );

  it('says it in English too', async () => {
    const { element } = await render(detail({ description: ' ' }), 'en');

    expect(text(element)).toContain('The customer added no description.');
  });

  it('shows markup as text and builds no element from it', async () => {
    const hostile = '<img src=x onerror=alert(1)><a href="http://x">y</a>';
    const { element } = await render(detail({ description: hostile }));

    expect(element.querySelector('img')).toBeNull();
    expect(element.querySelector('a')).toBeNull();
    expect(element.querySelector('.description')?.textContent).toContain(
      hostile,
    );
  });

  it('does not say the customer added no description when one is written', async () => {
    const { element } = await render(detail({ description: '0' }));

    expect(text(element)).not.toContain('Clientul nu a adăugat o descriere.');
    expect(element.querySelector('.description')?.textContent).toContain('0');
  });
});

// @traces 347-FR-005
describe('the drawer’s contact details', () => {
  it('never shows an e-mail that rides along on the read', async () => {
    const { element } = await render(
      detail({
        car: {
          ...detail().car,
          email: 'x@example.ro',
        } as GarageRequestDto['car'],
        driver: {
          email: 'vlad@example.ro',
          shortName: 'Vlad P.',
        } as GarageRequestDto['driver'],
      }),
    );

    expect(element.innerHTML).not.toContain('example.ro');
    expect(text(element)).not.toContain('@');
  });

  it.each([null, ''])(
    'shows no phone line for a phone of %p',
    async (phone) => {
      const { element } = await render(
        detail({
          driver: { phone, shortName: 'Vlad P.' } as GarageRequestDto['driver'],
        }),
      );

      expect(element.querySelector('.phone')).toBeNull();
      expect(text(element)).not.toContain('null');
    },
  );

  it.each([null, ''])(
    'shows no plate line for a plate of %p',
    async (plate) => {
      const { element } = await render(
        detail({ car: { ...detail().car, plate } as GarageRequestDto['car'] }),
      );

      expect(element.querySelector('.plate')).toBeNull();
      expect(text(element)).not.toContain('null');
    },
  );

  it('shows the phone and the plate together once the read carries both, in English', async () => {
    const { element } = await render(
      detail({
        car: { ...detail().car, plate: 'B123ABC' },
        driver: { phone: '+40722111222', shortName: 'Vlad P.' },
      }),
      'en',
    );

    expect(text(element.querySelector('.phone'))).toContain('+40722111222');
    expect(text(element.querySelector('.plate'))).toContain('B123ABC');
  });
});

// @traces 347-FR-003
describe('the drawer’s car line and jobs', () => {
  it('leaves the engine part out for an empty engine, with no dangling dot', async () => {
    const { element } = await render(
      detail({ car: { ...detail().car, engine: '' } }),
    );

    expect(text(element)).toContain('BMW 330i · 2021 · benzină');
    expect(text(element)).not.toMatch(/benzină\s*·\s*(?!\S)/);
  });

  it('lists every job under the not-offered heading when none is offered, and none in the main list', async () => {
    const { element } = await render(
      detail({
        jobs: [job({ offered: false }), job({ id: 'rj-2', offered: false })],
      }),
    );

    expect(text(element.querySelector('.not-offered'))).toContain(
      'Nu faceți aceste lucrări pe BMW',
    );
    expect(text(element)).not.toContain('undefined');
  });

  it('shows no not-offered heading when every job is offered or there is no job', async () => {
    const withJob = await render(detail());
    expect(withJob.element.querySelector('.not-offered')).toBeNull();
    TestBed.resetTestingModule();

    const none = await render(detail({ jobs: [] }));
    expect(none.element.querySelector('.not-offered')).toBeNull();
    expect(text(none.element)).toContain('Scârțâie la frânare.');
  });
});

// @traces 347-FR-003
describe('the drawer’s expiry line', () => {
  const at = (ms: number) => new Date(Date.now() + ms).toISOString();

  it('says the request expired, once, when the expiry has passed', async () => {
    const { element } = await render(detail({ expiresAt: at(-60_000) }));

    expect(text(element)).toContain('a expirat');
    expect(text(element)).not.toContain('expiră a expirat');
  });

  it('says it in English for an expiry under an hour away', async () => {
    const { element } = await render(
      detail({ expiresAt: at(30 * 60_000) }),
      'en',
    );

    expect(text(element)).toContain('expires in less than an hour');
  });

  it('says it in hours for an expiry a few hours away', async () => {
    const { element } = await render(
      detail({ expiresAt: at(5 * 3_600_000 + 60_000) }),
    );

    expect(text(element)).toContain('expiră în 5 ore');
  });
});

// @traces 347-FR-010 347-FR-011
describe('the drawer’s closed banner rules', () => {
  it('falls back to the plain closed text for a closed recipient with no reason', async () => {
    const { element } = await render(
      detail({ closedReason: null, recipient: recipient('closed') }),
    );

    expect(text(banner(element))).toBe('Cererea s‑a închis.');
    expect(button(element, 'Trimite oferta')?.disabled).toBe(true);
    expect(button(element, 'Refuză')?.disabled).toBe(true);
  });

  it.each(['', 'CANCELLED', 'cancelled ', '__proto__', 'constructor'])(
    'falls back to the plain closed text for the unknown reason %j',
    async (closedReason) => {
      const { element } = await render(
        detail({
          closedReason: closedReason as GarageRequestDto['closedReason'],
          recipient: recipient('closed'),
        }),
      );

      expect(text(banner(element))).toBe('Cererea s‑a închis.');
    },
  );

  it('names the reason when the read carries a reason on a recipient still marked waiting', async () => {
    const { element } = await render(
      detail({ closedReason: 'cancelled', recipient: recipient('waiting') }),
    );

    expect(text(banner(element))).toBe(
      'Cererea s‑a închis: clientul a anulat‑o',
    );
    expect(button(element, 'Trimite oferta')?.disabled).toBe(true);
  });

  it('shows no banner and enabled buttons for a waiting request', async () => {
    const { element } = await render();

    expect(banner(element)).toBeNull();
    expect(button(element, 'Trimite oferta')?.disabled).toBe(false);
    expect(button(element, 'Refuză')?.disabled).toBe(false);
  });

  it('shows no banner but disabled buttons for this garage’s accepted quote, whatever the recipient says', async () => {
    for (const status of ['quoted', 'closed'] as const) {
      const { element } = await render(
        detail({
          closedReason: null,
          quote: { status: 'accepted' } as GarageRequestDto['quote'],
          recipient: recipient(status),
        }),
      );

      expect(banner(element)).toBeNull();
      expect(button(element, 'Trimite oferta')?.disabled).toBe(true);
      expect(button(element, 'Refuză')?.disabled).toBe(true);
      TestBed.resetTestingModule();
    }
  });

  it('shows the colleague text, not the accepted-quote silence, for a quote that is only sent', async () => {
    const { element } = await render(
      detail({
        quote: { status: 'sent' } as unknown as GarageRequestDto['quote'],
        recipient: recipient('quoted'),
      }),
    );

    expect(text(banner(element))).toBe(
      'Cererea s‑a închis: un coleg a trimis o ofertă',
    );
  });

  it('keeps the banner and the disabled buttons after a later event re-reads the same closed request', async () => {
    const closed = detail({
      closedReason: 'expired',
      recipient: recipient('expired'),
    });
    const { element, settle } = await render(closed);

    live.emit('request.expired', 'req-1');
    await wait(350);
    await settle();

    expect(text(banner(element))).toBe('Cererea s‑a închis: a expirat');
    expect(button(element, 'Refuză')?.disabled).toBe(true);
    expect(text(element)).toContain('Vlad P.');
  });

  it('drops the banner when a re-read shows the request open again', async () => {
    const { element, settle } = await render(
      detail({ closedReason: 'cancelled', recipient: recipient('closed') }),
    );
    read.mockResolvedValueOnce(detail());

    live.emit('request.decline_undone' as never, 'req-1');
    live.emit('quote.sent', 'req-1');
    await wait(350);
    await settle();

    expect(banner(element)).toBeNull();
    expect(button(element, 'Trimite oferta')?.disabled).toBe(false);
  });

  it('keeps the fields in place when the re-read after an event fails', async () => {
    const { element, settle } = await render();
    read.mockRejectedValueOnce(
      new HttpErrorResponse({ error: { code: 'x' }, status: 503 }),
    );

    live.emit('request.cancelled', 'req-1');
    await wait(350);
    await settle();

    expect(text(element)).toContain('Vlad P.');
  });
});
