import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  type AdminGaragesDto,
  AdminService,
  type SuspendedGarageRowDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { AdminSuspended } from './admin-suspended';
import { Live } from '../live';

// @traces 066-FR-004 066-FR-007 066-FR-008 066-FR-009

const row = (
  n: number,
  extra: Partial<SuspendedGarageRowDto> = {},
): SuspendedGarageRowDto => ({
  area: { kind: 'town', name: 'Pantelimon' },
  cancelledBookings: 0,
  cause: 'recheck_failed',
  fileId: `file-${n}`,
  fromTime: '2026-09-12T08:00:00.000Z',
  id: `garage-${n}`,
  name: `Service ${n}`,
  rarVerdict: 'expired',
  reason: 'Autorizație RAR expirată pe 12 sept. 2026',
  ...extra,
});

const listOf = (count: number, total = count): AdminGaragesDto => ({
  items: Array.from({ length: count }, (_, i) => row(i + 1)),
  total,
});

let events: Subject<LiveMessage>;
let resync: Subject<void>;
let asked: { status: string; offset?: number; limit?: number }[];
let answer: (read: {
  offset?: number;
  limit?: number;
}) => Promise<AdminGaragesDto>;

async function settle() {
  for (let i = 0; i < 5; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(language: 'ro' | 'en' = 'ro') {
  events = new Subject();
  resync = new Subject();
  asked = [];
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: Live,
        useValue: {
          on: (kinds: readonly EventKind[]) =>
            events.pipe(
              filter((m) => (kinds as readonly string[]).includes(m.kind)),
            ),
          resync,
        },
      },
      {
        provide: AdminService,
        useValue: {
          adminOverviewControllerGarages: (read: {
            status: string;
            offset?: number;
            limit?: number;
          }) => {
            asked.push(read);
            return answer(read);
          },
        },
      },
    ],
  });
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  const fixture = TestBed.createComponent(AdminSuspended);
  document.body.append(fixture.nativeElement);
  await settle();
  return fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();
const rows = (el: HTMLElement) => [...el.querySelectorAll('li.row')];
const button = (el: HTMLElement, name: string) =>
  [...el.querySelectorAll('button')].find((b) => text(b) === name);
const one = (extra: Partial<SuspendedGarageRowDto>) => async () => ({
  items: [row(1, extra)],
  total: 1,
});
const message = (kind: EventKind): LiveMessage => ({
  at: '2026-10-15T09:00:00.000Z',
  id: 'any-garage',
  kind,
});

beforeEach(() => {
  answer = async ({ limit = 20 }) => listOf(Math.min(limit, 3), 3);
});

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
});

