import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  capabilitiesOf,
  type Permissions,
  type Role,
} from '@motor-fix/contracts/capabilities';
import {
  type DashboardLayoutDto,
  DashboardLayoutsService,
  type DashboardPanelDto,
  GarageJobsService,
  GarageRequestsService,
  GaragesService,
  type MeDto,
  ReviewsService,
} from '@motor-fix/data-access';
import { Overlays } from '@motor-fix/overlays';

import { GarageHome } from './garage-home';
import { DashboardSectionsPanel } from '../../dashboard-sections-panel/dashboard-sections-panel';
import { staffPage } from '../../garage-reviews/garage-reviews.testing';
import { Live } from '../../live';
import { Session } from '../../session';
import { fakeLive, listOf, wait } from '../garage-requests.testing';
import { GarageRequestsFeed } from '../garage-requests-feed';

const NONE: Permissions = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};
const QUOTES: Permissions = { ...NONE, canAnswerQuotes: true };

const KEYS = [
  'kpi',
  'now',
  'req',
  'load',
  'sched',
  'funnel',
  'brands',
  'reviews',
];
const layoutOf = (hidden: readonly string[] = []): DashboardPanelDto[] =>
  KEYS.map((key) => ({ key, visible: !hidden.includes(key) }));
const answer = (panels: DashboardPanelDto[], role: string) =>
  ({ panels, role, updatedAt: null }) as DashboardLayoutDto;

type Status = 'draft' | 'approved' | 'suspended';

const account = (
  role: Role,
  status: Status,
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
        status,
      },
    ],
    garageId: 'garage-1',
    role,
    roles: [role],
  }) as unknown as MeDto;

