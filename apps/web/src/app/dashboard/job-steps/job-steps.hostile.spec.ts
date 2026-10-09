import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  GarageJobsService,
  type JobDto,
  type JobStepDto,
  type MeDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { OVERLAY_TASK } from '@motor-fix/overlays';
import { filter, Subject } from 'rxjs';

import { JobSteps } from './job-steps';
import { Live } from '../live';
import { Session } from '../session';
import { Waiting } from '../waiting';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const step = (n: number, over: Partial<JobStepDto> = {}): JobStepDto => ({
  customerLabel: `Pas ${n}`,
  doneAt: null,
  doneBy: null,
  id: `s${n}`,
  label: `Pas ${n}`,
  position: n,
  ...over,
});

const job = (over: Partial<JobDto> = {}): JobDto => ({
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
  finalPriceBani: null,
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
  stages: [],
  startedAt: '2026-10-09T06:30:00.000Z',
  startsAt: '2026-10-09T06:30:00.000Z',
  status: 'in_work',
  steps: [
    step(1, { doneAt: '2026-10-09T06:40:00.000Z', doneBy: 'acc-9' }),
    step(2),
    step(3),
  ],
  stepsDone: 1,
  stepsTotal: 3,
  ...over,
});

const refused = (status: number, code: string, message: string) =>
  new HttpErrorResponse({ error: { code, message }, status });

let events: Subject<LiveMessage>;
let api: Record<string, jest.Mock>;
let waiting: { add: jest.Mock; actions: ReturnType<typeof signal> };
let current: JobDto;

