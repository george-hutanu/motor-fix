import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TestBed } from '@angular/core/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import { GarageJobsService, type JobSummaryDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { filter, Subject } from 'rxjs';

import { OwnJobsSection } from './own-jobs-section';
import { JobSteps } from '../../job-steps/job-steps';
import { Live } from '../../live';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The clock stands at 10:00 in Bucharest on 9 October 2026.
const NOW = new Date('2026-10-09T07:00:00Z');

const job = (over: Partial<JobSummaryDto> = {}): JobSummaryDto => ({
  bookingId: 'booking-1',
  car: {
    brand: 'Dacia',
    engine: '1.5 dCi',
    fuel: 'diesel',
    model: 'Logan',
    odometerKm: 84000,
    plate: 'B 101 QAT',
    year: 2018,
  },
  createdAt: '2026-10-08T09:00:00.000Z',
  driver: { shortName: 'Andrei M.' },
  etaAt: null,
  finishedAt: null,
  handedOverAt: null,
  id: 'job-1',
  jobs: [
    {
      id: 'rj-1',
      jobTypeId: 'type-1',
      nameEn: 'Brake pads',
      nameRo: 'Plăcuțe de frână',
      position: 0,
    },
  ],
  lastForcedUnlock: null,
  lock: null,
  mechanicId: 'mechanic-1',
  mechanicName: 'Elena Stan',
  odometerKm: null,
  pausedAt: null,
  receivedAt: null,
  startedAt: '2026-10-09T06:30:00.000Z',
  // 09:30 in Bucharest.
  startsAt: '2026-10-09T06:30:00.000Z',
  status: 'in_work',
  stepsDone: 1,
  stepsTotal: 3,
  updatedAt: '2026-10-08T09:00:00.000Z',
  workedSeconds: 0,
  ...over,
});

// Her day: one done at 08:00, one in work since 09:30, one to do at 12:00,
// one paused since yesterday, and one tomorrow at 09:00.
const day = () => [
  job({
    id: 'yesterday',
    startsAt: '2026-10-08T12:00:00.000Z',
    status: 'paused',
  }),
  job({ id: 'done', startsAt: '2026-10-09T05:00:00.000Z', status: 'done' }),
  job({ id: 'in-work' }),
  job({
    car: { ...job().car, brand: 'Skoda', model: 'Octavia', plate: 'CJ 22 MEC' },
    id: 'noon',
    startsAt: '2026-10-09T09:00:00.000Z',
    status: 'to_do',
  }),
  job({
    id: 'tomorrow',
    startsAt: '2026-10-10T06:00:00.000Z',
    status: 'to_do',
  }),
];

let events: Subject<LiveMessage>;
let resync: Subject<void>;
let list: jest.Mock;
let open: jest.Mock;
// Every other call on the jobs API the section makes: a write, or a read
// beside the list.
let others: string[];

async function render(
  answer: () => Promise<{ items: JobSummaryDto[] }> = async () => ({
    items: day(),
  }),
  language: 'ro' | 'en' = 'ro',
) {
  events = new Subject();
  resync = new Subject();
  list = jest.fn(async () => ({
    nextCursor: null,
    total: 0,
    ...(await answer()),
  }));
  open = jest.fn(async () => 'cancelled');
  others = [];
  const api = new Proxy(
    { garageJobsControllerList: list } as Record<string | symbol, unknown>,
    {
      get: (target, name) =>
        name in target || typeof name !== 'string' || !name.startsWith('garage')
          ? target[name]
          : (...args: unknown[]) => {
              others.push(name);
              return Promise.resolve(args);
            },
    },
  );
  TestBed.configureTestingModule({
    providers: [
      {
        provide: GarageJobsService,
        useValue: api,
      },
      { provide: Overlays, useValue: { open } },
      {
        provide: Live,
        useValue: {
          events,
          on: (kinds: readonly EventKind[]) =>
            events.pipe(
              filter((m) => (kinds as readonly string[]).includes(m.kind)),
            ),
          resync,
        },
      },
    ],
  });
  await TestBed.inject(I18n).enter('garage');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(OwnJobsSection);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
  };
  return { element, settle };
}

const text = (element: Element | null) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const rows = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('[data-job]'),
];

afterEach(() => TestBed.resetTestingModule());

const frozen = () =>
  jest.useFakeTimers({
    doNotFake: [
      'nextTick',
      'setImmediate',
      'clearImmediate',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'hrtime',
      'performance',
    ],
    now: NOW,
  });

