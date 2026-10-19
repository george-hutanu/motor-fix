import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  AdminService,
  type RecheckDueListDto,
  type RecheckDueRowDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { filter, Subject } from 'rxjs';

import { AdminRechecks } from './admin-rechecks';
import { AdminRecheckForm } from '../admin-recheck-form/admin-recheck-form';
import { Live } from '../live';

// @traces 1351-FR-010 1351-FR-013

const TODAY = '2026-10-01';

const row = (
  n: number,
  extra: Partial<RecheckDueRowDto> = {},
): RecheckDueRowDto => ({
  activities: ['mechanics', 'brakes'],
  activityNames: [
    { code: 'mechanics', nameEn: 'Mechanics', nameRo: 'Mecanică' },
    { code: 'brakes', nameEn: 'Brakes', nameRo: 'Frâne' },
  ],
  daysSince: 28,
  garageId: `garage-${n}`,
  lastCheckedOn: '2026-09-03',
  name: `Atelier ${n}`,
  overdue: false,
  rarNumber: `RAR-1234${n}`,
  ...extra,
});

const listOf = (...items: RecheckDueRowDto[]): RecheckDueListDto => ({
  items,
  today: TODAY,
});

let events: Subject<LiveMessage>;
let resync: Subject<void>;
let asked: number;
let answer: () => Promise<RecheckDueListDto>;
let open: jest.Mock;

async function settle() {
  for (let i = 0; i < 5; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function show(language: 'ro' | 'en' = 'ro') {
  events = new Subject();
  resync = new Subject();
  asked = 0;
  open = jest.fn(async () => 'cancelled');
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
          recheckControllerDue: () => {
            asked++;
            return answer();
          },
        },
      },
      { provide: Overlays, useValue: { open } },
    ],
  });
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  const fixture = TestBed.createComponent(AdminRechecks);
  document.body.append(fixture.nativeElement);
  await settle();
  return fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();
const rows = (el: HTMLElement) => [...el.querySelectorAll('li.row')];
const button = (el: Element, name: string) =>
  [...el.querySelectorAll('button')].find((b) => text(b) === name);
const message = (kind: EventKind): LiveMessage => ({
  at: '2026-10-01T09:00:00.000Z',
  id: 'any-garage',
  kind,
});

beforeEach(() => {
  answer = async () => listOf(row(1), row(2));
});

afterEach(() => {
  TestBed.resetTestingModule();
  document.body.innerHTML = '';
});

describe('a due row', () => {
  it('shows the name, the RAR number, the date of last check and the days since', async () => {
    const el = await show();

    const [first] = rows(el);
    expect(text(first.querySelector('.name'))).toBe('Atelier 1');
    expect(text(first.querySelector('.number'))).toBe('RAR-12341');
    expect(text(first.querySelector('.checked'))).toBe('3 sept. 2026');
    expect(text(first.querySelector('.days'))).toBe('28 de zile');
    expect(first.classList.contains('overdue')).toBe(false);
    expect(first.querySelector('.tag')).toBeNull();
  });

  it('reads the date and the days in English', async () => {
    const el = await show('en');

    const [first] = rows(el);
    expect(text(first.querySelector('.checked'))).toBe('3 Sep 2026');
    expect(text(first.querySelector('.days'))).toBe('28 days');
  });

  it('shows a dash for a missing RAR number and a missing date', async () => {
    answer = async () =>
      listOf(
        row(1, {
          daysSince: null,
          lastCheckedOn: null,
          overdue: true,
          rarNumber: null,
        }),
      );
    const el = await show();

    const [first] = rows(el);
    expect(text(first.querySelector('.number'))).toBe('—');
    expect(text(first.querySelector('.checked'))).toBe('—');
    expect(text(first.querySelector('.days'))).toBe('—');
  });

  it.each([
    ['ro', 'depășit'],
    ['en', 'overdue'],
  ] as const)(
    'marks an overdue row and tags it in %s',
    async (language, tag) => {
      answer = async () =>
        listOf(
          row(1, { daysSince: 32, lastCheckedOn: '2026-08-30', overdue: true }),
        );
      const el = await show(language);

      const [first] = rows(el);
      expect(first.classList.contains('overdue')).toBe(true);
      expect(text(first.querySelector('.tag'))).toBe(tag);
    },
  );

  it('renders the name as text, never as markup', async () => {
    answer = async () =>
      listOf(row(1, { name: '<img src=x onerror=alert(1)>' }));
    const el = await show();

    expect(el.querySelector('img')).toBeNull();
    expect(text(rows(el)[0].querySelector('.name'))).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });
});

describe('the panel', () => {
  it('heads the list with its name', async () => {
    expect(text((await show()).querySelector('h2'))).toContain(
      'Reverificări RAR',
    );
  });

  it('heads it in English', async () => {
    expect(text((await show('en')).querySelector('h2'))).toContain(
      'RAR re-checks',
    );
  });

  it.each([
    ['ro', 'Nicio reverificare de făcut azi'],
    ['en', 'No re-checks to do today'],
  ] as const)('says so in %s when nothing is due', async (language, line) => {
    answer = async () => listOf();
    const el = await show(language);

    expect(rows(el)).toHaveLength(0);
    expect(text(el.querySelector('.empty'))).toBe(line);
  });

  it('opens the record dialog for the row with the list’s day', async () => {
    const el = await show();

    button(rows(el)[1], 'Înregistrează')?.click();
    await settle();

    expect(open).toHaveBeenCalledWith(
      AdminRecheckForm,
      expect.objectContaining({
        data: { row: row(2), stale: expect.any(Function), today: TODAY },
      }),
    );
  });

  it('reads the list again once a re-check is recorded', async () => {
    const el = await show();
    open.mockResolvedValueOnce('recorded');
    answer = async () => listOf(row(2));

    button(rows(el)[0], 'Înregistrează')?.click();
    await settle();

    expect(asked).toBe(2);
    expect(rows(el)).toHaveLength(1);
  });

  it('reads the list again when the dialog meets a 409, while it stays open', async () => {
    const el = await show();
    open.mockImplementationOnce(
      (_: unknown, options: { data: { stale: () => void } }) => {
        options.data.stale();
        return new Promise(() => undefined);
      },
    );
    answer = async () => listOf(row(2));

    button(rows(el)[0], 'Înregistrează')?.click();
    await settle();

    expect(asked).toBe(2);
    expect(rows(el)).toHaveLength(1);
  });

  it('does not read again when the dialog is cancelled', async () => {
    const el = await show();

    button(rows(el)[0], 'Înregistrează')?.click();
    await settle();

    expect(asked).toBe(1);
  });
});

describe('live', () => {
  it.each<EventKind>([
    'recheck.recorded',
    'garage.suspended',
    'garage.restored',
  ])('reads the rows again on %s', async (kind) => {
    const el = await show();
    answer = async () => listOf(row(1));

    events.next(message(kind));
    await new Promise((resolve) => setTimeout(resolve, 400));
    await settle();

    expect(asked).toBe(2);
    expect(rows(el)).toHaveLength(1);
  });

  it('reads again when the connection comes back', async () => {
    await show();

    resync.next();
    await settle();

    expect(asked).toBe(2);
  });
});
