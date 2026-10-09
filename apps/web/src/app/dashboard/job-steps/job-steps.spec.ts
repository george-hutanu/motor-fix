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

// @traces 424-FR-013
describe('a job’s steps', () => {
  it('lists the steps in order with the counter and the job above them', async () => {
    const { element } = await render();

    expect(rows(element).map(text)).toEqual([
      expect.stringContaining('Pas 1'),
      expect.stringContaining('Pas 2'),
      expect.stringContaining('Pas 3'),
    ]);
    const all = text(element);
    expect(all).toContain('Pașii lucrării');
    expect(all).toContain('1 din 3 gata');
    expect(all).toContain('Dacia Logan');
    expect(all).toContain('B 101 QAT');
    expect(ticks(element).map((t) => t.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
    ]);
  });

  it('says there are no steps yet and offers to add one', async () => {
    const { element } = await render({
      job: { steps: [], stepsDone: 0, stepsTotal: 0 },
    });

    expect(text(element)).toContain('Niciun pas încă');
    expect(button(element, 'Adaugă un pas')).toBeDefined();
  });

  it.each([
    ['the owner', 'garage'],
    ['the job’s mechanic', 'mechanic'],
  ] as const)(
    'gives %s the ticks, the menus and the add row',
    async (_who, role) => {
      const { element } = await render({ role });

      expect(ticks(element)).toHaveLength(3);
      expect(menu(element, 0)).not.toBeNull();
      expect(button(element, 'Adaugă un pas')).toBeDefined();
    },
  );

  it.each([
    ['a receptionist', { role: 'receptionist' as const }],
    ['a done job', { job: { status: 'done' as const } }],
    ['a cancelled job', { job: { status: 'cancelled' as const } }],
  ])('only shows the steps to %s', async (_who, options) => {
    const { element } = await render(options);

    expect(rows(element)).toHaveLength(3);
    expect(ticks(element)).toHaveLength(0);
    expect(menu(element, 0)).toBeNull();
    expect(button(element, 'Adaugă un pas')).toBeUndefined();
  });

  it('stops at 20 steps', async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => step(i + 1));
    const { element } = await render({
      job: { steps: twenty, stepsDone: 0, stepsTotal: 20 },
    });

    expect(button(element, 'Adaugă un pas')?.disabled).toBe(true);
    expect(text(element)).toContain('Cel mult 20 de pași');
  });
});

// @traces 424-FR-014
describe('ticking a step', () => {
  it('ticks through the waiting queue and shows it done at once', async () => {
    const { element, settle } = await render();

    ticks(element)[1].click();
    await settle();

    expect(waiting.add).toHaveBeenCalledWith('job.step', {
      body: { done: true },
      method: 'PUT',
      url: '/api/v1/garage/jobs/job-1/steps/s2/done',
    });
    expect(ticks(element)[1].getAttribute('aria-pressed')).toBe('true');
    expect(text(element)).toContain('2 din 3 gata');
  });

  it('unticks a ticked step the same way', async () => {
    const { element, settle } = await render({ role: 'mechanic' });

    ticks(element)[0].click();
    await settle();

    expect(waiting.add).toHaveBeenCalledWith(
      'job.step',
      expect.objectContaining({ body: { done: false } }),
    );
    expect(text(element)).toContain('0 din 3 gata');
  });

  it('sends nothing on a job not yet started, and says to start it first', async () => {
    const { element, settle } = await render({ job: { status: 'to_do' } });

    ticks(element)[1].click();
    await settle();

    expect(waiting.add).not.toHaveBeenCalled();
    expect(ticks(element)[1].getAttribute('aria-pressed')).toBe('false');
    expect(text(element.querySelector('[role="alert"]'))).toBe(
      'Pornește lucrarea mai întâi',
    );
  });

  it('says in English to start the job first', async () => {
    const { element, settle } = await render({
      job: { status: 'to_do' },
      language: 'en',
    });

    ticks(element)[1].click();
    await settle();

    expect(text(element.querySelector('[role="alert"]'))).toBe(
      'Start the job first',
    );
  });
});

