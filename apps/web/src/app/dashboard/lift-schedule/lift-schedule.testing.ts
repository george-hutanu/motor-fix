import { signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  capabilitiesOf,
  type Permissions,
  type Role,
} from '@motor-fix/contracts/capabilities';
import {
  type GarageScheduleDto,
  type GarageScheduleEntryDto,
  GaragesService,
  type MeDto,
  type TimeBlockDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { LiftSchedule } from './lift-schedule';
import { fakeLive, wait } from '../garage-requests/garage-requests.testing';
import { Live } from '../live';
import { Session } from '../session';

// Friday 9 October 2026: Bucharest is UTC+3, so 06:00Z is 09:00 on the wall.
export const DAY = '2026-10-09';
// 13:00 in Bucharest.
export const NOW = new Date('2026-10-09T10:00:00Z');

const NONE: Permissions = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};

export const entry = (
  id: string,
  startsAt: string,
  minutes: number,
  more: Partial<GarageScheduleEntryDto> = {},
): GarageScheduleEntryDto => {
  const endsAt = new Date(
    Date.parse(startsAt) + minutes * 60_000,
  ).toISOString();
  const lift = more.lift === undefined ? 1 : more.lift;
  const mechanicId = more.mechanic?.id ?? null;
  return {
    car: { brand: 'Dacia', model: 'Logan', year: 2019 },
    confirmBy: null,
    customer: 'Dan V.',
    durationMinutes: minutes,
    id,
    jobStatus: 'to_do',
    jobs: ['Schimb ulei', 'Plăcuțe frână'],
    lift,
    mechanic: null,
    minutesLeft: null,
    segments: [{ endsAt, lift, mechanicId, startsAt }],
    startsAt,
    status: 'confirmed',
    ...more,
  };
};

export const block = (
  id: string,
  startsAt: string,
  endsAt: string,
  more: Partial<TimeBlockDto> = {},
): TimeBlockDto => ({
  endsAt,
  id,
  lift: 2,
  mechanic: null,
  note: 'Client la telefon',
  segments: [{ endsAt, startsAt }],
  startsAt,
  ...more,
});

export const schedule = (
  more: Partial<GarageScheduleDto> = {},
): GarageScheduleDto => ({
  blocks: [],
  days: [{ day: DAY, open: [{ from: '08:00', to: '18:00' }] }],
  entries: [],
  from: DAY,
  hoursSet: true,
  liftCount: 3,
  lifts: true,
  to: DAY,
  ...more,
});

const account = (
  role: Role,
  features: Record<string, boolean>,
  permissions: Permissions,
) =>
  ({
    capabilities: capabilitiesOf(role, permissions),
    garageAccess: [
      {
        features,
        garageId: 'garage-1',
        lastCheckedOn: '2026-10-01',
        name: 'Atelier Test',
        permissions,
        rechecked: false,
        role: role === 'garage' ? 'owner' : role,
        status: 'approved',
      },
    ],
    garageId: 'garage-1',
  }) as unknown as MeDto;

interface RenderOptions {
  role?: Role;
  features?: Record<string, boolean>;
  permissions?: Permissions;
  read?: () => Promise<GarageScheduleDto>;
  language?: 'ro' | 'en';
  // A page that holds the panel, in place of the panel on its own.
  host?: Type<unknown>;
}

// The panel on its own, at NOW, with fake timers that let promises run.
export async function renderPanel({
  features = {},
  host,
  language = 'ro',
  permissions = NONE,
  read = () => Promise.resolve(schedule()),
  role = 'garage',
}: RenderOptions = {}) {
  jest.useFakeTimers({
    advanceTimers: true,
    doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    now: NOW,
  });
  const me = signal(account(role, features, permissions));
  const live = fakeLive();
  const garageSchedule = jest.fn(read);
  const open = jest.fn(async () => 'changed');
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: Live, useValue: live },
      { provide: Session, useValue: { current: me, shown: me } },
      { provide: GaragesService, useValue: { garageSchedule } },
      { provide: Overlays, useValue: { open } },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(host ?? LiftSchedule);
  if (!host) fixture.componentRef.setInput('view', 'schedule');
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await wait(0);
    }
  };
  await settle();
  return { element, fixture, garageSchedule, live, me, open, settle };
}

export const text = (node: Element | null | undefined) =>
  (node?.textContent ?? '').replace(/\s+/g, ' ').trim();

export const panel = (element: HTMLElement) =>
  element.querySelector('[data-lift-schedule]');

export const blocks = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('[data-block]'),
];
