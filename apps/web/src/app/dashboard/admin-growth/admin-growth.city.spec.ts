import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import { AdminService } from '@motor-fix/data-access';
import { filter, Subject } from 'rxjs';

import { AdminGrowth } from './admin-growth';
import { AdminOverview } from '../admin-overview';
import { Live } from '../live';

@Component({ imports: [AdminGrowth], template: '<mf-admin-growth />' })
class Host {}

type Params = { city?: string } | undefined;
interface Month {
  month: string;
  activeDrivers?: number;
  garagesListed?: number;
}

const MONTHS = Array.from(
  { length: 12 },
  (_, i) =>
    `${i < 2 ? 2025 : 2026}-${String(((i + 10) % 12) + 1).padStart(2, '0')}`,
);
const country: Month[] = MONTHS.map((month, i) => ({
  activeDrivers: 6000 + i * 500,
  garagesListed: 100 + i * 10,
  month,
}));
const cluj: Month[] = MONTHS.map((month, i) => ({
  garagesListed: 10 + i,
  month,
}));

let growth: (params: Params) => Promise<{ months: Month[] }>;
let asked: Params[];

beforeEach(() => {
  asked = [];
  growth = async (params) => ({ months: params?.city ? cluj : country });
  globalThis.matchMedia = (query: string) =>
    ({
      addEventListener: () => {},
      matches: false,
      media: query,
      removeEventListener: () => {},
    }) as unknown as MediaQueryList;
});

afterEach(() => TestBed.resetTestingModule());

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open() {
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
          adminOverviewControllerGrowth: (params: Params) => {
            asked.push(params);
            return growth(params);
          },
          adminOverviewControllerOverview: async () => ({
            activeDrivers: 0,
            cities: [],
            garagesApprovedThisMonth: 0,
            garagesListed: 0,
            garagesWaiting: 0,
          }),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(Host);
  await settle();
  return {
    element: fixture.nativeElement as HTMLElement,
    overview: TestBed.inject(AdminOverview),
  };
}

const latest = (el: HTMLElement) =>
  [...el.querySelectorAll('.latest')].map((e) => e.textContent?.trim());
const messages = (el: HTMLElement) =>
  [...el.querySelectorAll('mf-line-chart .mf-chart-message')].map((e) =>
    e.textContent?.trim(),
  );

// @traces 163-FR-004 163-FR-010
describe('AdminGrowth, a chosen city', () => {
  it('reads the whole country with no parameter', async () => {
    const { element } = await open();

    expect(asked).toEqual([{}]);
    expect(latest(element)).toEqual(['11.500', '210']);
  });

  it("reads the city's twelve months when a city is chosen, and not for a period alone", async () => {
    const { element, overview } = await open();

    overview.choose('all', '7d');
    await settle();
    expect(asked).toHaveLength(1);

    overview.choose('cluj-napoca', '7d');
    await settle();
    expect(asked.at(-1)).toEqual({ city: 'cluj-napoca' });
    expect(latest(element)).toEqual(['—', '21']);
    expect(messages(element)).toEqual(['Încă nu sunt date']);
  });

  it('shows the chart skeletons while the city is read', async () => {
    const { element, overview } = await open();
    growth = () => new Promise(() => undefined);

    overview.choose('cluj-napoca', 'default');
    await settle();

    expect(
      element.querySelectorAll('mf-line-chart .mf-chart-skeleton'),
    ).toHaveLength(2);
  });

  it('shows only the answer for the latest city, dropping a slower older one', async () => {
    const finishes = new Map<string, () => void>();
    const { element, overview } = await open();
    growth = (params) =>
      new Promise((resolve) => {
        finishes.set(params?.city ?? 'all', () =>
          resolve({ months: params?.city === 'bucuresti' ? country : cluj }),
        );
      });

    overview.choose('bucuresti', 'default');
    await settle();
    overview.choose('cluj-napoca', 'default');
    await settle();
    finishes.get('cluj-napoca')?.();
    await settle();
    finishes.get('bucuresti')?.();
    await settle();

    expect(latest(element)).toEqual(['—', '21']);
  });
});