describe('a suspended row', () => {
  it('shows the name, the area, the state, the reason, the date, the cancelled count and the button', async () => {
    const el = await open();

    const [first] = rows(el);
    expect(text(first.querySelector('.name'))).toBe('Service 1');
    expect(text(first.querySelector('.area'))).toBe('Pantelimon');
    expect(text(first.querySelector('.state'))).toBe(
      'suspendat · autorizație RAR expirată',
    );
    const lamp = first.querySelector('mf-lamp');
    expect(lamp?.getAttribute('data-state')).toBe('red');
    expect(text(lamp)).toContain('suspendat · autorizație RAR expirată');
    expect(text(first.querySelector('.reason'))).toBe(
      'Autorizație RAR expirată pe 12 sept. 2026',
    );
    expect(text(first.querySelector('.since'))).toBe('din 12 sept. 2026');
    expect(text(first.querySelector('.cancelled'))).toBe(
      '0 programări anulate',
    );
    const link = first.querySelector('a.open');
    expect(text(link)).toBe('Deschide dosarul');
    expect(link?.getAttribute('aria-label')).toBe('Deschide dosarul Service 1');
    expect(link?.getAttribute('href')).toBe('/app/admin/garages/file-1');
  });

  it.each<[Partial<SuspendedGarageRowDto>, string]>([
    [{ rarVerdict: 'suspended' }, 'suspendat · autorizație RAR suspendată'],
    [{ rarVerdict: 'withdrawn' }, 'suspendat · autorizație RAR retrasă'],
    [{ rarVerdict: undefined }, 'suspendat · autorizație RAR nevalidă'],
    [
      { cause: 'documents_overdue', rarVerdict: undefined },
      'suspendat · documente anuale neîncărcate',
    ],
    [
      { cause: 'report_confirmed', rarVerdict: undefined },
      'suspendat · sesizare confirmată',
    ],
    [
      { cause: 'admin', rarVerdict: undefined },
      'suspendat · decizia unui administrator',
    ],
  ])('reads %o as "%s"', async (extra, state) => {
    answer = one(extra);
    const el = await open();

    expect(text(rows(el)[0].querySelector('.state'))).toBe(state);
  });

  it.each<[Partial<SuspendedGarageRowDto>, string]>([
    [{ rarVerdict: 'expired' }, 'suspended · RAR authorisation expired'],
    [{ rarVerdict: 'suspended' }, 'suspended · RAR authorisation suspended'],
    [{ rarVerdict: 'withdrawn' }, 'suspended · RAR authorisation withdrawn'],
    [{ rarVerdict: undefined }, 'suspended · RAR authorisation invalid'],
    [
      { cause: 'documents_overdue', rarVerdict: undefined },
      'suspended · yearly documents not uploaded',
    ],
    [
      { cause: 'report_confirmed', rarVerdict: undefined },
      'suspended · report confirmed',
    ],
    [
      { cause: 'admin', rarVerdict: undefined },
      "suspended · an admin's decision",
    ],
  ])('reads %o in English as "%s"', async (extra, state) => {
    answer = one(extra);
    const el = await open('en');

    expect(text(rows(el)[0].querySelector('.state'))).toBe(state);
  });

  it('reads the date, the count and the button in English', async () => {
    answer = one({ cancelledBookings: 1 });
    const el = await open('en');

    const [first] = rows(el);
    expect(text(first.querySelector('.since'))).toBe('since 12 Sep 2026');
    expect(text(first.querySelector('.cancelled'))).toBe('1 booking cancelled');
    expect(text(first.querySelector('a.open'))).toBe('Open the file');
  });

  it('counts the cancelled bookings in Romanian forms', async () => {
    answer = async () => ({
      items: [
        row(1, { cancelledBookings: 1 }),
        row(2, { cancelledBookings: 3 }),
      ],
      total: 2,
    });
    const el = await open();

    const [single, few] = rows(el);
    expect(text(single.querySelector('.cancelled'))).toBe(
      '1 programare anulată',
    );
    expect(text(few.querySelector('.cancelled'))).toBe('3 programări anulate');
  });

  it('dates the suspension in Bucharest time', async () => {
    // 23:30 UTC on the 11th is already the 12th in Bucharest.
    answer = one({ fromTime: '2026-09-11T23:30:00.000Z' });
    const el = await open();

    expect(text(rows(el)[0].querySelector('.since'))).toBe('din 12 sept. 2026');
  });

  it("reads a mobile mechanic's radius and leaves out an unknown area", async () => {
    answer = async () => ({
      items: [
        row(1, { area: { kind: 'mobile', radiusKm: 25 } }),
        row(2, { area: undefined }),
      ],
      total: 2,
    });
    const el = await open();

    const [mobile, bare] = rows(el);
    expect(text(mobile.querySelector('.area'))).toBe(
      'Mecanic mobil · rază 25 km',
    );
    expect(bare.querySelector('.area')).toBeNull();
  });

  it('shows "suspendat" alone for a garage with no open suspension', async () => {
    answer = async () => ({
      items: [{ fileId: 'file-1', id: 'garage-1', name: 'Service 1' }],
      total: 1,
    });
    const el = await open();

    const [first] = rows(el);
    expect(text(first.querySelector('.state'))).toBe('suspendat');
    expect(first.querySelector('.reason')).toBeNull();
    expect(first.querySelector('.since')).toBeNull();
    expect(first.querySelector('.cancelled')).toBeNull();
  });

  it('has no button when the garage has no verification file', async () => {
    answer = one({ fileId: undefined });
    const el = await open();

    expect(rows(el)[0].querySelector('a.open')).toBeNull();
  });

  it('renders the name and the reason as text, never as markup', async () => {
    answer = one({
      name: '<b>Auto</b>',
      reason: '<img src=x onerror=alert(1)>',
    });
    const el = await open();

    const [first] = rows(el);
    expect(first.querySelector('b, img')).toBeNull();
    expect(text(first.querySelector('.name'))).toBe('<b>Auto</b>');
    expect(text(first.querySelector('.reason'))).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });
});

