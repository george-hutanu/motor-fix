import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  AdminService,
  type DashboardLayoutDto,
  type DashboardPanelDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { AdminPanel } from './admin-panel';
import { adminLayoutProviders, layoutAnswer } from './admin-panel.testing';
import { AdminOverview } from '../admin-overview';
import { Live } from '../live';

@Component({ imports: [AdminPanel], template: '<mf-admin-panel />' })
class Host {}

const KEYS = ['numbers', 'verification', 'growth', 'demand', 'log'];
const all = (
  hidden: readonly string[] = [],
  keys: readonly string[] = KEYS,
): DashboardPanelDto[] =>
  keys.map((key) => ({ key, visible: !hidden.includes(key) }));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function settle() {
  for (let i = 0; i < 8; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

let events: Subject<LiveMessage>;

async function open({
  read = async () => layoutAnswer(),
  language = 'ro',
}: {
  read?: () => Promise<DashboardLayoutDto>;
  language?: 'ro' | 'en';
} = {}) {
  events = new Subject<LiveMessage>();
  const admin = {
    adminOverviewControllerGrowth: jest.fn(async () => ({ months: [] })),
    adminOverviewControllerOverview: jest.fn(async () => ({
      activeDrivers: 10,
      answerRate: 50,
      bookings: 1,
      garagesApprovedThisMonth: 1,
      garagesListed: 2,
      garagesWaiting: 0,
      observabilityUrl: 'https://grafana.example/d/motorfix',
      reportsOverdue: 0,
      reportsPending: 0,
      requestsSent: 3,
    })),
    adminOverviewControllerQueue: jest.fn(async () => ({
      items: [],
      total: 0,
    })),
    demandControllerDemand: jest.fn(async () => ({
      brands: [],
      firstDay: '2026-09-18',
      jobs: [],
      lastDay: '2026-10-17',
      requests: 0,
    })),
    reportQueueControllerList: jest.fn(async () => ({
      items: [],
      oldestCreatedAt: null,
      overdue: 0,
      page: 1,
      pageSize: 20,
      total: 0,
    })),
    systemLogControllerList: jest.fn(async () => ({ items: [] })),
  };
  const layout = {
    dashboardLayoutsControllerRead: jest.fn(read),
    dashboardLayoutsControllerReset: jest.fn(async () => layoutAnswer()),
    dashboardLayoutsControllerSave: jest.fn(
      async ({ body }: { body: { panels: DashboardPanelDto[] } }) =>
        layoutAnswer(body.panels),
    ),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      ...adminLayoutProviders(layout),
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
      { provide: AdminService, useValue: admin },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(Host);
  await settle();
  return { admin, element: fixture.nativeElement as HTMLElement, layout };
}

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const panou = (element: HTMLElement) =>
  element.querySelector('mf-admin-panel') as HTMLElement;
// Each section on Panou in page order, the tiles as one.
const sections = (element: HTMLElement) => {
  const drawn: string[] = [];
  for (const child of panou(element).children) {
    const name = child.matches('[role="group"]')
      ? 'numbers'
      : child.matches('.observability')
        ? 'observability'
        : child.tagName.toLowerCase().replace('mf-admin-', '');
    if (['strip', 'empty'].some((skip) => child.matches(`.${skip}`))) continue;
    if (drawn.at(-1) !== name) drawn.push(name);
  }
  return drawn;
};
const customise = (element: HTMLElement) =>
  element.querySelector<HTMLButtonElement>('[data-customise]');
const count = (element: HTMLElement) => element.querySelector('[data-count]');
const drawer = () =>
  document.querySelector('mf-dashboard-sections-panel') as HTMLElement | null;
const press = (label: string) => {
  const target = [
    ...(drawer()?.querySelectorAll<HTMLButtonElement>('button') ?? []),
  ].find(
    (each) => each.getAttribute('aria-label') === label || text(each) === label,
  );
  if (!target) throw new Error(`no ${label} in the panel`);
  target.click();
};
const rows = () =>
  [...(drawer()?.querySelectorAll('[data-row]') ?? [])].map((row) =>
    text(row.querySelector('.name')),
  );

afterEach(() => {
  document.body.innerHTML = '';
  jest.dontMock('../dashboard-sections-panel/dashboard-sections-panel');
});

// @traces 1391-FR-001 1391-FR-007
describe('the strip at the top of Panou', () => {
  it('holds the button and the count of the listed sections shown', async () => {
    const { element } = await open({
      read: async () =>
        layoutAnswer(
          all(['growth'], [...KEYS, 'performance']).concat({
            key: 'system',
            visible: true,
          }),
        ),
    });

    expect(text(customise(element))).toBe('Personalizează panoul');
    expect(text(count(element))).toBe('4 din 5 secțiuni afișate');
    expect(count(element)?.getAttribute('aria-live')).toBe('polite');
  });

  it('reads in English', async () => {
    const { element } = await open({ language: 'en' });

    expect(text(customise(element))).toBe('Customise the dashboard');
    expect(text(count(element))).toBe('5 of 5 sections shown');
  });
});

// @traces 1391-FR-010
describe('waiting for the layout', () => {
  it('draws no section and no count, busy, until the layout answers', async () => {
    const pending = deferred<DashboardLayoutDto>();
    const { admin, element } = await open({ read: () => pending.promise });

    expect(sections(element)).toEqual([]);
    expect(count(element)).toBeNull();
    expect(panou(element).getAttribute('aria-busy')).toBe('true');
    expect(admin.adminOverviewControllerGrowth).not.toHaveBeenCalled();

    pending.resolve(layoutAnswer(all(['demand'])));
    await settle();
    expect(sections(element)).toEqual([
      'numbers',
      'observability',
      'queue',
      'growth',
      'reviews',
      'log',
    ]);
  });

  it('draws the default and says nothing when the layout cannot be read', async () => {
    const { element } = await open({
      read: () => Promise.reject(new Error('down')),
    });

    expect(sections(element)).toEqual([
      'numbers',
      'observability',
      'queue',
      'growth',
      'demand',
      'reviews',
      'log',
    ]);
    expect(text(count(element))).toBe('5 din 5 secțiuni afișate');
    expect(panou(element).querySelector('[role="alert"]')).toBeNull();
  });
});

// @traces 1391-FR-004 1391-FR-014 1391-FR-017
describe('the sections Panou draws', () => {
  it('follows the layout order, the reviews overview right before the log', async () => {
    const { element } = await open({
      read: async () =>
        layoutAnswer(
          all([], ['log', 'demand', 'numbers', 'verification', 'growth']),
        ),
    });

    expect(sections(element)).toEqual([
      'reviews',
      'log',
      'demand',
      'numbers',
      'observability',
      'queue',
      'growth',
    ]);
  });

  it('neither draws nor reads a hidden section', async () => {
    const { admin, element } = await open({
      read: async () =>
        layoutAnswer(all(['verification', 'growth', 'demand', 'log'])),
    });

    expect(sections(element)).toEqual(['numbers', 'observability']);
    expect(admin.adminOverviewControllerGrowth).not.toHaveBeenCalled();
    expect(admin.demandControllerDemand).not.toHaveBeenCalled();
    expect(admin.adminOverviewControllerQueue).not.toHaveBeenCalled();
    expect(admin.reportQueueControllerList).not.toHaveBeenCalled();
    expect(admin.systemLogControllerList).not.toHaveBeenCalled();
  });

  it('drops the tiles and the observability link with the numbers', async () => {
    const { element } = await open({
      read: async () => layoutAnswer(all(['numbers'])),
    });

    expect(panou(element).querySelector('[role="group"]')).toBeNull();
    expect(panou(element).querySelector('.observability')).toBeNull();
    expect(sections(element)[0]).toBe('queue');
  });

  it('draws nothing for a key it has no section for', async () => {
    const { element } = await open({
      read: async () =>
        layoutAnswer(all([], ['performance', ...KEYS, 'system'])),
    });

    expect(sections(element)).toEqual([
      'numbers',
      'observability',
      'queue',
      'growth',
      'demand',
      'reviews',
      'log',
    ]);
  });
});

// @traces 1391-FR-008
describe('every section switched off', () => {
  it('says so and draws nothing else', async () => {
    const { element } = await open({
      read: async () => layoutAnswer(all(KEYS)),
    });

    expect(sections(element)).toEqual([]);
    expect(text(element.querySelector('[data-all-hidden]'))).toBe(
      'Ai ascuns toate secțiunile. Pornește cel puțin una din „Personalizează panoul”.',
    );
    expect(text(count(element))).toBe('0 din 5 secțiuni afișate');
  });
});

// @traces 1391-FR-001 1391-FR-002 1391-FR-003 1391-FR-016 1391-FR-018
describe('the panel "Personalizează panoul" opens', () => {
  it('lists the sections in the layout order with their texts', async () => {
    const { element } = await open({
      read: async () =>
        layoutAnswer(
          all(
            ['growth'],
            ['log', 'numbers', 'verification', 'growth', 'demand'],
          ),
        ),
    });

    customise(element)?.click();
    await settle();

    expect(text(drawer())).toContain(
      'Oprește secțiunile de care nu ai nevoie și mută‑le în ordinea în care lucrezi. Se salvează în contul tău.',
    );
    expect(rows()).toEqual([
      'Jurnal',
      'Cifrele platformei',
      'Service‑uri de verificat',
      'Creștere, ultimele 12 luni',
      'Cereri pe marcă, 30 de zile',
    ]);
    expect(
      text(drawer()?.querySelector('[data-row]:nth-child(2) .description')),
    ).toBe('Service‑uri, cereri, programări, șoferi, recenzii');
    expect(
      drawer()
        ?.querySelector('[data-row]:nth-child(4)')
        ?.hasAttribute('data-off'),
    ).toBe(true);
    expect(
      document.querySelector('[role="dialog"]')?.textContent ?? '',
    ).toContain('Alege ce vezi pe panou');
  });

  it('lists no row for a key it has no texts for', async () => {
    const { element } = await open({
      read: async () => layoutAnswer(all([], [...KEYS, 'performance'])),
    });

    customise(element)?.click();
    await settle();

    expect(rows()).toHaveLength(5);
  });

  it('opens nothing when its code cannot be fetched, and tries again on the next press', async () => {
    const { element } = await open();
    jest.doMock('../dashboard-sections-panel/dashboard-sections-panel', () => {
      throw new Error('chunk failed');
    });

    customise(element)?.click();
    await settle();
    expect(drawer()).toBeNull();
    expect(sections(element)).toHaveLength(7);

    jest.dontMock('../dashboard-sections-panel/dashboard-sections-panel');
    customise(element)?.click();
    await settle();
    expect(drawer()).not.toBeNull();
  });
});

// @traces 1391-FR-004 1391-FR-005 1391-FR-006 1391-FR-009 1391-FR-017
describe('a change made in the panel', () => {
  it('hides a section from Panou at once and saves the whole layout', async () => {
    const { admin, element, layout } = await open({
      read: async () => layoutAnswer(all(['growth'])),
    });
    expect(admin.adminOverviewControllerGrowth).not.toHaveBeenCalled();

    customise(element)?.click();
    await settle();
    press('Ascunde: Jurnal');
    await settle();

    expect(sections(element)).not.toContain('log');
    expect(sections(element)).not.toContain('reviews');
    expect(layout.dashboardLayoutsControllerSave).toHaveBeenCalledWith({
      body: { panels: all(['growth', 'log']) },
      role: 'admin',
    });
    expect(text(count(element))).toBe('3 din 5 secțiuni afișate');

    press('Ascunde: Creștere, ultimele 12 luni');
    await settle();
    expect(sections(element)).toContain('growth');
    expect(admin.adminOverviewControllerGrowth).toHaveBeenCalledTimes(1);
  });

  it('moves a section on Panou with the arrows', async () => {
    const { element, layout } = await open();

    customise(element)?.click();
    await settle();
    press('Mută mai sus: Jurnal');
    await settle();

    const moved = ['numbers', 'verification', 'growth', 'log', 'demand'];
    expect(rows()).toEqual([
      'Cifrele platformei',
      'Service‑uri de verificat',
      'Creștere, ultimele 12 luni',
      'Jurnal',
      'Cereri pe marcă, 30 de zile',
    ]);
    expect(sections(element).slice(-3)).toEqual(['reviews', 'log', 'demand']);
    expect(layout.dashboardLayoutsControllerSave).toHaveBeenCalledWith({
      body: { panels: all([], moved) },
      role: 'admin',
    });
  });

  it('goes back to the default with every section on', async () => {
    const { element, layout } = await open({
      read: async () =>
        layoutAnswer(
          all(
            ['growth'],
            ['log', 'numbers', 'verification', 'growth', 'demand'],
          ),
        ),
    });

    customise(element)?.click();
    await settle();
    press('Revino la varianta implicită');
    await settle();

    expect(layout.dashboardLayoutsControllerReset).toHaveBeenCalledWith({
      role: 'admin',
    });
    expect(sections(element)).toEqual([
      'numbers',
      'observability',
      'queue',
      'growth',
      'demand',
      'reviews',
      'log',
    ]);
    expect(text(count(element))).toBe('5 din 5 secțiuni afișate');
  });
});

// @traces 1391-FR-011
describe('a change made in another tab', () => {
  it('redraws Panou and the open panel', async () => {
    let panels = all();
    const { element } = await open({ read: async () => layoutAnswer(panels) });
    customise(element)?.click();
    await settle();

    panels = all(
      ['numbers'],
      ['log', 'numbers', 'verification', 'growth', 'demand'],
    );
    events.next({
      at: new Date().toISOString(),
      id: 'admin-1',
      kind: 'dashboard_layout.updated',
    } as LiveMessage);
    await settle();

    expect(sections(element)[0]).toBe('reviews');
    expect(rows()[0]).toBe('Jurnal');
    expect(text(count(element))).toBe('4 din 5 secțiuni afișate');
  });
});
