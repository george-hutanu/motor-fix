import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  AdminService,
  type DashboardLayoutDto,
  type DashboardPanelDto,
  type MeDto,
} from '@motor-fix/data-access';
import { filter, Subject } from 'rxjs';

import { AdminPanel } from './admin-panel';
import { adminLayoutProviders, layoutAnswer } from './admin-panel.testing';
import { AdminOverview } from '../admin-overview';
import { Live } from '../live';
import { Session } from '../session';

@Component({ imports: [AdminPanel], template: '<mf-admin-panel />' })
class Host {}

const KEYS = ['numbers', 'verification', 'growth', 'demand', 'log'];
const all = (
  hidden: readonly string[] = [],
  keys: readonly string[] = KEYS,
): DashboardPanelDto[] =>
  keys.map((key) => ({ key, visible: !hidden.includes(key) }));

async function settle() {
  for (let i = 0; i < 8; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open({
  read = async () => layoutAnswer(),
  save,
}: {
  read?: () => Promise<DashboardLayoutDto>;
  save?: (params: {
    body: { panels: DashboardPanelDto[] };
  }) => Promise<DashboardLayoutDto>;
} = {}) {
  const events = new Subject<LiveMessage>();
  const admin = {
    adminOverviewControllerGrowth: jest.fn(async () => ({ months: [] })),
    adminOverviewControllerOverview: jest.fn(async () => ({
      activeDrivers: 10,
      answerRate: 50,
      bookings: 1,
      garagesApprovedThisMonth: 1,
      garagesListed: 2,
      garagesWaiting: 0,
      observabilityUrl: null,
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
  const me = signal<MeDto | null>({
    id: 'admin-1',
    role: 'admin',
    roles: ['admin'],
  } as unknown as MeDto);
  const layout = {
    dashboardLayoutsControllerRead: jest.fn(read),
    dashboardLayoutsControllerReset: jest.fn(async () => layoutAnswer()),
    dashboardLayoutsControllerSave: jest.fn(
      save ??
        (async ({ body }: { body: { panels: DashboardPanelDto[] } }) =>
          layoutAnswer(body.panels)),
    ),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      ...adminLayoutProviders(layout),
      { provide: Session, useValue: { current: me, shown: me } },
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
  const fixture = TestBed.createComponent(Host);
  await settle();
  return { admin, element: fixture.nativeElement as HTMLElement, layout, me };
}

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const customise = (element: HTMLElement) =>
  element.querySelector<HTMLButtonElement>('[data-customise]');
const count = (element: HTMLElement) => element.querySelector('[data-count]');
const drawers = () => document.querySelectorAll('mf-dashboard-sections-panel');
const drawer = () => drawers()[0] as HTMLElement | undefined;
const control = (label: string) =>
  [...(drawer()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
    (each) => each.getAttribute('aria-label') === label || text(each) === label,
  );
const press = (label: string) => {
  const target = control(label);
  if (!target) throw new Error(`no ${label} in the panel`);
  target.click();
};
const rows = () =>
  [...(drawer()?.querySelectorAll('[data-row]') ?? [])].map((row) =>
    text(row.querySelector('.name')),
  );

afterEach(() => {
  document.body.innerHTML = '';
});

// @traces 1391-FR-003 1391-FR-007 1391-FR-014
describe('keys in the server list that name nothing on the web', () => {
  it('neither lists, counts nor draws keys that are names of object members', async () => {
    const { element } = await open({
      read: async () =>
        layoutAnswer(
          all(
            [],
            [
              ...KEYS,
              'constructor',
              '__proto__',
              'toString',
              '<img src=x onerror=alert(1)>',
            ],
          ),
        ),
    });

    customise(element)?.click();
    await settle();

    expect(rows()).toHaveLength(5);
    expect(text(count(element))).toBe('5 din 5 secțiuni afișate');
    expect(element.querySelector('img')).toBeNull();
  });

  it('counts nothing of an empty server list', async () => {
    const { element } = await open({ read: async () => layoutAnswer([]) });

    expect(text(count(element))).toBe('0 din 0 secțiuni afișate');
  });
});

// @traces 1391-FR-001
describe('opening and closing the panel', () => {
  it('opens one panel for two quick presses', async () => {
    const { element } = await open();

    customise(element)?.click();
    customise(element)?.click();
    await settle();

    expect(drawers()).toHaveLength(1);
  });

  it('closes on Escape and gives focus back to the button', async () => {
    const { element } = await open();
    const button = customise(element) as HTMLButtonElement;
    button.focus();
    button.click();
    await settle();

    drawer()?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    document.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    expect(drawers()).toHaveLength(0);
    expect(document.activeElement).toBe(button);
  });

  it('reads the layout again when another account signs in', async () => {
    const { element, layout, me } = await open();
    customise(element)?.click();
    await settle();
    expect(drawers()).toHaveLength(1);

    me.set({
      id: 'admin-2',
      role: 'admin',
      roles: ['admin'],
    } as unknown as MeDto);
    await settle();

    expect(layout.dashboardLayoutsControllerRead).toHaveBeenCalledTimes(2);
    expect(layout.dashboardLayoutsControllerRead).toHaveBeenLastCalledWith({
      role: 'admin',
    });
  });
});

// @traces 1391-FR-005
describe('the arrows in the panel', () => {
  it('keeps focus on the row that reached the top', async () => {
    const { element } = await open();
    customise(element)?.click();
    await settle();

    for (let i = 0; i < 4; i++) {
      press('Mută mai sus: Jurnal');
      await settle();
    }

    expect(rows()[0]).toBe('Jurnal');
    expect(control('Mută mai sus: Jurnal')?.disabled).toBe(true);
    expect(document.activeElement).toBe(control('Mută mai jos: Jurnal'));
  });

  it('disables the first row up and the last row down', async () => {
    const { element } = await open();
    customise(element)?.click();
    await settle();

    expect(control('Mută mai sus: Cifrele platformei')?.disabled).toBe(true);
    expect(control('Mută mai jos: Jurnal')?.disabled).toBe(true);
    expect(control('Mută mai jos: Cifrele platformei')?.disabled).toBe(false);
  });
});

// @traces 1391-FR-009
describe('a save that fails in the panel', () => {
  it('shows the message once after two failed presses and restores the order', async () => {
    const { element } = await open({
      save: () => Promise.reject(new Error('500')),
    });
    customise(element)?.click();
    await settle();

    press('Mută mai sus: Jurnal');
    press('Mută mai sus: Jurnal');
    await settle();

    expect(drawer()?.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(text(drawer()?.querySelector('[role="alert"]'))).toBe(
      'Nu am putut salva. Încearcă din nou.',
    );
    expect(rows().at(-1)).toBe('Jurnal');
    expect(document.activeElement).toBe(control('Mută mai sus: Jurnal'));
  });

  it('puts the section back on Panou when a switch save fails', async () => {
    const { admin, element } = await open({
      save: () => Promise.reject(new Error('500')),
    });
    customise(element)?.click();
    await settle();

    press('Ascunde: Jurnal');
    await settle();

    expect(text(count(element))).toBe('5 din 5 secțiuni afișate');
    expect(admin.systemLogControllerList).toHaveBeenCalled();
    expect(rows()).toHaveLength(5);
  });
});

// @traces 1391-FR-017
describe('requests for the data of hidden sections', () => {
  it('makes none for the log and the reviews overview while the log is hidden', async () => {
    const { admin } = await open({
      read: async () => layoutAnswer(all(['log'])),
    });

    expect(admin.systemLogControllerList).not.toHaveBeenCalled();
    expect(admin.reportQueueControllerList).not.toHaveBeenCalled();
  });

  it('makes none for any section when all are hidden', async () => {
    const { admin } = await open({
      read: async () => layoutAnswer(all(KEYS)),
    });

    expect(admin.adminOverviewControllerGrowth).not.toHaveBeenCalled();
    expect(admin.adminOverviewControllerQueue).not.toHaveBeenCalled();
    expect(admin.demandControllerDemand).not.toHaveBeenCalled();
    expect(admin.systemLogControllerList).not.toHaveBeenCalled();
    expect(admin.reportQueueControllerList).not.toHaveBeenCalled();
  });

  it('reads the growth once when the section is switched on', async () => {
    const { admin, element } = await open({
      read: async () => layoutAnswer(all(['growth'])),
    });
    customise(element)?.click();
    await settle();

    press('Ascunde: Creștere, ultimele 12 luni');
    await settle();

    expect(admin.adminOverviewControllerGrowth).toHaveBeenCalledTimes(1);
  });
});

// @traces 1391-FR-006 1391-FR-008
describe('the reset when every section is off', () => {
  it('brings the sections back and removes the empty line', async () => {
    const { element } = await open({
      read: async () => layoutAnswer(all(KEYS)),
    });
    expect(element.querySelector('[data-all-hidden]')).not.toBeNull();
    customise(element)?.click();
    await settle();

    press('Revino la varianta implicită');
    await settle();

    expect(element.querySelector('[data-all-hidden]')).toBeNull();
    expect(text(count(element))).toBe('5 din 5 secțiuni afișate');
  });
});
