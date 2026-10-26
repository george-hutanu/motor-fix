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
  GarageJobsService,
  GarageRequestsService,
  GaragesService,
  type MeDto,
  ReviewsService,
} from '@motor-fix/data-access';
import { Overlays } from '@motor-fix/overlays';

import { GarageHome } from './garage-home';
import { staffPage } from '../../garage-reviews/garage-reviews.testing';
import { Live } from '../../live';
import { Session } from '../../session';
import { fakeLive, listOf, requestRow, wait } from '../garage-requests.testing';
import { GarageRequestsFeed } from '../garage-requests-feed';

const NONE: Permissions = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};

type Status = 'draft' | 'approved' | 'suspended';
type Lists = Partial<Record<'waiting' | 'quoted' | 'closed', () => unknown>>;

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
  }) as unknown as MeDto;

async function render(
  role: Role,
  {
    features = {},
    lists = {},
    permissions = NONE,
    reviews = () => Promise.resolve(staffPage({ items: [], total: 0 })),
    status = 'approved',
  }: {
    features?: Record<string, boolean>;
    lists?: Lists;
    permissions?: Permissions;
    reviews?: () => Promise<unknown>;
    status?: Status;
  } = {},
) {
  const me = signal(account(role, status, features, permissions));
  const list = jest.fn(({ status: which }: { status: keyof Lists }) =>
    (lists[which] ?? (() => Promise.resolve(listOf([]))))(),
  );
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      GarageRequestsFeed,
      { provide: Live, useValue: fakeLive() },
      { provide: Session, useValue: { current: me, shown: me } },
      {
        provide: GarageRequestsService,
        useValue: { garageRequestsControllerList: list },
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
      { provide: Overlays, useValue: { open: jest.fn() } },
      {
        provide: ReviewsService,
        useValue: { garageReviewsControllerRead: reviews },
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
  return { element: fixture.nativeElement as HTMLElement, list, me, settle };
}

const text = (el: Element | null) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const keys = (element: HTMLElement) =>
  [...element.querySelectorAll('[data-section]')].map((el) =>
    el.getAttribute('data-section'),
  );
const section = (element: HTMLElement, key: string) =>
  element.querySelector(`[data-section="${key}"]`);
const card = (element: HTMLElement) =>
  element.querySelector('mf-first-steps-card');
const follows = (first: Element | null, then: Element | null) =>
  !!first &&
  !!then &&
  !!(first.compareDocumentPosition(then) & Node.DOCUMENT_POSITION_FOLLOWING);

// @traces 099-FR-001
// @traces 099-FR-004
// @traces 099-FR-005
describe('the sections of Panou, in their default order', () => {
  it('shows the owner every released section in order', async () => {
    const { element } = await render('garage');

    expect(keys(element)).toEqual([
      'kpi',
      'req',
      'load',
      'sched',
      'funnel',
      'brands',
      'reviews',
    ]);
  });

  it.each([
    ['kpi', 'Cifrele zilei', /^Aici apar cifrele zilei/],
    ['load', 'Încărcarea mecanicilor azi', /^Aici apare încărcarea/],
    ['sched', 'Programul de azi, pe elevatoare', /^Aici apare programul/],
    ['funnel', 'De la profil la cerere, pe săptămâni', /^Aici apare drumul/],
    ['brands', 'Mărci cerute luna asta', /^Aici apar mărcile/],
  ])(
    'gives %s its title and one sentence, and no data',
    async (key, title, sentence) => {
      const { element } = await render('garage');
      const shown = section(element, key) as Element;

      expect(text(shown.querySelector('h2'))).toBe(title);
      const paragraphs = shown.querySelectorAll('p');
      expect(paragraphs).toHaveLength(1);
      expect(text(paragraphs[0])).toMatch(sentence);
      expect(
        shown.querySelectorAll('li, table, svg, img, canvas'),
      ).toHaveLength(0);
      expect(text(shown)).not.toMatch(/\d/);
    },
  );

  it('no longer shows the coming-soon line', async () => {
    const { element } = await render('garage', {
      lists: {
        waiting: () => Promise.reject(new HttpErrorResponse({ status: 404 })),
      },
    });

    expect(text(element)).not.toContain('Aici vei vedea ce se întâmplă azi');
  });

  it('keeps the strip and the legal check above the sections', async () => {
    const { element } = await render('garage');
    const first = element.querySelector('[data-section]');

    expect(follows(element.querySelector('[data-verified-pill]'), first)).toBe(
      true,
    );
    expect(follows(element.querySelector('mf-garage-legal-check'), first)).toBe(
      true,
    );
  });

  it('shows a draft garage its verification progress and no section', async () => {
    const { element } = await render('garage', { status: 'draft' });

    expect(keys(element)).toEqual([]);
    expect(element.querySelector('mf-verification-progress')).not.toBeNull();
  });
});

// @traces 099-FR-014
// @traces 099-FR-015
describe('the built sections keep their content in the frame', () => {
  it('puts the requests in the req place, its four newest rows and "Vezi toate"', async () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      requestRow({ id: `req-${i}` }),
    );
    const { element } = await render('garage', {
      lists: { waiting: () => Promise.resolve(listOf(rows)) },
    });
    const requests = section(element, 'req') as Element;

    expect(requests.tagName.toLowerCase()).toBe('mf-garage-requests-panel');
    expect(requests.querySelectorAll('li[data-live-id]')).toHaveLength(4);
    expect(text(requests)).toContain('Vezi toate');
    expect(requests.querySelector('h2 > a')?.getAttribute('href')).toBe(
      '/app/garage/requests',
    );
  });

  it('puts the reviews last, linking to Recenzii', async () => {
    const { element } = await render('garage');
    const reviews = section(element, 'reviews') as Element;

    expect(reviews.tagName.toLowerCase()).toBe('mf-garage-reviews-panel');
    expect(reviews.querySelector('h2 > a')?.getAttribute('href')).toBe(
      '/app/garage/reviews',
    );
  });
});

