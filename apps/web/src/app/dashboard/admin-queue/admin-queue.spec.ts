import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  provideRouter,
  Router,
  UrlSegment,
} from '@angular/router';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  AdminService,
  type VerificationQueueDto,
  type VerificationQueueRowDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { BehaviorSubject, filter, Subject } from 'rxjs';

import { AdminQueue } from './admin-queue';
import { Live } from '../live';

// @traces 301-FR-002 301-FR-005 301-FR-007 301-FR-008 301-FR-009 301-FR-012 302-FR-003

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
let fileRead: jest.Mock;
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
  {
    overview = false,
    providers = [],
  }: { overview?: boolean; providers?: unknown[] } = {},
  language: 'ro' | 'en' = 'ro',
) {
  events = new Subject();
  resync = new Subject();
  asked = [];
  fileRead = jest.fn(async () => ({ file: { status: 'in_review' } }));
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
          verificationFileControllerRead: (read: { id: string }) =>
            fileRead(read),
        },
      },
      ...(providers as never[]),
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

  it('says "ieri" once Bucharest midnight passes on a page left open, with no new read', async () => {
    jest.useFakeTimers({
      advanceTimers: true,
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
      now: new Date('2026-10-16T20:50:00Z'),
    });
    try {
      const sent = '2026-10-16T20:45:00Z';
      answer = async () => ({
        items: [row(1, { submittedAt: sent })],
        total: 1,
      });
      const el = await open();
      expect(text(rows(el)[0].querySelector('.applied'))).toBe('azi, 23:45');

      jest.setSystemTime(new Date('2026-10-16T21:01:00Z'));
      jest.advanceTimersByTime(60_000);
      await settle();

      expect(text(rows(el)[0].querySelector('.applied'))).toBe('ieri, 23:45');
      expect(asked).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
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

  it('keeps the count on the line of the name at 320 px', async () => {
    const el = await open();

    expect(el.querySelector('h2')?.textContent).toContain(
      'verificat\u00a0·\u00a04',
    );
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

// @traces 069-FR-006
describe('live', () => {
  it.each<EventKind>([
    'verification.submitted',
    'verification.opened',
    'verification.check_recorded',
    'verification.decided',
    'verification.reopened',
    'garage_report.decided',
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

describe('the file named in the address', () => {
  let close: (result: unknown) => void;
  let overlays: { open: jest.Mock };
  let url: BehaviorSubject<UrlSegment[]>;

  const at = (...paths: string[]) => paths.map((p) => new UrlSegment(p, {}));

  function providers(...paths: string[]) {
    url = new BehaviorSubject(at(...paths));
    overlays = {
      open: jest.fn(
        () =>
          new Promise((resolve) => {
            close = resolve;
          }),
      ),
    };
    return [
      { provide: Overlays, useValue: overlays },
      { provide: ActivatedRoute, useValue: { url } },
    ];
  }

  it('opens the file as a wide drawer once, and returns to the list when it closes', async () => {
    await open({ providers: providers('file-9') });
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);

    expect(overlays.open).toHaveBeenCalledTimes(1);
    expect(overlays.open).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        // Every tick is saved as it is made: closing never asks to discard.
        confirmDiscard: false,
        data: { fileId: 'file-9' },
        shape: 'drawer-wide',
        title: 'admin.file.title',
      }),
    );
    events.next(message('verification.opened'));
    await settle();
    expect(overlays.open).toHaveBeenCalledTimes(1);

    close('cancelled');
    await settle();

    expect(navigate).toHaveBeenCalledWith(['/app/admin/garages'], {
      replaceUrl: true,
    });
  });

  it('closes the open drawer before it opens the next file the address names', async () => {
    await open({ providers: providers('file-9') });
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    const first = overlays.open.mock.calls[0]?.[1] as { signal: AbortSignal };
    const closeFirst = close;

    url.next(at('file-10'));
    await settle();

    expect(first.signal.aborted).toBe(true);
    expect(overlays.open).toHaveBeenCalledTimes(2);
    expect(overlays.open).toHaveBeenLastCalledWith(
      expect.any(Function),
      expect.objectContaining({ data: { fileId: 'file-10' } }),
    );
    closeFirst('cancelled');
    await settle();
    expect(navigate).not.toHaveBeenCalled();

    close('cancelled');
    await settle();
    expect(navigate).toHaveBeenCalledWith(['/app/admin/garages'], {
      replaceUrl: true,
    });
  });

  it('leaves the address alone when it already names another place', async () => {
    await open({ providers: providers('file-9') });
    const navigate = jest
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);

    url.next([]);
    close('cancelled');
    await settle();

    expect(navigate).not.toHaveBeenCalled();
  });

  it('opens nothing at the bare list or on the overview', async () => {
    await open({ providers: providers() });
    expect(overlays.open).not.toHaveBeenCalled();
    TestBed.resetTestingModule();

    await open({ overview: true, providers: providers('file-9') });
    expect(overlays.open).not.toHaveBeenCalled();
  });
});

// @traces 303-FR-008 303-FR-012
describe('a file approved while its row is shown', () => {
  const decided = (id: string): LiveMessage => ({
    at: '2026-10-18T09:00:00.000Z',
    id,
    kind: 'verification.decided',
  });
  // The queue as the server answers once file-2 is decided: it waits no more.
  const without = (id: string) => {
    const items = queueOf(4).items.filter((r) => r.id !== id);
    return { items, total: items.length };
  };
  async function decide(el: HTMLElement, id: string, status: string) {
    fileRead.mockResolvedValue({ file: { id, status } });
    answer = async () => without(id);
    events.next(decided(id));
    await new Promise((resolve) => setTimeout(resolve, 400));
    await settle();
    return el;
  }

  it.each([
    ['ro', 'Aprobat, e pe hartă'],
    ['en', 'Approved, on the map'],
  ] as const)(
    'keeps its place, reading "%s" in place of its lamp and waiting line',
    async (language, line) => {
      const el = await open({}, language);

      await decide(el, 'file-2', 'approved');

      expect(fileRead).toHaveBeenCalledWith({ id: 'file-2' });
      expect(fileRead).toHaveBeenCalledTimes(1);
      const names = rows(el).map((r) => text(r.querySelector('.name')));
      expect(names).toEqual([
        'Service 1',
        'Service 2',
        'Service 3',
        'Service 4',
      ]);
      const kept = rows(el)[1] as HTMLElement;
      expect(text(kept.querySelector('.state'))).toBe(line);
      expect(kept.querySelector('mf-lamp')).toBeNull();
      expect(kept.querySelector('.waiting')).toBeNull();
      expect(kept.querySelector('.applied')).toBeNull();
      expect(kept.querySelector('a.open')?.getAttribute('href')).toBe(
        '/app/admin/garages/file-2',
      );
    },
  );

  // @traces 303-FR-008
  it('keeps its place when a re-read for another file dropped it before its own event came', async () => {
    const el = await open();
    fileRead.mockResolvedValue({ file: { id: 'file-2', status: 'approved' } });
    // The approval is saved; another file's event re-reads the queue first.
    answer = async () => without('file-2');
    events.next(message('verification.check_recorded'));
    await new Promise((resolve) => setTimeout(resolve, 400));
    await settle();
    expect(rows(el)).toHaveLength(3);

    events.next(decided('file-2'));
    await new Promise((resolve) => setTimeout(resolve, 400));
    await settle();

    expect(rows(el).map((r) => text(r.querySelector('.name')))).toEqual([
      'Service 1',
      'Service 2',
      'Service 3',
      'Service 4',
    ]);
    expect(text(rows(el)[1]?.querySelector('.state'))).toBe(
      'Aprobat, e pe hartă',
    );
  });

  it('lets the count drop as the server counts', async () => {
    const el = await open();

    await decide(el, 'file-2', 'approved');

    expect(text(el.querySelector('h2'))).toBe('Service‑uri de verificat · 3');
  });

  it('stays outside the page size: the next page still reads 20 more', async () => {
    answer = async ({ limit = 20, offset = 0 }) => ({
      items: Array.from({ length: Math.min(limit, 45 - offset) }, (_, i) =>
        row(offset + i + 1),
      ),
      total: 45,
    });
    const el = await open();
    fileRead.mockResolvedValue({ file: { status: 'approved' } });
    answer = async ({ limit = 20, offset = 0 }) => {
      const left = Array.from({ length: 45 }, (_, i) => row(i + 1)).filter(
        (r) => r.id !== 'file-3',
      );
      return { items: left.slice(offset, offset + limit), total: 44 };
    };
    events.next(decided('file-3'));
    await new Promise((resolve) => setTimeout(resolve, 400));
    await settle();

    expect(rows(el)).toHaveLength(21);
    expect(text(rows(el)[2]?.querySelector('.name'))).toBe('Service 3');
    button(el, 'Mai multe')?.click();
    await settle();

    expect(asked.at(-1)).toMatchObject({ limit: 40 });
    expect(rows(el)).toHaveLength(41);
  });

  // @traces 305-FR-006 305-FR-011
  it.each([
    ['ro', 'Respins'],
    ['en', 'Rejected'],
  ] as const)(
    'keeps a rejected row in its place in %s, reading "%s", the file still open to read',
    async (language, line) => {
      const el = await open({}, language);

      await decide(el, 'file-2', 'rejected');

      expect(rows(el).map((r) => text(r.querySelector('.name')))).toEqual([
        'Service 1',
        'Service 2',
        'Service 3',
        'Service 4',
      ]);
      const kept = rows(el)[1] as HTMLElement;
      expect(text(kept.querySelector('.state'))).toBe(line);
      expect(kept.querySelector('.state .outcome')?.classList).toContain(
        'rejected',
      );
      expect(kept.querySelector('mf-lamp')).toBeNull();
      expect(kept.querySelector('.waiting')).toBeNull();
      expect(kept.querySelector('a.open')?.getAttribute('href')).toBe(
        '/app/admin/garages/file-2',
      );
      expect(text(el.querySelector('h2'))).toContain('· 3');
    },
  );

  // @traces 305-FR-006
  it('forgets a rejected row with the view: a fresh visit lists waiting files only', async () => {
    const el = await open();
    await decide(el, 'file-2', 'rejected');
    TestBed.resetTestingModule();
    document.body.innerHTML = '';
    answer = async () => without('file-2');

    const again = await open();

    expect(rows(again)).toHaveLength(3);
  });

  it.each(['more_requested'])(
    'leaves the row to drop when the file was %s',
    async (status) => {
      const el = await open();

      await decide(el, 'file-2', status);

      expect(rows(el).map((r) => text(r.querySelector('.name')))).toEqual([
        'Service 1',
        'Service 3',
        'Service 4',
      ]);
    },
  );

  it('reads nothing for a file it does not show', async () => {
    await open();

    events.next(decided('file-99'));
    await new Promise((resolve) => setTimeout(resolve, 400));
    await settle();

    expect(fileRead).not.toHaveBeenCalled();
  });

  it('forgets the row with the view: a fresh visit lists waiting files only', async () => {
    const el = await open();
    await decide(el, 'file-2', 'approved');
    TestBed.resetTestingModule();
    document.body.innerHTML = '';
    answer = async () => without('file-2');

    const again = await open();

    expect(rows(again)).toHaveLength(3);
  });
});
