import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import { AdminService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { AdminPanel } from './admin-panel';
import { AdminOverview } from '../admin-overview';
import { Live } from '../live';

@Component({ imports: [AdminPanel], template: '<mf-admin-panel />' })
class Host {}

type Params = { city?: string; period?: string } | undefined;

const answerFor = (params: Params) => ({
  activeDrivers: 12480,
  activeDriversMonthStart: 12168,
  cities: [{ garages: 214, key: 'all', name: 'România' }],
  garagesApprovedThisMonth: 9,
  garagesListed: 214,
  garagesWaiting: 2,
  ...(params?.period && {
    activeDriversPeriodStart: params.period === '12m' ? undefined : 12500,
    garagesApprovedInPeriod: 3,
  }),
});

let answer: (params: Params) => Promise<unknown>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(language: 'ro' | 'en' = 'ro') {
  const events = new Subject<LiveMessage>();
  TestBed.configureTestingModule({
    providers: [
      AdminOverview,
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
      {
        provide: AdminService,
        useValue: {
          adminOverviewControllerGrowth: async () => ({ months: [] }),
          adminOverviewControllerOverview: (params: Params) => answer(params),
        },
      },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(Host);
  await settle();
  return {
    element: fixture.nativeElement as HTMLElement,
    overview: TestBed.inject(AdminOverview),
  };
}

const tile = (element: HTMLElement, label: string) =>
  [
    ...element.querySelectorAll<HTMLElement>('mf-admin-panel [role="group"]'),
  ].find(
    (t) => t.querySelector('.label')?.textContent?.trim() === label,
  ) as HTMLElement;
const line = (t: HTMLElement) => t.querySelector('.line')?.textContent?.trim();

afterEach(() => TestBed.resetTestingModule());

// @traces 163-FR-011
describe('AdminPanel, a chosen period', () => {
  beforeEach(() => {
    answer = async (params) => answerFor(params);
  });

  it.each([
    ['default', '+9 luna asta'],
    ['today', '+3 azi'],
    ['7d', '+3 în ultimele 7 zile'],
    ['30d', '+3 în ultimele 30 de zile'],
    ['month', '+3 luna asta'],
    ['12m', '+3 în ultimele 12 luni'],
  ] as const)(
    'names the %s period in the garages line in Romanian',
    async (period, expected) => {
      const { element, overview } = await open();
      overview.choose('all', period);
      await settle();

      const garages = tile(element, 'Service‑uri listate');
      expect(line(garages)).toBe(expected);
      expect(garages.getAttribute('aria-label')).toBe(
        `Service‑uri listate, 214, ${expected}`,
      );
    },
  );

  it.each([
    ['today', '+3 today'],
    ['7d', '+3 in the last 7 days'],
    ['30d', '+3 in the last 30 days'],
    ['month', '+3 this month'],
    ['12m', '+3 in the last 12 months'],
  ] as const)('names the %s period in English', async (period, expected) => {
    const { element, overview } = await open('en');
    overview.choose('all', period);
    await settle();

    expect(line(tile(element, 'Garages listed'))).toBe(expected);
  });

  it('gives the active drivers the change since the period start, with its sign', async () => {
    const { element, overview } = await open();
    overview.choose('all', '7d');
    await settle();

    const drivers = tile(element, 'Șoferi activi');
    expect(line(drivers)).toBe('−20 în ultimele 7 zile');
    expect(drivers.getAttribute('aria-label')).toBe(
      'Șoferi activi, 12.480, −20 în ultimele 7 zile',
    );
  });

  it('gives the active drivers no line when the period start is missing, or for today', async () => {
    const { element, overview } = await open();
    overview.choose('all', '12m');
    await settle();
    expect(line(tile(element, 'Șoferi activi'))).toBeUndefined();

    overview.choose('all', 'today');
    await settle();
    expect(line(tile(element, 'Șoferi activi'))).toBeUndefined();
  });

  it('shows the skeletons and marks the tiles busy while a choice is read', async () => {
    const { element, overview } = await open();
    answer = () => new Promise(() => undefined);
    overview.choose('all', '30d');
    await settle();

    const garages = tile(element, 'Service‑uri listate');
    expect(garages.querySelector('.skeleton')).not.toBeNull();
    expect(garages.getAttribute('aria-busy')).toBe('true');
    expect(
      element.querySelector('mf-admin-panel')?.getAttribute('aria-busy'),
    ).toBe('true');
  });
});