// @traces 423-FR-001
describe("a mechanic's own jobs on Panou", () => {
  beforeEach(frozen);
  afterEach(() => jest.useRealTimers());

  it("lists today's jobs and the open work of earlier days, by start, and nothing of later days", async () => {
    const { element, settle } = await render();
    await settle();

    expect(list).toHaveBeenCalledTimes(1);
    expect(rows(element).map((row) => row.dataset['job'])).toEqual([
      'yesterday',
      'done',
      'in-work',
      'noon',
    ]);
  });

  it('writes each row as time, car, plate, works and stage', async () => {
    const { element, settle } = await render();
    await settle();

    const row = rows(element).find((r) => r.dataset['job'] === 'noon');
    expect(text(row ?? null)).toBe(
      '12:00 · Skoda Octavia · CJ 22 MEC · Plăcuțe de frână · De făcut',
    );
    expect(text(element)).not.toContain('Andrei');
  });

  it('dates the open work of an earlier day, as Lucrări does', async () => {
    const { element, settle } = await render();
    await settle();

    expect(text(rows(element)[0])).toMatch(/^\S.*, 15:00 · Dacia Logan/);
    expect(text(rows(element)[0])).toContain('În pauză');
  });

  it('leaves the plate out of a row whose read carries none', async () => {
    const { element, settle } = await render(async () => ({
      items: [job({ car: { ...job().car, plate: undefined } })],
    }));
    await settle();

    expect(text(rows(element)[0])).toBe(
      '09:30 · Dacia Logan · Plăcuțe de frână · În lucru',
    );
  });

  it('names her next booking: the earliest job starting after now', async () => {
    const { element, settle } = await render();
    await settle();

    expect(text(element.querySelector('[data-next]'))).toBe(
      'Următoarea programare: 12:00 · Skoda Octavia',
    );
  });

  it('never names a job already in work or paused as her next booking', async () => {
    const { element, settle } = await render(async () => ({
      items: [
        // Started early: in work and paused, though booked for later.
        job({ id: 'early', startsAt: '2026-10-09T08:00:00.000Z' }),
        job({
          id: 'held',
          startsAt: '2026-10-09T08:30:00.000Z',
          status: 'paused',
        }),
        job({
          car: { ...job().car, brand: 'Skoda', model: 'Octavia' },
          id: 'noon',
          startsAt: '2026-10-09T09:00:00.000Z',
          status: 'to_do',
        }),
      ],
    }));
    await settle();

    expect(text(element.querySelector('[data-next]'))).toBe(
      'Următoarea programare: 12:00 · Skoda Octavia',
    );
  });

  it("names a later day's booking with its day", async () => {
    const { element, settle } = await render(async () => ({
      items: [
        job({
          id: 'tomorrow',
          startsAt: '2026-10-10T06:00:00.000Z',
          status: 'to_do',
        }),
      ],
    }));
    await settle();

    expect(text(element.querySelector('[data-next]'))).toMatch(
      /^Următoarea programare: \S.*, 09:00 · Dacia Logan$/,
    );
  });

  it('puts her next booking and her load line under the rows', async () => {
    const { element, settle } = await render();
    await settle();

    const list = element.querySelector('.jobs');
    const next = element.querySelector('[data-next]');
    const load = element.querySelector('[data-load]');
    expect(list && next && load).toBeTruthy();
    const follows = (a: Element | null, b: Element | null) =>
      Boolean(
        a &&
          b &&
          a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    expect(follows(list, next)).toBe(true);
    expect(follows(next, load)).toBe(true);
  });

  it('counts the rows shown and those done in her load line', async () => {
    const { element, settle } = await render();
    await settle();

    expect(text(element.querySelector('[data-load]'))).toBe(
      '4 lucrări azi · 1 terminată',
    );
  });

  it('speaks English in English', async () => {
    const { element, settle } = await render(undefined, 'en');
    await settle();

    expect(text(element.querySelector('[data-load]'))).toBe(
      '4 jobs today · 1 done',
    );
    expect(text(element.querySelector('[data-next]'))).toBe(
      'Next booking: 12:00 · Skoda Octavia',
    );
    expect(text(rows(element)[2])).toContain('Brake pads');
  });
});

// @traces 423-FR-002
describe("the own jobs' states", () => {
  beforeEach(frozen);
  afterEach(() => jest.useRealTimers());

  it('says there is no job today, and still names a later booking', async () => {
    const { element, settle } = await render(async () => ({
      items: [
        job({
          id: 'tomorrow',
          startsAt: '2026-10-10T06:00:00.000Z',
          status: 'to_do',
        }),
      ],
    }));
    await settle();

    expect(rows(element)).toHaveLength(0);
    expect(text(element.querySelector('[role="status"]'))).toBe(
      'Nicio lucrare azi',
    );
    expect(element.querySelector('[data-next]')).not.toBeNull();
    expect(element.querySelector('[data-load]')).toBeNull();
    const empty = element.querySelector('[role="status"]');
    const next = element.querySelector('[data-next]');
    expect(
      empty && next
        ? empty.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING
        : 0,
    ).toBeTruthy();
  });

  it('shows only the empty line to a mechanic with no booking yet', async () => {
    const { element, settle } = await render(async () => ({ items: [] }));
    await settle();

    expect(text(element.querySelector('[role="status"]'))).toBe(
      'Nicio lucrare azi',
    );
    expect(element.querySelector('[data-next]')).toBeNull();
  });

  it('shows skeleton rows marked busy while the jobs load, never the empty line', async () => {
    let finish: (() => void) | undefined;
    const { element, settle } = await render(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ items: day() });
        }),
    );
    await settle();

    expect(element.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(element.querySelectorAll('[data-skeleton]')).toHaveLength(3);
    expect(text(element)).not.toContain('Nicio lucrare azi');
    finish?.();
    await settle();
    expect(element.querySelectorAll('[data-skeleton]')).toHaveLength(0);
  });

  it('shows the problem line with a retry when the read fails, and reads again on retry', async () => {
    let fail = true;
    const { element, settle } = await render(async () => {
      if (fail) throw new Error('offline');
      return { items: day() };
    });
    await settle();

    expect(text(element.querySelector('[role="alert"]'))).not.toBe('');
    const retry = [...element.querySelectorAll('button')].find(
      (b) => text(b) === 'Încearcă din nou',
    );
    expect(retry).toBeDefined();
    fail = false;
    retry?.click();
    await settle();
    await wait(0);
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
    expect(rows(element)).toHaveLength(4);
  });

  it('opens the job over Panou as Lucrări does when a row is chosen', async () => {
    const { element, settle } = await render();
    await settle();

    const row = rows(element)[2];
    (row.querySelector('button') ?? row).click();

    expect(open).toHaveBeenCalledWith(
      JobSteps,
      expect.objectContaining({ data: { id: 'in-work' }, shape: 'drawer' }),
    );
  });

  // @traces 423-FR-010
  it.each([
    'job.step_done',
    'job.step_undone',
    'job.steps_changed',
    'job.started',
    'job.paused',
    'job.resumed',
    'job.done',
    'job.reopened',
    'job.mechanic_changed',
    'booking.confirmed',
    'booking.moved',
    'booking.cancelled',
  ] as const)('reads her jobs again on %s', async (kind) => {
    // debounceTime reads Date.now(), which the frozen clock would stall.
    jest.useRealTimers();
    const { settle } = await render();
    await settle();

    events.next({ at: '2026-10-09T07:00:00.000Z', id: 'job-9', kind });
    await wait(400);
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
  });

  it('reads her jobs again when the live connection comes back', async () => {
    jest.useRealTimers();
    const { settle } = await render();
    await settle();

    resync.next();
    await wait(400);
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
  });
});