// @traces 424-FR-014 424-FR-016
describe('writing the steps', () => {
  it('adds a step with its own key, after checking its length', async () => {
    const { element, settle } = await render();

    button(element, 'Adaugă un pas')?.click();
    await settle();
    const field = input(element) as HTMLInputElement;
    type(field, '  x ');
    button(element, 'Adaugă')?.click();
    await settle();

    expect(api['jobStepsControllerAdd']).not.toHaveBeenCalled();
    expect(text(element)).toContain('Între 2 și 80 de caractere');

    type(field, 'y'.repeat(81));
    button(element, 'Adaugă')?.click();
    await settle();
    expect(api['jobStepsControllerAdd']).not.toHaveBeenCalled();

    type(field, '  Probă pe drum ');
    button(element, 'Adaugă')?.click();
    await settle();

    expect(api['jobStepsControllerAdd']).toHaveBeenCalledWith({
      body: { text: 'Probă pe drum' },
      'Idempotency-Key': expect.stringMatching(/.{8,64}/),
      id: 'job-1',
    });
  });

  it('cancels an add without sending it', async () => {
    const { element, settle } = await render();

    button(element, 'Adaugă un pas')?.click();
    await settle();
    type(input(element) as HTMLInputElement, 'Probă pe drum');
    button(element, 'Anulează')?.click();
    await settle();

    expect(api['jobStepsControllerAdd']).not.toHaveBeenCalled();
    expect(input(element)).toBeNull();
  });

  it('renames a step from its menu', async () => {
    const { element, settle } = await render();

    menu(element, 1)?.click();
    await settle();
    item('Redenumește')?.click();
    await settle();
    const field = input(element) as HTMLInputElement;
    expect(field.value).toBe('Pas 2');
    type(field, 'Etriere scoase');
    button(element, 'Salvează')?.click();
    await settle();

    expect(api['jobStepsControllerRename']).toHaveBeenCalledWith({
      body: { text: 'Etriere scoase' },
      id: 'job-1',
      stepId: 's2',
    });
  });

  it('puts a refused rename back as it was and says why', async () => {
    const { element, settle } = await render();
    api['jobStepsControllerRename'].mockRejectedValue(
      refused(409, 'job_closed', 'Lucrarea e închisă'),
    );

    menu(element, 1)?.click();
    await settle();
    item('Redenumește')?.click();
    await settle();
    type(input(element) as HTMLInputElement, 'Etriere scoase');
    button(element, 'Salvează')?.click();
    await settle();
    await wait(0);
    await settle();

    expect(text(rows(element)[1])).toContain('Pas 2');
    expect(text(rows(element)[1])).not.toContain('Etriere scoase');
    expect(text(element.querySelector('[role="alert"]'))).not.toBe('');
  });

  it.each([
    ['Mută mai jos', 1, ['s1', 's3', 's2']],
    ['Mută mai sus', 1, ['s2', 's1', 's3']],
  ] as const)('sends the whole order on %s', async (name, n, order) => {
    const { element, settle } = await render();

    menu(element, n)?.click();
    await settle();
    item(name)?.click();
    await settle();

    expect(api['jobStepsControllerReorder']).toHaveBeenCalledWith({
      body: { stepIds: order },
      id: 'job-1',
    });
    expect(rows(element).map((r) => r.getAttribute('data-step'))).toEqual(
      order,
    );
  });

  it('offers no move up on the first step and no move down on the last', async () => {
    const { element, settle } = await render();

    menu(element, 0)?.click();
    await settle();
    expect(item('Mută mai sus')).toBeUndefined();
    expect(item('Mută mai jos')).toBeDefined();
  });

  it('removes a step from its menu', async () => {
    const { element, settle } = await render();

    menu(element, 2)?.click();
    await settle();
    item('Șterge')?.click();
    await settle();

    expect(api['jobStepsControllerRemove']).toHaveBeenCalledWith({
      id: 'job-1',
      stepId: 's3',
    });
    expect(rows(element)).toHaveLength(2);
  });
});

// @traces 424-FR-015
describe('changes made by someone else', () => {
  it.each(['job.step_done', 'job.step_undone', 'job.steps_changed'] as const)(
    'reads the job again on %s about it, once for a burst',
    async (kind) => {
      const { settle } = await render();

      for (let i = 0; i < 3; i++)
        events.next({ at: '2026-10-09T07:00:00.000Z', id: 'job-1', kind });
      await wait(400);
      await settle();

      expect(api['garageJobsControllerGet']).toHaveBeenCalledTimes(2);
    },
  );

  it('ignores the steps of another job', async () => {
    const { settle } = await render();

    events.next({
      at: '2026-10-09T07:00:00.000Z',
      id: 'job-2',
      kind: 'job.step_done',
    });
    await wait(400);
    await settle();

    expect(api['garageJobsControllerGet']).toHaveBeenCalledTimes(1);
  });

  it('keeps a step being renamed in edit mode, with what was typed', async () => {
    const { element, settle } = await render();
    menu(element, 1)?.click();
    await settle();
    item('Redenumește')?.click();
    await settle();
    type(input(element) as HTMLInputElement, 'Etriere scoa');

    current = job({
      steps: [
        step(1),
        step(2),
        step(3, { doneAt: '2026-10-09T07:00:00.000Z' }),
      ],
    });
    events.next({
      at: '2026-10-09T07:00:00.000Z',
      id: 'job-1',
      kind: 'job.step_done',
    });
    await wait(400);
    await settle();

    expect(input(element)?.value).toBe('Etriere scoa');
    expect(ticks(element)[2].getAttribute('aria-pressed')).toBe('true');
  });
});
