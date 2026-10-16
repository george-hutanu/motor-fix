import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  AdminService,
  type VerificationQueueDto,
  type VerificationQueueRowDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { AdminQueue } from './admin-queue';
import { Live } from '../live';

// @traces 301-FR-002 301-FR-005 301-FR-007 301-FR-008 301-FR-009 301-FR-012

const row = (
  n: number,
  extra: Partial<VerificationQueueRowDto> = {},
): VerificationQueueRowDto => ({
  area: { kind: 'town', name: 'București' },
  brands: 7,
  flagged: false,
  garageId: `garage-${n}`,
  garageName: `Service ${n}`,
  id: `file-${n}`,
  lamp: 'green',
  mechanics: 3,
  status: 'submitted',
  submittedAt: new Date().toISOString(),
  summary: {
    en: 'Company ID and RAR licence checked',
    ro: 'CUI și autorizație RAR verificate',
  },
  workingDays: 0,
  ...extra,
});

const queueOf = (count: number, total = count): VerificationQueueDto => ({
  items: Array.from({ length: count }, (_, i) => row(i + 1)),
  total,
});

let events: Subject<LiveMessage>;
let resync: Subject<void>;
let asked: { offset?: number; limit?: number }[];
let answer: (read: {
  offset?: number;
  limit?: number;
}) => Promise<VerificationQueueDto>;