// @traces 423-FR-012
describe('the own jobs write nothing', () => {
  it('calls nothing on the jobs API but its list read, on load, on a re-read and on a row', async () => {
    const { element, settle } = await render();
    await settle();
    resync.next();
    await wait(400);
    await settle();
    (rows(element)[0].querySelector('button') ?? rows(element)[0]).click();
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenCalledWith({});
    expect(others).toEqual([]);
  });
});

// @traces 423-FR-011
describe('the own jobs on a phone', () => {
  const stylesheet = readFileSync(
    join(__dirname, 'own-jobs-section.css'),
    'utf8',
  );

  it('is a section card like the requests panel: same card, title and padding', async () => {
    const panel = readFileSync(
      join(__dirname, '../garage-requests-panel/garage-requests-panel.css'),
      'utf8',
    );
    // The panel's title is a section title.
    const title = readFileSync(
      join(__dirname, '../../section-title/section-title.css'),
      'utf8',
    );
    const block = (css: string, selector: string) =>
      css.match(new RegExp(`\\n${selector} \\{([^}]*)\\}`))?.[1] ?? '';
    const card = (css: string) =>
      ['padding', 'background', 'border', 'border-radius'].map((property) =>
        block(css, '\\.panel')
          .match(new RegExp(`\\n\\s*${property}: [^;]+;`))?.[0]
          .trim(),
      );
    expect(card(stylesheet).every(Boolean)).toBe(true);
    expect(card(stylesheet)).toEqual(card(panel));
    for (const property of [
      'font-family',
      'text-transform',
      'letter-spacing',
    ]) {
      const own = block(stylesheet, 'h2').match(
        new RegExp(`${property}: [^;]+;`),
      )?.[0];
      expect(own).toBeDefined();
      expect(block(title, 'h2')).toContain(own);
    }

    const { element, settle } = await render();
    await settle();
    const section = element.querySelector('section.panel');
    expect(section).not.toBeNull();
    expect(section?.querySelector('h2')).not.toBeNull();
    expect(section?.querySelector('.jobs')).not.toBeNull();
  });

  it('wraps a row instead of scrolling sideways', () => {
    expect(stylesheet).toMatch(/\.row \{[^}]*overflow-wrap: anywhere/);
    expect(stylesheet).toMatch(/\.row \{[^}]*white-space: normal/);
    expect(stylesheet).not.toMatch(/white-space: nowrap/);
  });

  it('sets no text under the body size on a phone but the card title, at the label size', () => {
    const at = stylesheet.indexOf('@media (min-width: 768px)');
    const phone = at < 0 ? stylesheet : stylesheet.slice(0, at);
    expect(phone).not.toMatch(/font-size: var\(--mf-size-small\)/);
    expect(
      phone.match(/font-size: var\(--mf-size-label\)/g) ?? [],
    ).toHaveLength(1);
    expect(phone).toMatch(/\nh2 \{[^}]*font-size: var\(--mf-size-label\)/);
    expect(stylesheet).not.toMatch(/font-size: \d+px/);
  });
});