describe('the panel', () => {
  it('heads the list with its name and the total', async () => {
    const el = await open();

    expect(asked[0]).toEqual({ limit: 20, offset: 0, status: 'suspended' });
    expect(text(el.querySelector('h2'))).toBe('Service‑uri suspendate · 3');
  });

  it('heads it in English', async () => {
    const el = await open('en');

    expect(text(el.querySelector('h2'))).toBe('Suspended garages · 3');
  });

  it('lists 20 and reads every row shown again for the next 20', async () => {
    answer = async ({ limit = 20 }) => listOf(Math.min(limit, 25), 25);
    const el = await open();

    expect(rows(el)).toHaveLength(20);
    button(el, 'Mai multe')?.click();
    await settle();

    expect(asked.at(-1)).toEqual({ limit: 40, offset: 0, status: 'suspended' });
    expect(rows(el)).toHaveLength(25);
    expect(button(el, 'Mai multe')).toBeUndefined();
  });

  it('keeps offering more past 200, reading every row shown in reads of at most 200', async () => {
    answer = async ({ limit = 20, offset = 0 }) => ({
      items: Array.from(
        { length: Math.max(0, Math.min(limit, 230 - offset)) },
        (_, i) => row(offset + i + 1),
      ),
      total: 230,
    });
    const el = await open();

    for (let press = 0; press < 11; press++) {
      button(el, 'Mai multe')?.click();
      await settle();
    }

    expect(asked.slice(-2)).toEqual([
      { limit: 200, offset: 0, status: 'suspended' },
      { limit: 40, offset: 200, status: 'suspended' },
    ]);
    expect(rows(el)).toHaveLength(230);
    expect(button(el, 'Mai multe')).toBeUndefined();
  });

  it('keeps a row seen twice across reads once', async () => {
    // A garage suspended between two reads shifts the second read by one.
    answer = async ({ limit = 20, offset = 0 }) => ({
      items: Array.from(
        { length: Math.max(0, Math.min(limit, 230 - offset)) },
        (_, i) => row(offset === 0 ? i + 1 : offset + i),
      ),
      total: 230,
    });
    const el = await open();

    for (let press = 0; press < 11; press++) {
      button(el, 'Mai multe')?.click();
      await settle();
    }

    const ids = rows(el).map((r) => text(r.querySelector('.name')));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('says so when no garage is suspended', async () => {
    answer = async () => listOf(0);
    const el = await open();

    expect(text(el.querySelector('.empty'))).toBe('Niciun service suspendat');
    expect(text(el.querySelector('h2'))).toBe('Service‑uri suspendate · 0');
  });

  it('says so in English', async () => {
    answer = async () => listOf(0);
    const el = await open('en');

    expect(text(el.querySelector('.empty'))).toBe('No garage is suspended');
  });

  it('shows skeleton rows while the first read is on its way', async () => {
    answer = () => new Promise(() => {});
    const el = await open();

    expect(el.querySelectorAll('.skeleton-row').length).toBeGreaterThan(0);
    expect(el.querySelector('ul')?.getAttribute('aria-busy')).toBe('true');
  });

  it('offers a retry when the read fails', async () => {
    answer = () => Promise.reject(new HttpErrorResponse({ status: 500 }));
    const el = await open();

    expect(text(el.querySelector('.failed p'))).toBe(
      'Lista nu a putut fi citită',
    );
    answer = async () => listOf(2);
    button(el, 'Reîncearcă')?.click();
    await settle();

    expect(rows(el)).toHaveLength(2);
  });

  it('keeps the rows and the last total, marked stale, when a re-read fails', async () => {
    const el = await open();
    answer = () => Promise.reject(new HttpErrorResponse({ status: 503 }));
    resync.next();
    await settle();

    expect(rows(el)).toHaveLength(3);
    expect(text(el.querySelector('h2'))).toBe(
      'Service‑uri suspendate · 3 (neactualizat)',
    );
    expect(button(el, 'Reîncearcă')).toBeDefined();
  });
});

describe('live', () => {
  it.each<EventKind>([
    'garage.suspended',
    'garage.restored',
    'verification.submitted',
    'verification.opened',
    'verification.check_recorded',
    'verification.decided',
    'verification.reopened',
  ])('reads the rows again on %s', async (kind) => {
    const el = await open();
    answer = async () => listOf(4);

    events.next(message(kind));
    await new Promise((resolve) => setTimeout(resolve, 400));
    await settle();

    expect(asked).toHaveLength(2);
    expect(rows(el)).toHaveLength(4);
  });

  it('reads again from the start, for every row loaded, when the connection comes back', async () => {
    answer = async ({ limit = 20 }) => listOf(Math.min(limit, 25), 25);
    const el = await open();
    button(el, 'Mai multe')?.click();
    await settle();

    resync.next();
    await settle();

    expect(asked.at(-1)).toEqual({ limit: 40, offset: 0, status: 'suspended' });
  });
});
