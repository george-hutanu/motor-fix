import { Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { GarageRequestSummaryDto, MeDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { QuoteSentRow } from './quote-sent-row';
import { Session } from '../../session';
import { quotedRow } from '../garage-requests.testing';
import { GarageRequestsFeed } from '../garage-requests-feed';

@Component({
  imports: [QuoteSentRow],
  template: '<ul><li [mfQuoteSentRow]="row()" [now]="now()"></li></ul>',
})
class Host {
  readonly row = input.required<GarageRequestSummaryDto>();
  readonly now = input.required<Date>();
}

const NOW = new Date('2026-10-09T10:00:00Z');
const PHONE = '+40722111222';
type Outcome = NonNullable<GarageRequestSummaryDto['outcome']>;

const me = (role: 'owner' | 'receptionist' | 'mechanic') =>
  ({
    capabilities: ['garage.requests'],
    garageAccess: [
      {
        features: {},
        garageId: 'garage-1',
        name: 'Service Auto',
        permissions: {
          canAnswerQuotes: true,
          canMoveBookings: false,
          canRecordFinalPrice: false,
        },
        role,
        status: 'approved',
      },
    ],
    garageId: 'garage-1',
  }) as unknown as MeDto;

async function render(
  row: GarageRequestSummaryDto,
  language: 'ro' | 'en' = 'ro',
  account: MeDto = me('owner'),
) {
  const shown = signal(account);
  TestBed.configureTestingModule({
    providers: [
      { provide: Session, useValue: { current: shown, shown } },
      { provide: Overlays, useValue: { open: jest.fn() } },
      {
        provide: GarageRequestsFeed,
        useValue: { reload: jest.fn(), sent: jest.fn() },
      },
    ],
  });
  await TestBed.inject(I18n).enter('garage');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(Host);
  fixture.componentRef.setInput('row', row);
  fixture.componentRef.setInput('now', NOW);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).querySelector(
    'li',
  ) as HTMLElement;
}

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

const row = (
  outcome: Outcome | null,
  over: Partial<GarageRequestSummaryDto> = {},
) => ({
  ...quotedRow({
    driver: { phone: PHONE, shortName: 'Irina S.' },
    ...over,
  }),
  outcome,
});

const booking = (status: 'awaiting_confirmation' | 'confirmed') => ({
  canRecordNoShow: false,
  canWithdrawNoShow: false,
  confirmBy: '2026-10-09T15:30:00Z',
  durationMinutes: 90,
  id: 'booking-1',
  lift: null,
  mechanic: null,
  noShowAt: null,
  startsAt: '2026-10-10T06:00:00Z',
  status,
  toReassign: false,
});

const ENDINGS: [Outcome, string, string][] = [
  ['lapsed', 'Neconfirmată la timp', 'Not confirmed in time'],
  ['chose_other', 'A ales alt service', 'Chose another garage'],
  ['expired', 'Expirată', 'Expired'],
  ['withdrawn', 'Retrasă', 'Withdrawn'],
  [
    'withdrawn_suspended',
    'Retrasă · service suspendat',
    'Withdrawn · garage suspended',
  ],
  [
    'request_cancelled',
    'Cerere anulată de client',
    'Request cancelled by the customer',
  ],
  ['booking_cancelled', 'Programare anulată', 'Booking cancelled'],
  [
    'account_closed',
    'Contul clientului a fost închis',
    "The customer's account was closed",
  ],
  ['declined', 'Refuzată de client', 'Declined by the customer'],
  ['no_show', 'Clientul nu s‑a prezentat', 'The customer did not show up'],
];

afterEach(() => TestBed.resetTestingModule());

// @traces 346-FR-003
describe('a sent-quote row under hostile input', () => {
  it('shows no tag, no tone, no expiry, no phone and no button for a null outcome', async () => {
    const el = await render(
      row(null, { booking: booking('awaiting_confirmation') }),
    );

    expect(el.querySelector('.status')).toBeNull();
    expect(el.hasAttribute('data-tone')).toBe(false);
    expect(el.querySelector('.expires')).toBeNull();
    expect(el.querySelector('a.phone')).toBeNull();
    expect(el.querySelector('button.confirm')).toBeNull();
  });

  it.each(ENDINGS)(
    'shows %s as a grey tag with no phone, no expiry and no button even if the row carries a phone and a booking',
    async (outcome, ro, en) => {
      const withBooking = row(outcome, {
        booking: booking('awaiting_confirmation'),
      });
      const el = await render(withBooking);
      expect(text(el.querySelector('.status'))).toBe(ro);
      expect(el.getAttribute('data-tone')).toBe('grey');
      expect(el.querySelector('.lamp')?.getAttribute('aria-hidden')).toBe(
        'true',
      );
      expect(el.querySelector('a.phone')).toBeNull();
      expect(el.querySelector('.expires')).toBeNull();
      expect(el.querySelector('button.confirm')).toBeNull();
      TestBed.resetTestingModule();

      const english = await render(withBooking, 'en');
      expect(text(english.querySelector('.status'))).toBe(en);
    },
  );

  it.each([
    ['mechanic', false],
    ['receptionist', true],
    ['owner', true],
  ] as const)('shows the confirm button to a %s: %s', async (role, shown) => {
    const el = await render(
      row('accepted', { booking: booking('awaiting_confirmation') }),
      'ro',
      me(role),
    );
    expect(el.querySelector('button.confirm') !== null).toBe(shown);
    expect(el.getAttribute('data-tone')).toBe('amber');
  });

  it('shows no confirm button on a booked or waiting row to an owner', async () => {
    const booked = await render(
      row('booked', { booking: booking('confirmed') }),
    );
    expect(booked.querySelector('button.confirm')).toBeNull();
    expect(booked.getAttribute('data-tone')).toBe('green');
    TestBed.resetTestingModule();
    const waiting = await render(row('waiting'));
    expect(waiting.querySelector('button.confirm')).toBeNull();
    expect(waiting.getAttribute('data-tone')).toBe('amber');
  });

  it('shows no confirm button when the session has no garage access at all', async () => {
    const el = await render(
      row('accepted', { booking: booking('awaiting_confirmation') }),
      'ro',
      { capabilities: [], garageAccess: [] } as unknown as MeDto,
    );
    expect(el.querySelector('button.confirm')).toBeNull();
  });

  it('shows no phone link on an accepted row that carries none', async () => {
    const el = await render(
      row('accepted', {
        booking: booking('awaiting_confirmation'),
        driver: { shortName: 'Irina S.' },
      }),
    );
    expect(el.querySelector('a.phone')).toBeNull();
    expect(text(el.querySelector('.status'))).toContain('Acceptată');
  });

  it('links the phone as tel: on accepted and booked rows', async () => {
    const accepted = await render(
      row('accepted', { booking: booking('awaiting_confirmation') }),
    );
    expect(accepted.querySelector('a.phone')?.getAttribute('href')).toBe(
      `tel:${PHONE}`,
    );
    TestBed.resetTestingModule();
    const booked = await render(
      row('booked', { booking: booking('confirmed') }),
    );
    expect(booked.querySelector('a.phone')?.getAttribute('href')).toBe(
      `tel:${PHONE}`,
    );
  });

  it('writes a driver name made of markup as text, not as elements', async () => {
    const el = await render(
      row('waiting', { driver: { shortName: '<img src=x onerror=alert(1)>' } }),
    );
    expect(el.querySelector('img')).toBeNull();
    expect(text(el.querySelector('.name'))).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });

  it.each([
    ['a quote already past its expiry', -3_600_000, 'expiră în câteva momente'],
    ['a quote expiring in 30 seconds', 30_000, 'expiră în câteva momente'],
    ['a quote expiring in 59 minutes', 59 * 60_000, 'expiră în 59 min'],
  ])('words the expiry of waiting row with %s', async (_t, ms, ro) => {
    const el = await render(
      row('waiting', {
        quote: {
          ...(row('waiting').quote as NonNullable<
            GarageRequestSummaryDto['quote']
          >),
          expiresAt: new Date(NOW.getTime() + ms).toISOString(),
        },
      }),
    );
    expect(text(el.querySelector('.expires'))).toBe(ro);
  });

  it('renders an accepted row whose booking is missing without a deadline and without throwing', async () => {
    const el = await render(row('accepted', { booking: null }));
    expect(text(el.querySelector('.status'))).toContain('Acceptată');
    expect(el.querySelector('.status time')?.textContent?.trim()).toBe('—');
  });

  it('renders a waiting row with no quote without throwing and shows the dash for the expiry', async () => {
    const el = await render(row('waiting', { quote: null }));
    expect(text(el.querySelector('.status'))).toBe(
      'Așteaptă răspunsul clientului',
    );
    expect(text(el.querySelector('.expires'))).toBe('—');
  });
});
