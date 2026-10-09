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

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const step = (
  n: number,
  over: Partial<JobStepDto> = {},
): JobStepDto => ({
  customerLabel: `Pas ${n}`,
  doneAt: null,
  doneBy: null,
  id: `s${n}`,
  label: `Pas ${n}`,
  position: n,
  ...over,
});

export const job = (over: Partial<JobDto> = {}): JobDto => ({
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

export const refused = (status: number, code: string, message: string) =>
  new HttpErrorResponse({ error: { code, message }, status });

export let events: Subject<LiveMessage>;
export let api: Record<string, jest.Mock>;
export let waiting: { add: jest.Mock; actions: ReturnType<typeof signal> };
export let current: JobDto;

export async function render(
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

export const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
export const rows = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('[data-step]'),
];
export const ticks = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'),
];
export const button = (root: ParentNode, name: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => text(b) === name,
  );
export const menu = (element: HTMLElement, n: number) =>
  rows(element)[n].querySelector<HTMLButtonElement>('button[aria-haspopup]');
// The menu's items, wherever the popover puts them.
export const item = (name: string) => button(document.body, name);
export const input = (element: HTMLElement) =>
  element.querySelector<HTMLInputElement>('input');
export const type = (field: HTMLInputElement, value: string) => {
  field.value = value;
  field.dispatchEvent(new Event('input'));
};

// The job the next read answers.
export const serve = (next: JobDto) => {
  current = next;
};
