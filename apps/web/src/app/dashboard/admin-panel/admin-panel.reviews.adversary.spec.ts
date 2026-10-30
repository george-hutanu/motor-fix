import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import { AdminService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { AdminPanel } from './admin-panel';
import { AdminOverview } from '../admin-overview';
import { Live } from '../live';

@Component({ imports: [AdminPanel], template: '<mf-admin-panel />' })
class Host {}

interface Answer {
  garagesWaiting: number;
  garagesListed: number;
  garagesApprovedThisMonth: number;
  activeDrivers: number;
  activeDriversMonthStart?: number;
  requestsSent: number;
  answerRate?: number;
  bookings: number;
  observabilityUrl?: string;
  reportsPending?: number;
  reportsOverdue?: number;
}

const FIGURES: Answer = {
  activeDrivers: 12480,
  activeDriversMonthStart: 12168,
  answerRate: 66,
  bookings: 17,
  garagesApprovedThisMonth: 9,
  garagesListed: 214,
  garagesWaiting: 2,
  reportsOverdue: 0,
  reportsPending: 0,
  requestsSent: 1250,
};

let resync: Subject<void>;
let answer: () => Promise<Answer>;
const NO_MONTHS = async () => ({ months: [] });
let growth: () => Promise<{ months: unknown[] }> = NO_MONTHS;
const NO_DEMAND = async () => ({
  brands: [],
  firstDay: '2026-09-18',
  jobs: [],
  lastDay: '2026-10-17',
  requests: 0,
});
let demand: () => Promise<unknown> = NO_DEMAND;
const NO_REPORTS = async () => ({
  items: [],
  oldestCreatedAt: null,
  overdue: 0,
  page: 1,
  pageSize: 20,
  total: 0,
});
let reports: () => Promise<unknown> = NO_REPORTS;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

let events: Subject<LiveMessage>;

async function open(language: 'ro' | 'en' = 'ro') {
  events = new Subject<LiveMessage>();
  resync = new Subject();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      AdminOverview,
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
      {
        provide: AdminService,
        useValue: {
          adminOverviewControllerGrowth: () => growth(),
          adminOverviewControllerOverview: () => answer(),
          adminOverviewControllerQueue: async () => ({ items: [], total: 0 }),
          demandControllerDemand: () => demand(),
          reportQueueControllerList: () => reports(),
          systemLogControllerList: async () => ({ items: [] }),
        },
      },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(Host);
  await settle();
  return fixture.nativeElement as HTMLElement;
}

const tiles = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('mf-admin-panel [role="group"]'),
];
const tile = (element: HTMLElement, label: string) =>
  tiles(element).find(
    (t) => t.querySelector('.label')?.textContent?.trim() === label,
  ) as HTMLElement;
const text = (t: HTMLElement, part: 'number' | 'line') =>
  t.querySelector(`.${part}`)?.textContent?.trim();

afterEach(() => {
  TestBed.resetTestingModule();
  growth = NO_MONTHS;
  demand = NO_DEMAND;
  reports = NO_REPORTS;
});

afterEach(() => TestBed.resetTestingModule());

// @traces 1389-FR-002
describe('the reported reviews tile under hostile reads', () => {
  const LABEL = 'Recenzii raportate';

  it('shows a dash, not 0, when the read carries no pending count', async () => {
    answer = async () => {
      const { reportsPending: _p, ...rest } = FIGURES;
      return rest as Answer;
    };
    const element = await open();

    expect(text(tile(element, LABEL), 'number')).toBe('—');
  });

  it('shows no line when the read carries overdue only for an empty queue', async () => {
    answer = async () => ({ ...FIGURES, reportsOverdue: 0, reportsPending: 0 });
    const element = await open();

    expect(text(tile(element, LABEL), 'line')).toBeUndefined();
  });

  it('shows a dash on the tile after a failed re-read, never the last number', async () => {
    answer = async () => ({ ...FIGURES, reportsOverdue: 1, reportsPending: 3 });
    const element = await open();
    answer = async () => {
      throw new HttpErrorResponse({ status: 500 });
    };

    resync.next();
    await settle();

    expect(text(tile(element, LABEL), 'number')).toBe('—');
    expect(text(tile(element, LABEL), 'line')).toBeUndefined();
  });

  it('shows the line in English with the same number', async () => {
    answer = async () => ({ ...FIGURES, reportsOverdue: 2, reportsPending: 2 });
    const element = await open('en');

    expect(text(tile(element, 'Reported reviews'), 'line')).toBe(
      '2 over 48 hours',
    );
  });

  it('names a large pending number whole in the accessible name', async () => {
    answer = async () => ({
      ...FIGURES,
      reportsOverdue: 0,
      reportsPending: 12480,
    });
    const element = await open();

    expect(
      tile(element, LABEL)
        .getAttribute('aria-label')
        ?.replace(/[\s.\u00a0\u202f,]/g, ''),
    ).toBe('Recenzii raportate12480'.replace(/[\s.,]/g, ''));
  });

  it('draws the tile exactly once, in the sixth place', async () => {
    answer = async () => FIGURES;
    const element = await open();

    const labels = tiles(element).map((t) =>
      t.querySelector('.label')?.textContent?.trim(),
    );
    expect(labels.filter((l) => l === LABEL).length).toBe(1);
    expect(labels[5]).toBe(LABEL);
  });
});
