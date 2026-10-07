import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import { AdminService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { AdminOverview } from './admin-overview';
import { AdminPanel } from './admin-panel';
import { Live } from './live';

@Component({ imports: [AdminPanel], template: '<mf-admin-panel />' })
class Host {}

interface Answer {
  garagesWaiting: number;
  garagesListed: number;
  garagesApprovedThisMonth: number;
  activeDrivers: number;
  activeDriversMonthStart?: number;
}

const FIGURES: Answer = {
  activeDrivers: 12480,
  activeDriversMonthStart: 12168,
  garagesApprovedThisMonth: 9,
  garagesListed: 214,
  garagesWaiting: 2,
};

let resync: Subject<void>;
let answer: () => Promise<Answer>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(language: 'ro' | 'en' = 'ro') {
  const events = new Subject<LiveMessage>();
  resync = new Subject();
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
          resync,
        },
      },
      {
        provide: AdminService,
        useValue: { adminOverviewControllerOverview: () => answer() },
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

afterEach(() => TestBed.resetTestingModule());

describe('AdminPanel with awkward figures', () => {
  it.each([
    ['ro', 999, '999'],
    ['ro', 1000, '1.000'],
    ['en', 999, '999'],
    ['en', 1000, '1,000'],
    ['en', 2147483647, '2,147,483,647'],
  ] as const)('writes %s %i as %s', async (language, drivers, written) => {
    answer = async () => ({
      ...FIGURES,
      activeDrivers: drivers,
      activeDriversMonthStart: drivers,
    });
    const element = await open(language);

    const label = language === 'ro' ? 'Șoferi activi' : 'Active drivers';
    expect(text(tile(element, label), 'number')).toBe(written);
  });

  it('groups the change line like the number', async () => {
    answer = async () => ({
      ...FIGURES,
      activeDrivers: 2000000,
      activeDriversMonthStart: 0,
    });
    const element = await open();

    expect(text(tile(element, 'Șoferi activi'), 'line')).toBe(
      '+2.000.000 luna asta',
    );
  });

  it('measures from a month-start of zero instead of treating it as missing', async () => {
    answer = async () => ({ ...FIGURES, activeDriversMonthStart: 0 });
    const element = await open();

    expect(text(tile(element, 'Șoferi activi'), 'line')).toBe(
      '+12.480 luna asta',
    );
  });

  it('keeps the four unreleased tiles at a dash even when the answer carries stray figures for them', async () => {
    answer = async () =>
      ({
        ...FIGURES,
        answerRate: 92,
        bookings: 31,
        quoteRequestsToday: 7,
        reportedReviews: 3,
      }) as Answer;
    const element = await open();

    for (const label of [
      'Cereri de ofertă azi',
      'Rată de răspuns',
      'Programări',
      'Recenzii raportate',
    ]) {
      expect(text(tile(element, label), 'number')).toBe('—');
      expect(text(tile(element, label), 'line')).toBe('în curând');
    }
  });
});

describe('AdminPanel change line around zero and below', () => {
  const drivers = (activeDrivers: number, activeDriversMonthStart: number) => {
    answer = async () => ({
      ...FIGURES,
      activeDrivers,
      activeDriversMonthStart,
    });
  };

  it.each([
    [12167, 12168, '−1 luna asta'],
    [12168, 12168, '+0 luna asta'],
    [12169, 12168, '+1 luna asta'],
    [0, 12168, '−12.168 luna asta'],
    [0, 0, '+0 luna asta'],
  ])(
    'reads %i now against %i at the start as "%s"',
    async (now, start, line) => {
      drivers(now, start);
      const element = await open();

      expect(text(tile(element, 'Șoferi activi'), 'line')).toBe(line);
    },
  );

  it('writes a fall in English with the true minus sign and English grouping', async () => {
    drivers(1000, 2500);
    const element = await open('en');

    const t = tile(element, 'Active drivers');
    expect(text(t, 'line')).toBe('−1,500 this month');
    expect(text(t, 'line')).not.toContain('-');
  });

  it('carries the minus line into the accessible name', async () => {
    drivers(10, 22);
    const element = await open();

    expect(tile(element, 'Șoferi activi').getAttribute('aria-label')).toBe(
      'Șoferi activi, 10, −12 luna asta',
    );
  });

  it('names an unchanged count with +0, in English too', async () => {
    drivers(5, 5);
    const element = await open('en');

    expect(tile(element, 'Active drivers').getAttribute('aria-label')).toBe(
      'Active drivers, 5, +0 this month',
    );
  });

  it('does not let the active-drivers fall change the garages line', async () => {
    drivers(1, 500);
    const element = await open();

    expect(text(tile(element, 'Service‑uri listate'), 'line')).toBe(
      '+9 luna asta',
    );
  });
});
