import { TestBed } from '@angular/core/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import { GarageJobsService, type JobSummaryDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { filter, Subject } from 'rxjs';

import { JobsView } from './jobs-view';
import { JobSteps } from '../job-steps/job-steps';
import { Live } from '../live';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const job = (over: Partial<JobSummaryDto> = {}): JobSummaryDto => ({
  bookingId: 'booking-1',
  car: {
    brand: 'Dacia',
    engine: '1.5 dCi',
    fuel: 'diesel',
    model: 'Logan',
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
  mechanicId: 'mechanic-1',
  mechanicName: 'Mihai Dumitru',
  pausedAt: null,
  startedAt: '2026-10-09T06:30:00.000Z',
  // 09:30 in Bucharest.
  startsAt: '2026-10-09T06:30:00.000Z',
  status: 'in_work',
  stepsDone: 1,
  stepsTotal: 3,
  ...over,
});

let events: Subject<LiveMessage>;
let list: jest.Mock;
let open: jest.Mock;

async function render(
  answer: () => Promise<{ items: JobSummaryDto[] }> = async () => ({
    items: [job()],
  }),
  language: 'ro' | 'en' = 'ro',
) {
  events = new Subject();
  list = jest.fn(async () => ({
    nextCursor: null,
    total: 0,
    ...(await answer()),
  }));
  open = jest.fn(async () => 'cancelled');
  TestBed.configureTestingModule({
    providers: [
      {
        provide: GarageJobsService,
        useValue: { garageJobsControllerList: list },
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
          resync: new Subject<void>(),
        },
      },
    ],
  });
  await TestBed.inject(I18n).enter('garage');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(JobsView);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
  };
  return { element, fixture, settle };
}

const text = (element: Element) =>
  (element.textContent ?? '').replace(/\s+/g, ' ').trim();
const rows = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('[data-job]'),
];

afterEach(() => TestBed.resetTestingModule());

// @traces 424-FR-012
describe('Lucrări', () => {
  beforeEach(() =>
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
      now: new Date('2026-10-09T07:00:00Z'),
    }),
  );
  afterEach(() => jest.useRealTimers());

  it('shows a row per job: time, car, plate, jobs, mechanic, stage and steps done', async () => {
    const { element, settle } = await render();
    await settle();

    expect(list).toHaveBeenCalledTimes(1);
    const [row] = rows(element);
    const line = text(row);
    for (const part of [
      '09:30',
      'Dacia Logan',
      'B 101 QAT',
      'Plăcuțe de frână',
      'Mihai Dumitru',
      'În lucru',
      '1 din 3 gata',
    ])
      expect(line).toContain(part);
    expect(line).not.toContain('Andrei');
  });

  it.each([
    ['to_do', 'De făcut'],
    ['in_work', 'În lucru'],
    ['paused', 'În pauză'],
    ['done', 'Gata'],
  ] as const)('tags a %s job %s', async (status, tag) => {
    const { element, settle } = await render(async () => ({
      items: [job({ status })],
    }));
    await settle();

    expect(
      text(rows(element)[0].querySelector('[data-stage]') as Element),
    ).toBe(tag);
  });

  it('says so when a job has no steps yet, and speaks English in English', async () => {
    const { element, settle } = await render(
      async () => ({ items: [job({ stepsDone: 0, stepsTotal: 0 })] }),
      'en',
    );
    await settle();

    const line = text(rows(element)[0]);
    expect(line).toContain('No steps yet');
    expect(line).toContain('Brake pads');
    expect(line).toContain('In progress');
  });

  it('shows skeleton rows while the jobs load', async () => {
    let finish: (() => void) | undefined;
    const { element, settle } = await render(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ items: [job()] });
        }),
    );
    await settle();

    expect(element.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(
      0,
    );
    expect(rows(element)).toHaveLength(0);
    finish?.();
    await settle();
    expect(element.querySelectorAll('[data-skeleton]')).toHaveLength(0);
  });

  it('says there is no job today, and lists the next days’ jobs under it', async () => {
    const { element, settle } = await render(async () => ({
      items: [job({ startsAt: '2026-10-10T07:00:00.000Z', status: 'to_do' })],
    }));
    await settle();

    expect(text(element)).toContain('Nicio lucrare azi');
    expect(rows(element)).toHaveLength(1);
  });

  it('opens the job’s steps over the list when a row is chosen', async () => {
    const { element, settle } = await render();
    await settle();

    (rows(element)[0].querySelector('button') ?? rows(element)[0]).click();

    expect(open).toHaveBeenCalledWith(
      JobSteps,
      expect.objectContaining({ data: { id: 'job-1' }, shape: 'drawer' }),
    );
  });

  // @traces 424-FR-015
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
  ] as const)('reads the list again on %s', async (kind) => {
    // debounceTime reads Date.now(), which the frozen clock would stall.
    jest.useRealTimers();
    const { settle } = await render();
    await settle();

    events.next({ at: '2026-10-09T07:00:00.000Z', id: 'job-9', kind });
    await wait(400);
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
  });
});