async function render(
  role: Role,
  {
    features = {},
    permissions = NONE,
    read,
    save,
    status = 'approved',
  }: {
    features?: Record<string, boolean>;
    permissions?: Permissions;
    read?: () => Promise<DashboardLayoutDto>;
    save?: (params: {
      body: { panels: DashboardPanelDto[] };
    }) => Promise<DashboardLayoutDto>;
    status?: Status;
  } = {},
) {
  const me = signal(account(role, status, features, permissions));
  const live = fakeLive();
  const open = jest.fn(async () => 'done');
  const api = {
    dashboardLayoutsControllerRead: jest.fn(
      read ?? (async () => answer(layoutOf(), role)),
    ),
    dashboardLayoutsControllerSave: jest.fn(
      save ??
        (async ({ body }: { body: { panels: DashboardPanelDto[] } }) =>
          answer(body.panels, role)),
    ),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      GarageRequestsFeed,
      { provide: Live, useValue: live },
      { provide: Session, useValue: { current: me, shown: me } },
      { provide: DashboardLayoutsService, useValue: api },
      {
        provide: GarageRequestsService,
        useValue: {
          garageRequestsControllerList: async () => listOf([]),
        },
      },
      {
        provide: GarageJobsService,
        useValue: {
          garageJobsControllerList: async () => ({
            items: [],
            nextCursor: null,
            total: 0,
          }),
        },
      },
      { provide: Overlays, useValue: { open } },
      {
        provide: ReviewsService,
        useValue: {
          garageReviewsControllerRead: async () =>
            staffPage({ items: [], total: 0 }),
        },
      },
      {
        provide: GaragesService,
        useValue: {
          legalCheckControllerRead: () =>
            Promise.reject(new HttpErrorResponse({ status: 404 })),
          verificationStatusControllerRead: () => new Promise(() => undefined),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(GarageHome);
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await wait(0);
    }
  };
  await settle();
  return {
    api,
    element: fixture.nativeElement as HTMLElement,
    live,
    open,
    settle,
  };
}

const text = (el: Element | null) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const keys = (element: HTMLElement) =>
  [...element.querySelectorAll('[data-section]')].map((el) =>
    el.getAttribute('data-section'),
  );
const count = (element: HTMLElement) => element.querySelector('[data-count]');
const button = (element: HTMLElement) =>
  element.querySelector<HTMLButtonElement>('[data-customise]');
const pill = (element: HTMLElement) =>
  element.querySelector('[data-verified-pill]');
const allHidden = (element: HTMLElement) =>
  element.querySelector('[data-all-hidden]');

type Opened = [
  unknown,
  { data: { rows: () => { key: string; shown: boolean }[] } },
];
const openedRows = (open: jest.Mock) =>
  (open.mock.calls[0] as unknown as Opened)[1].data.rows();

// @traces 011-FR-002
// @traces 011-FR-013
describe('Panou drawn from the person’s layout', () => {
  it('draws no section and no count before the layout answers', async () => {
    const { element } = await render('garage', {
      read: () => new Promise(() => undefined),
    });

    expect(keys(element)).toEqual([]);
    expect(count(element)).toBeNull();
    expect(pill(element)).not.toBeNull();
    expect(button(element)).not.toBeNull();
  });

  it('leaves out the sections the layout hides, keeping the order', async () => {
    const { element } = await render('garage', {
      read: async () => answer(layoutOf(['sched', 'funnel']), 'garage'),
    });

    expect(keys(element)).toEqual(['kpi', 'req', 'load', 'brands', 'reviews']);
  });

  it('hides after the four steps: a section shown by the layout stays out while its feature is off', async () => {
    const { element } = await render('garage', {
      features: { lift_schedule: false },
      read: async () => answer(layoutOf(['reviews']), 'garage'),
    });

    expect(keys(element)).toEqual(['kpi', 'req', 'load', 'funnel', 'brands']);
    expect(text(count(element))).toBe('5 din 6 secțiuni afișate');
  });

  it('draws the default after a failed read', async () => {
    const { element } = await render('garage', {
      read: () => Promise.reject(new HttpErrorResponse({ status: 500 })),
    });

    expect(keys(element)).toEqual([
      'kpi',
      'req',
      'load',
      'sched',
      'funnel',
      'brands',
      'reviews',
    ]);
    expect(text(count(element))).toBe('7 din 7 secțiuni afișate');
  });
});

// @traces 011-FR-003
// @traces 011-FR-013
// @traces 011-FR-011
describe('the strip row count', () => {
  it('counts the owner’s sections', async () => {
    const { element } = await render('garage');

    expect(text(count(element))).toBe('7 din 7 secțiuni afișate');
    expect(count(element)?.getAttribute('aria-live')).toBe('polite');
    expect(text(button(element))).toBe('Personalizează panoul');
  });

  it('counts down when a section is hidden', async () => {
    const { element } = await render('garage', {
      read: async () => answer(layoutOf(['sched']), 'garage'),
    });

    expect(text(count(element))).toBe('6 din 7 secțiuni afișate');
  });

  it('counts the receptionist’s own list', async () => {
    const { element } = await render('receptionist', {
      read: async () => answer(layoutOf(['reviews']), 'receptionist'),
    });

    expect(text(count(element))).toBe('6 din 7 secțiuni afișate');
  });

  it('counts a mechanic’s two sections beside no pill', async () => {
    const { element } = await render('mechanic');

    expect(text(count(element))).toBe('2 din 2 secțiuni afișate');
    expect(pill(element)).toBeNull();
    expect(button(element)).not.toBeNull();
  });

  it('counts the requests for a mechanic who may answer quotes', async () => {
    const { element } = await render('mechanic', { permissions: QUOTES });

    expect(text(count(element))).toBe('3 din 3 secțiuni afișate');
  });

  it('shows the row with count and button to a suspended garage', async () => {
    const { element } = await render('garage', { status: 'suspended' });

    expect(text(count(element))).toBe('7 din 7 secțiuni afișate');
    expect(button(element)).not.toBeNull();
  });

  it('has no row for a draft garage', async () => {
    const { element } = await render('garage', { status: 'draft' });

    expect(count(element)).toBeNull();
    expect(button(element)).toBeNull();
  });
});

// @traces 011-FR-008
describe('every section hidden', () => {
  it('says so under the strip and counts zero', async () => {
    const { element } = await render('garage', {
      read: async () => answer(layoutOf(KEYS), 'garage'),
    });

    expect(keys(element)).toEqual([]);
    expect(text(count(element))).toBe('0 din 7 secțiuni afișate');
    expect(text(allHidden(element))).toBe(
      'Ai ascuns toate secțiunile. Pornește cel puțin una din „Personalizează panoul”.',
    );
  });

  it('keeps a mechanic’s own jobs when both her sections are hidden', async () => {
    const { element } = await render('mechanic', {
      read: async () => answer(layoutOf(['load', 'sched']), 'mechanic'),
    });

    expect(allHidden(element)).not.toBeNull();
    expect(element.querySelector('mf-own-jobs-section')).not.toBeNull();
  });

  it('drops the line once a section is shown again', async () => {
    const { element, open, settle } = await render('garage', {
      read: async () => answer(layoutOf(KEYS), 'garage'),
    });
    button(element)?.click();
    const data = (
      open.mock.calls[0] as unknown as [
        unknown,
        { data: { toggle: (k: string, s: boolean) => Promise<boolean> } },
      ]
    )[1].data;

    await data.toggle('reviews', true);
    await settle();

    expect(allHidden(element)).toBeNull();
    expect(keys(element)).toEqual(['reviews']);
  });
});

// @traces 011-FR-004
// @traces 011-FR-007
describe('opening the panel', () => {
  it('opens the shared panel as a drawer with no discard question', async () => {
    const { element, open } = await render('garage');

    button(element)?.click();

    expect(open).toHaveBeenCalledWith(
      DashboardSectionsPanel,
      expect.objectContaining({
        confirmDiscard: false,
        shape: 'drawer',
        title: 'garage.home.panel.title',
      }),
    );
  });

  it('hands the panel the person’s rows with names and positions', async () => {
    const { element, open } = await render('mechanic', {
      read: async () => answer(layoutOf(['sched']), 'mechanic'),
    });

    button(element)?.click();

    expect(openedRows(open)).toEqual([
      {
        description: 'Câte ore are fiecare mecanic azi',
        key: 'load',
        name: 'Încărcarea mecanicilor',
        position: 1,
        shown: true,
      },
      {
        description: 'Util doar dacă lucrezi pe elevatoare',
        key: 'sched',
        name: 'Programul pe elevatoare',
        position: 2,
        shown: false,
      },
    ]);
  });

  it('hides a section on Panou at once when the panel switches it', async () => {
    let finish: (value: DashboardLayoutDto) => void = () => undefined;
    const { element, open, settle } = await render('garage', {
      save: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    button(element)?.click();
    const data = (
      open.mock.calls[0] as unknown as [
        unknown,
        { data: { toggle: (k: string, s: boolean) => Promise<boolean> } },
      ]
    )[1].data;

    const result = data.toggle('sched', false);
    await settle();
    expect(keys(element)).not.toContain('sched');
    expect(text(count(element))).toBe('6 din 7 secțiuni afișate');

    finish(answer(layoutOf(['sched']), 'garage'));
    expect(await result).toBe(true);
  });

  it('puts a section back when its save fails', async () => {
    const { element, open, settle } = await render('garage', {
      save: () => Promise.reject(new HttpErrorResponse({ status: 500 })),
    });
    button(element)?.click();
    const data = (
      open.mock.calls[0] as unknown as [
        unknown,
        { data: { toggle: (k: string, s: boolean) => Promise<boolean> } },
      ]
    )[1].data;

    expect(await data.toggle('sched', false)).toBe(false);
    await settle();
    expect(keys(element)).toContain('sched');
    expect(text(count(element))).toBe('7 din 7 secțiuni afișate');
  });
});

// @traces 011-FR-009
describe('a layout changed elsewhere', () => {
  it('re-reads on the event and follows the answer', async () => {
    let panels = layoutOf();
    const { element, live, settle } = await render('garage', {
      read: async () => answer(panels, 'garage'),
    });

    panels = layoutOf(['reviews']);
    live.emit('dashboard_layout.updated', 'account-1');
    await settle();

    expect(keys(element)).not.toContain('reviews');
    expect(text(count(element))).toBe('6 din 7 secțiuni afișate');
  });

  it('shows the new states in an open panel', async () => {
    let panels = layoutOf();
    const { element, live, open, settle } = await render('garage', {
      read: async () => answer(panels, 'garage'),
    });
    button(element)?.click();

    panels = layoutOf(['kpi']);
    live.emit('dashboard_layout.updated', 'account-1');
    await settle();

    expect(openedRows(open).find((row) => row.key === 'kpi')?.shown).toBe(
      false,
    );
  });

  it('ignores an event during a pending save, and the save answer wins', async () => {
    let finish: (value: DashboardLayoutDto) => void = () => undefined;
    let panels = layoutOf();
    const { api, element, live, open, settle } = await render('garage', {
      read: async () => answer(panels, 'garage'),
      save: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    button(element)?.click();
    const data = (
      open.mock.calls[0] as unknown as [
        unknown,
        { data: { toggle: (k: string, s: boolean) => Promise<boolean> } },
      ]
    )[1].data;

    const result = data.toggle('brands', false);
    panels = layoutOf(['kpi']);
    live.emit('dashboard_layout.updated', 'account-1');
    await settle();
    expect(api.dashboardLayoutsControllerRead).toHaveBeenCalledTimes(1);

    finish(answer(layoutOf(['brands']), 'garage'));
    await result;
    await settle();
    expect(keys(element)).toContain('kpi');
    expect(keys(element)).not.toContain('brands');
    expect(openedRows(open).find((row) => row.key === 'brands')?.shown).toBe(
      false,
    );
  });
});