// @traces 099-FR-007
describe('a section that fails', () => {
  it('keeps its error inside itself and the other sections shown', async () => {
    const { element } = await render('garage', {
      reviews: () => Promise.reject(new HttpErrorResponse({ status: 500 })),
    });

    expect(
      section(element, 'reviews')?.querySelector('[role="alert"]'),
    ).not.toBeNull();
    expect(keys(element)).toEqual([
      'kpi',
      'req',
      'load',
      'sched',
      'funnel',
      'brands',
      'reviews',
    ]);
    expect(element.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });
});

// @traces 099-FR-002
// @traces 099-FR-006
// @traces 099-FR-009
describe('the sections each person sees on Panou', () => {
  it('shows a mechanic her own jobs, then the load and the lifts', async () => {
    const { element } = await render('mechanic');

    expect(keys(element)).toEqual(['load', 'sched']);
    expect(
      follows(
        element.querySelector('mf-own-jobs-section'),
        section(element, 'load'),
      ),
    ).toBe(true);
    expect(element.querySelector('mf-garage-reviews-panel')).toBeNull();
  });

  it('puts the requests before the own jobs of a mechanic who may answer quotes', async () => {
    const { element } = await render('mechanic', {
      permissions: { ...NONE, canAnswerQuotes: true },
    });
    const own = element.querySelector('mf-own-jobs-section');

    expect(keys(element)).toEqual(['req', 'load', 'sched']);
    expect(follows(section(element, 'req'), own)).toBe(true);
    expect(follows(own, section(element, 'load'))).toBe(true);
  });

  it('leaves the lift section out while lift_schedule is off', async () => {
    const { element } = await render('garage', {
      features: { lift_schedule: false },
    });

    expect(keys(element)).not.toContain('sched');
  });

  it('takes a section away when the account says its feature went off', async () => {
    const { element, me, settle } = await render('garage');
    expect(keys(element)).toContain('load');

    me.set(account('garage', 'approved', { team_mechanics: false }, NONE));
    await settle();

    expect(keys(element)).not.toContain('load');
  });

  it('shows a suspended garage its sections without the strip', async () => {
    const { element } = await render('garage', { status: 'suspended' });

    expect(element.querySelector('[data-verified-pill]')).toBeNull();
    expect(keys(element)).toContain('kpi');
  });
});

// @traces 099-FR-008
describe('the first-steps card', () => {
  it('shows the owner of a garage with no request and no review the card above the sections', async () => {
    const { element } = await render('garage');
    const shown = card(element);

    expect(shown).not.toBeNull();
    expect(follows(element.querySelector('mf-garage-legal-check'), shown)).toBe(
      true,
    );
    expect(follows(shown, section(element, 'kpi'))).toBe(true);
  });

  it.each<[string, Lists]>([
    [
      'a waiting request',
      { waiting: () => Promise.resolve(listOf([requestRow()])) },
    ],
    [
      'a quoted request',
      { quoted: () => Promise.resolve(listOf([requestRow()])) },
    ],
    [
      'a closed request',
      { closed: () => Promise.resolve(listOf([requestRow()])) },
    ],
  ])('leaves once the garage has %s', async (_, lists) => {
    const { element } = await render('garage', { lists });

    expect(card(element)).toBeNull();
  });

  it('leaves once the garage has a review', async () => {
    const { element } = await render('garage', {
      reviews: () => Promise.resolve(staffPage()),
    });

    expect(card(element)).toBeNull();
  });

  it.each<[string, Parameters<typeof render>[1]]>([
    ['while the reviews load', { reviews: () => new Promise(() => undefined) }],
    [
      'when the reviews fail',
      { reviews: () => Promise.reject(new HttpErrorResponse({ status: 500 })) },
    ],
    [
      'while the requests load',
      { lists: { waiting: () => new Promise(() => undefined) } },
    ],
    [
      'when the requests fail',
      {
        lists: {
          waiting: () => Promise.reject(new HttpErrorResponse({ status: 500 })),
        },
      },
    ],
    ['to a suspended garage', { status: 'suspended' }],
  ])('is absent %s', async (_, options) => {
    const { element } = await render('garage', options);

    expect(card(element)).toBeNull();
  });

  it.each<[string, Role]>([
    ['the receptionist', 'receptionist'],
    ['a mechanic', 'mechanic'],
  ])('is absent for %s', async (_, role) => {
    const { element } = await render(role, {
      permissions: { ...NONE, canAnswerQuotes: true },
    });

    expect(card(element)).toBeNull();
  });
});

// @traces 099-FR-012
describe('what the sections read', () => {
  it('decides every section and the card from the lists Panou already reads', async () => {
    const reviews = jest.fn(() =>
      Promise.resolve(staffPage({ items: [], total: 0 })),
    );
    const { element, list } = await render('garage', { reviews });

    expect(card(element)).not.toBeNull();
    expect(list.mock.calls.map(([query]) => query.status).sort()).toEqual([
      'closed',
      'quoted',
      'waiting',
    ]);
    expect(reviews).toHaveBeenCalledTimes(1);
  });
});
