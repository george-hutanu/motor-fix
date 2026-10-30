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
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { GarageHome } from './garage-home';
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
const allHidden = (element: HTMLElement) =>
  element.querySelector('[data-all-hidden]');

type Data = {
  rows: () => { key: string; position: number; shown: boolean }[];
  toggle: (key: string, shown: boolean) => Promise<boolean>;
};
const dataOf = (open: jest.Mock) =>
  (open.mock.calls[0] as unknown as [unknown, { data: Data }])[1].data;

// @traces 011-FR-003
// @traces 011-FR-008
describe('the count and the empty line, hostile layouts', () => {
  it('ignores hidden keys a mechanic never sees', async () => {
    const { element } = await render('mechanic', {
      read: async () =>
        answer(
          layoutOf(['kpi', 'now', 'req', 'funnel', 'brands', 'reviews']),
          'mechanic',
        ),
    });

    expect(text(count(element))).toBe('2 din 2 secțiuni afișate');
    expect(allHidden(element)).toBeNull();
  });

  it('counts zero of two for a mechanic who hid everything', async () => {
    const { element } = await render('mechanic', {
      read: async () => answer(layoutOf(KEYS), 'mechanic'),
    });

    expect(text(count(element))).toBe('0 din 2 secțiuni afișate');
    expect(allHidden(element)).not.toBeNull();
    expect(keys(element)).toEqual([]);
  });

  it('shows the empty line to a suspended garage that hid everything', async () => {
    const { element } = await render('garage', {
      read: async () => answer(layoutOf(KEYS), 'garage'),
      status: 'suspended',
    });

    expect(text(count(element))).toBe('0 din 7 secțiuni afișate');
    expect(allHidden(element)).not.toBeNull();
  });

  it('shows no empty line, no count and no button for a draft garage whose layout hides everything', async () => {
    const { element } = await render('garage', {
      read: async () => answer(layoutOf(KEYS), 'garage'),
      status: 'draft',
    });

    expect(allHidden(element)).toBeNull();
    expect(count(element)).toBeNull();
    expect(button(element)).toBeNull();
  });

  it('draws everything when the server answers no panels at all', async () => {
    const { element } = await render('garage', {
      read: async () => answer([], 'garage'),
    });

    expect(text(count(element))).toBe('7 din 7 secțiuni afișate');
    expect(allHidden(element)).toBeNull();
  });

  it('keeps hiding a section whose key appears twice with the first entry hidden', async () => {
    const { element } = await render('garage', {
      read: async () =>
        answer(
          [...layoutOf(['sched']), { key: 'sched', visible: true }],
          'garage',
        ),
    });

    expect(text(count(element))).toMatch(/^[67] din 7 secțiuni afișate$/);
    expect(count(element)).not.toBeNull();
  });

  it('is not emptied by hidden keys outside the eight', async () => {
    const { element } = await render('garage', {
      read: async () =>
        answer([...layoutOf(), { key: 'ghost', visible: false }], 'garage'),
    });

    expect(text(count(element))).toBe('7 din 7 secțiuni afișate');
    expect(allHidden(element)).toBeNull();
  });

  it('keeps the same live region element across a switch so the change is announced', async () => {
    const { element, open, settle } = await render('garage');
    const before = count(element);
    button(element)?.click();

    await dataOf(open).toggle('sched', false);
    await settle();

    expect(count(element)).toBe(before);
    expect(text(count(element))).toBe('6 din 7 secțiuni afișate');
    expect(count(element)?.getAttribute('aria-live')).toBe('polite');
  });

  it('reads the count and the empty line in English', async () => {
    const { element, settle } = await render('garage', {
      read: async () => answer(layoutOf(KEYS), 'garage'),
    });
    await TestBed.inject(I18n).use('en');
    await settle();

    expect(text(count(element))).toBe('0 of 7 sections shown');
    expect(text(allHidden(element))).toBe(
      'You have hidden every section. Switch at least one on from “Customise dashboard”.',
    );
    expect(text(button(element))).toBe('Customise dashboard');
  });
});

// @traces 011-FR-004
// @traces 011-FR-006
describe('opening the panel, hostile cases', () => {
  it('lists six rows numbered 1 to 6 when the lift schedule is off', async () => {
    const { element, open } = await render('garage', {
      features: { lift_schedule: false },
    });

    button(element)?.click();

    const rows = dataOf(open).rows();
    expect(rows.map((r) => r.key)).toEqual([
      'kpi',
      'req',
      'load',
      'funnel',
      'brands',
      'reviews',
    ]);
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('lists a mechanic with quotes three rows with the request row first', async () => {
    const { element, open } = await render('mechanic', {
      permissions: QUOTES,
    });

    button(element)?.click();

    expect(
      dataOf(open)
        .rows()
        .map((r) => r.key),
    ).toEqual(['req', 'load', 'sched']);
  });

  it('opens from the default after a failed read and lists every row switched on', async () => {
    const { element, open } = await render('garage', {
      read: () => Promise.reject(new HttpErrorResponse({ status: 500 })),
    });

    button(element)?.click();

    const rows = dataOf(open).rows();
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.shown)).toBe(true);
  });

  it('saves only the switched key after a failed read', async () => {
    const { api, element, open } = await render('garage', {
      read: () => Promise.reject(new HttpErrorResponse({ status: 500 })),
    });
    button(element)?.click();

    await dataOf(open).toggle('funnel', false);

    expect(api.dashboardLayoutsControllerSave).toHaveBeenCalledWith({
      body: { panels: [{ key: 'funnel', visible: false }] },
      role: 'garage',
    });
  });

  it('opens the panel on every press of the button', async () => {
    const { element, open } = await render('garage');

    button(element)?.click();
    button(element)?.click();

    expect(open).toHaveBeenCalledTimes(2);
  });

  it('leaves the count alone when the panel switches a key the mechanic never sees', async () => {
    const { element, open, settle } = await render('mechanic');
    button(element)?.click();

    await dataOf(open).toggle('kpi', false);
    await settle();

    expect(text(count(element))).toBe('2 din 2 secțiuni afișate');
    expect(allHidden(element)).toBeNull();
  });

  it('flips every row off and then on again through the panel, ending on the full count', async () => {
    const { element, open, settle } = await render('garage');
    button(element)?.click();
    const data = dataOf(open);

    for (const row of data.rows()) await data.toggle(row.key, false);
    await settle();
    expect(allHidden(element)).not.toBeNull();
    expect(text(count(element))).toBe('0 din 7 secțiuni afișate');

    for (const row of data.rows()) await data.toggle(row.key, true);
    await settle();
    expect(allHidden(element)).toBeNull();
    expect(text(count(element))).toBe('7 din 7 secțiuni afișate');
  });
});