async function settle() {
  for (let i = 0; i < 5; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

// The overview's queue, as the overview writes it.
@Component({
  imports: [AdminQueue],
  template: '<mf-admin-queue overview />',
})
class Overview {}

async function open(
  { overview = false }: { overview?: boolean } = {},
  language: 'ro' | 'en' = 'ro',
) {
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
          adminOverviewControllerQueue: (read: {
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
  const fixture = TestBed.createComponent(overview ? Overview : AdminQueue);
  document.body.append(fixture.nativeElement);
  await settle();
  return fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();
const rows = (el: HTMLElement) => [...el.querySelectorAll('li.row')];
const button = (el: HTMLElement, name: string) =>
  [...el.querySelectorAll('button')].find((b) => text(b) === name);
const message = (kind: EventKind): LiveMessage => ({
  at: '2026-10-15T09:00:00.000Z',
  id: 'any-file',
  kind,
});

beforeEach(() => {
  answer = async ({ limit = 20 }) => queueOf(Math.min(limit, 4), 4);
});

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
});

describe('a queue row', () => {
  it('shows the name, the area line, the checks with their lamp, when it applied and the button', async () => {
    const el = await open();

    const [first] = rows(el);
    expect(text(first.querySelector('.name'))).toBe('Service 1');
    expect(text(first.querySelector('.area'))).toBe(
      'București · 7 mărci · 3 mecanici',
    );
    const lamp = first.querySelector('mf-lamp');
    expect(lamp?.getAttribute('data-state')).toBe('green');
    expect(text(lamp)).toContain('CUI și autorizație RAR verificate');
    expect(text(first.querySelector('.applied'))).toMatch(/^azi, \d\d:\d\d$/);
    const link = first.querySelector('a.open');
    expect(text(link)).toBe('Deschide dosarul');
    expect(link?.getAttribute('href')).toBe('/app/admin/garages/file-1');
  });

  it("reads a mobile mechanic's radius and leaves out a team the garage does not keep", async () => {
    answer = async () => ({
      items: [
        row(1, {
          area: { kind: 'mobile', radiusKm: 20 },
          brands: 1,
          mechanics: undefined,
        }),
        row(2, { area: undefined, brands: 0, mechanics: 1 }),
      ],
      total: 2,
    });
    const el = await open();

    const [mobile, bare] = rows(el);
    expect(text(mobile.querySelector('.area'))).toBe(
      'Mecanic mobil · rază 20 km · 1 marcă',
    );
    expect(text(bare.querySelector('.area'))).toBe('0 mărci · 1 mecanic');
  });

  it('flags a file that waited too long, in words as well as colour', async () => {
    answer = async () => ({
      items: [row(1, { flagged: true, lamp: 'amber', workingDays: 3 })],
      total: 1,
    });
    const el = await open();

    const [late] = rows(el);
    expect(late.querySelector('mf-lamp')?.getAttribute('data-state')).toBe(
      'amber',
    );
    expect(text(late.querySelector('.waiting'))).toBe(
      'așteaptă de 3 zile lucrătoare',
    );
  });

  it('reads in English', async () => {
    answer = async () => ({
      items: [row(1, { flagged: true, lamp: 'amber', workingDays: 3 })],
      total: 1,
    });
    const el = await open({}, 'en');

    const [first] = rows(el);
    expect(text(first.querySelector('.area'))).toBe(
      'București · 7 brands · 3 mechanics',
    );
    expect(text(first.querySelector('mf-lamp'))).toContain(
      'Company ID and RAR licence checked',
    );
    expect(text(first.querySelector('.waiting'))).toBe(
      'waiting 3 working days',
    );
    expect(text(first.querySelector('a.open'))).toBe('Open the file');
  });
});

describe('the panel', () => {
  it('heads the list with its name and the count', async () => {
    const el = await open();

    expect(text(el.querySelector('h2'))).toBe('Service‑uri de verificat · 4');
  });

  it('on the overview shows the 5 oldest and a link to the whole list', async () => {
    answer = async ({ limit = 20 }) => queueOf(Math.min(limit, 7), 7);
    const el = await open({ overview: true });

    expect(asked).toEqual([{ limit: 5, offset: 0 }]);
    expect(rows(el)).toHaveLength(5);
    const all = el.querySelector('a.all');
    expect(text(all)).toBe('Vezi toate');
    expect(all?.getAttribute('href')).toBe('/app/admin/garages');
    expect(button(el, 'Mai multe')).toBeUndefined();
  });

  it('on the overview has no link when every file is shown', async () => {
    const el = await open({ overview: true });

    expect(el.querySelector('a.all')).toBeNull();
  });

  it('in the view lists 20 and reads every row shown again for the next 20', async () => {
    answer = async ({ limit = 20 }) => queueOf(Math.min(limit, 25), 25);
    const el = await open();

    expect(rows(el)).toHaveLength(20);
    button(el, 'Mai multe')?.click();
    await settle();

    expect(asked.at(-1)).toEqual({ limit: 40, offset: 0 });
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
      { limit: 200, offset: 0 },
      { limit: 40, offset: 200 },
    ]);
    expect(rows(el)).toHaveLength(230);
    expect(button(el, 'Mai multe')).toBeUndefined();
  });

  it('says so when no file waits, with a count of 0', async () => {
    answer = async () => queueOf(0);
    const el = await open();

    expect(text(el.querySelector('.empty'))).toBe(
      'Niciun service nu așteaptă verificarea',
    );
    expect(text(el.querySelector('h2'))).toBe('Service‑uri de verificat · 0');
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
    answer = async () => queueOf(2);
    button(el, 'Reîncearcă')?.click();
    await settle();

    expect(rows(el)).toHaveLength(2);
  });

  it('keeps the rows and the last count, marked stale, when a re-read fails', async () => {
    const el = await open();
    answer = () => Promise.reject(new HttpErrorResponse({ status: 503 }));
    resync.next();
    await settle();

    expect(rows(el)).toHaveLength(4);
    expect(text(el.querySelector('h2'))).toBe(
      'Service‑uri de verificat · 4 (neactualizat)',
    );
    expect(button(el, 'Reîncearcă')).toBeDefined();
  });
});

describe('live', () => {
  it.each<EventKind>([
    'verification.submitted',
    'verification.opened',
    'verification.check_recorded',
    'verification.decided',
    'verification.reopened',
  ])('reads the rows again on %s', async (kind) => {
    const el = await open();
    answer = async () => queueOf(5);

    events.next(message(kind));
    await new Promise((resolve) => setTimeout(resolve, 400));
    await settle();

    expect(asked).toHaveLength(2);
    expect(rows(el)).toHaveLength(5);
  });

  it('reads again when the connection comes back', async () => {
    await open();

    resync.next();
    await settle();

    expect(asked).toHaveLength(2);
  });
});