async function render(
  options: {
    job?: Partial<JobDto>;
    role?: MeDto['role'];
    language?: 'ro' | 'en';
  } = {},
) {
  events = new Subject();
  current = job(options.job);
  api = {
    garageJobsControllerGet: jest.fn(async () => current),
    jobStepsControllerAdd: jest.fn(async () => step(4, { label: 'Nou' })),
    jobStepsControllerRemove: jest.fn(async () => undefined),
    jobStepsControllerRename: jest.fn(async () => step(2, { label: 'Altul' })),
    jobStepsControllerReorder: jest.fn(async () => undefined),
  };
  waiting = { actions: signal([]), add: jest.fn(async () => 'key-1') };
  TestBed.configureTestingModule({
    providers: [
      { provide: GarageJobsService, useValue: api },
      { provide: Waiting, useValue: waiting },
      {
        provide: Session,
        useValue: {
          current: signal({ id: 'acc-1', role: options.role ?? 'garage' }),
        },
      },
      {
        provide: OVERLAY_TASK,
        useValue: {
          close: jest.fn(),
          data: { id: 'job-1' },
          markUnchanged: jest.fn(),
        },
      },
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
  if (options.language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(JobSteps);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
  };
  await settle();
  return { element, fixture, settle };
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const rows = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('[data-step]'),
];
const ticks = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'),
];
const button = (root: ParentNode, name: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => text(b) === name,
  );
const menu = (element: HTMLElement, n: number) =>
  rows(element)[n].querySelector<HTMLButtonElement>('button[aria-haspopup]');
// The menu's items, wherever the popover puts them.
const item = (name: string) => button(document.body, name);
const input = (element: HTMLElement) =>
  element.querySelector<HTMLInputElement>('input');
const type = (field: HTMLInputElement, value: string) => {
  field.value = value;
  field.dispatchEvent(new Event('input'));
};

afterEach(() => TestBed.resetTestingModule());

describe('a job’s steps under hostile use', () => {
  it('ticks while the job is paused', async () => {
    const { element, settle } = await render({ job: { status: 'paused' } });

    ticks(element)[1].click();
    await settle();

    expect(waiting.add).toHaveBeenCalledTimes(1);
    expect(ticks(element)[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('gives a receptionist nothing to press on a job not started', async () => {
    const { element } = await render({
      job: { status: 'to_do' },
      role: 'receptionist',
    });

    expect(ticks(element)).toHaveLength(0);
    expect(menu(element, 0)).toBeNull();
    expect(button(element, 'Adaugă un pas')).toBeUndefined();
    expect(rows(element)).toHaveLength(3);
  });

  it('counts 0 din 0 nowhere and hides the counter with no steps', async () => {
    const { element } = await render({
      job: { steps: [], stepsDone: 0, stepsTotal: 0 },
    });

    expect(text(element)).not.toContain('0 din 0');
  });

  it('ticks twice quickly and queues the first change only once per press', async () => {
    const { element, settle } = await render();

    ticks(element)[1].click();
    ticks(element)[1].click();
    await settle();

    const bodies = waiting.add.mock.calls.map((c) => c[1].body.done);
    expect(bodies[bodies.length - 1]).toBe(
      ticks(element)[1].getAttribute('aria-pressed') === 'true',
    );
  });

  it.each([
    ['two characters', 'ab', true],
    ['eighty characters padded', `  ${'z'.repeat(80)}  `, true],
    ['one character', 'a', false],
    ['spaces only', '        ', false],
    ['eighty one characters', 'z'.repeat(81), false],
  ])('checks %s before adding', async (_name, value, sent) => {
    const { element, settle } = await render();

    button(element, 'Adaugă un pas')?.click();
    await settle();
    type(input(element) as HTMLInputElement, value);
    button(element, 'Adaugă')?.click();
    await settle();

    expect(api['jobStepsControllerAdd']).toHaveBeenCalledTimes(sent ? 1 : 0);
    if (sent)
      expect(api['jobStepsControllerAdd'].mock.calls[0][0].body.text).toBe(
        value.trim(),
      );
  });

  it('refuses a one-character rename and sends nothing', async () => {
    const { element, settle } = await render();
    menu(element, 1)?.click();
    await settle();
    item('Redenumește')?.click();
    await settle();

    type(input(element) as HTMLInputElement, ' a ');
    button(element, 'Salvează')?.click();
    await settle();

    expect(api['jobStepsControllerRename']).not.toHaveBeenCalled();
  });

  it('moves the second step up by naming every step once', async () => {
    const { element, settle } = await render();

    menu(element, 1)?.click();
    await settle();
    item('Mută mai sus')?.click();
    await settle();

    expect(api['jobStepsControllerReorder']).toHaveBeenCalledWith({
      body: { stepIds: ['s2', 's1', 's3'] },
      id: 'job-1',
    });
    expect(rows(element).map((r) => r.dataset['step'])).toEqual([
      's2',
      's1',
      's3',
    ]);
  });

  it('puts the order back when the move is refused', async () => {
    const { element, settle } = await render();
    api['jobStepsControllerReorder'].mockRejectedValueOnce(
      refused(400, 'validation_failed', 'Ordinea nu se potrivește'),
    );

    menu(element, 1)?.click();
    await settle();
    item('Mută mai jos')?.click();
    await settle();

    expect(rows(element).map((r) => r.dataset['step'])).toEqual([
      's1',
      's2',
      's3',
    ]);
    expect(text(element.querySelector('[role="alert"]'))).not.toBe('');
  });

  it('puts the step back when its removal fails without signal', async () => {
    const { element, settle } = await render();
    api['jobStepsControllerRemove'].mockRejectedValueOnce(
      new HttpErrorResponse({ status: 0 }),
    );

    menu(element, 0)?.click();
    await settle();
    item('Șterge')?.click();
    await settle();

    expect(rows(element)).toHaveLength(3);
    expect(text(element.querySelector('[role="alert"]'))).not.toBe('');
  });

  it('uses a different key for each add', async () => {
    const { element, settle } = await render();

    for (const word of ['Primul pas', 'Al doilea']) {
      button(element, 'Adaugă un pas')?.click();
      await settle();
      type(input(element) as HTMLInputElement, word);
      button(element, 'Adaugă')?.click();
      await settle();
    }

    const keys = api['jobStepsControllerAdd'].mock.calls.map(
      (c) => c[0]['Idempotency-Key'],
    );
    expect(new Set(keys).size).toBe(2);
  });

  it('shows a job with no mechanic and no car plate without breaking', async () => {
    const { element } = await render({
      job: { mechanicId: null, mechanicName: null },
    });

    expect(rows(element)).toHaveLength(3);
  });

  it('reads the job again on a stage event about it', async () => {
    const { settle } = await render();

    events.next({
      at: '2026-10-09T07:00:00.000Z',
      id: 'job-1',
      kind: 'job.done',
    });
    await wait(400);
    await settle();

    expect(api['garageJobsControllerGet']).toHaveBeenCalledTimes(2);
  });

  it('turns read-only when a stage event closes the job', async () => {
    const { element, settle } = await render();
    current = job({ status: 'done' });

    events.next({
      at: '2026-10-09T07:00:00.000Z',
      id: 'job-1',
      kind: 'job.done',
    });
    await wait(400);
    await settle();

    expect(ticks(element)).toHaveLength(0);
    expect(button(element, 'Adaugă un pas')).toBeUndefined();
  });
});
