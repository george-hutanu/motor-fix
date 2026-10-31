import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { DeferBlockBehavior, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { capabilitiesOf, type Role } from '@motor-fix/contracts/capabilities';
import {
  GarageJobsService,
  GarageRequestsService,
  GaragesService,
  type MeDto,
  ReviewsService,
} from '@motor-fix/data-access';
import { Overlays } from '@motor-fix/overlays';

import { GarageHome } from './garage-home';
import { Live } from '../../live';
import { Session } from '../../session';
import { fakeLive, listOf, requestRow, wait } from '../garage-requests.testing';
import { GarageRequestsFeed } from '../garage-requests-feed';

const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};
// Each role's row, read from the table the server answers with.
const rowOf = (role: Role, permissions = NONE) =>
  capabilitiesOf(role, permissions) as string[];
const OWNER = rowOf('garage');
const RECEPTIONIST = rowOf('receptionist');
const ANSWERING_MECHANIC = rowOf('mechanic', {
  ...NONE,
  canAnswerQuotes: true,
});
const MECHANIC = rowOf('mechanic');

let list: jest.Mock;
let jobs: jest.Mock;
let reviews: jest.Mock;

// The membership's role string follows the row unless a test sets it, so a
// test can prove a section follows the capabilities and not the role.
const account = (
  capabilities: string[],
  status: 'draft' | 'approved' | 'suspended',
  role = capabilities.includes('garage.team')
    ? 'owner'
    : capabilities.includes('garage.profile')
      ? 'receptionist'
      : 'mechanic',
  features: Record<string, boolean> = {},
) =>
  ({
    capabilities,
    garageAccess: [
      {
        features,
        garageId: 'garage-1',
        name: 'Atelier Test',
        permissions: {
          canAnswerQuotes: capabilities.includes('garage.requests'),
          canMoveBookings: false,
          canRecordFinalPrice: false,
        },
        role,
        status,
      },
    ],
    garageId: 'garage-1',
  }) as unknown as MeDto;

async function render(
  capabilities: string[],
  {
    answer = () => Promise.resolve(listOf([requestRow()])),
    features,
    role,
    status = 'approved',
  }: {
    answer?: () => Promise<unknown>;
    features?: Record<string, boolean>;
    role?: string;
    status?: 'draft' | 'approved' | 'suspended';
  } = {},
) {
  list = jest.fn(({ status: filter }: { status: string }) =>
    filter === 'waiting' ? answer() : Promise.resolve(listOf([])),
  );
  jobs = jest.fn(async () => ({ items: [], nextCursor: null, total: 0 }));
  // The reviews panel has its own spec; here it waits.
  reviews = jest.fn(() => new Promise(() => undefined));
  const me = signal(account(capabilities, status, role, features));
  TestBed.configureTestingModule({
    deferBlockBehavior: DeferBlockBehavior.Manual,
    providers: [
      provideRouter([]),
      GarageRequestsFeed,
      { provide: Live, useValue: fakeLive() },
      { provide: Session, useValue: { current: me, shown: me } },
      {
        provide: GarageRequestsService,
        useValue: { garageRequestsControllerList: list },
      },
      // The own jobs have their own spec; here the mechanic has none today.
      {
        provide: GarageJobsService,
        useValue: { garageJobsControllerList: jobs },
      },
      { provide: Overlays, useValue: { open: jest.fn() } },
      {
        provide: ReviewsService,
        useValue: { garageReviewsControllerRead: reviews },
      },
      // The legal check has its own spec; here the garage has no file.
      {
        provide: GaragesService,
        useValue: {
          legalCheckControllerRead: () =>
            Promise.reject(new HttpErrorResponse({ status: 404 })),
          // The verification page has its own spec; here it waits.
          verificationStatusControllerRead: () => new Promise(() => undefined),
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(GarageHome);
  for (let i = 0; i < 4; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
    await wait(0);
  }
  return fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const panel = (element: HTMLElement) =>
  element.querySelector('mf-garage-requests-panel');
const ownJobs = (element: HTMLElement) =>
  element.querySelector('mf-own-jobs-section');
const daySheet = (element: HTMLElement) =>
  [...element.querySelectorAll<HTMLAnchorElement>('a')].find(
    (a) => text(a) === 'Foaia mea de zi',
  );

afterEach(() => TestBed.resetTestingModule());

// @traces 343-FR-006
describe('the garage Panou', () => {
  it('replaces the empty state with the requests panel', async () => {
    const element = await render(OWNER);

    expect(panel(element)).not.toBeNull();
    expect(text(element)).toContain('Cereri de ofertă');
    expect(text(element)).not.toContain(
      'Aici vei vedea ce se întâmplă azi în service.',
    );
  });

  it('shows the four newest rows and "Vezi toate" only from five', async () => {
    const five = Array.from({ length: 5 }, (_, i) =>
      requestRow({ id: `req-${i + 1}` }),
    );
    let element = await render(OWNER, {
      answer: async () => listOf(five),
    });
    expect(element.querySelectorAll('li[data-live-id]')).toHaveLength(4);
    expect(text(element)).toContain('Vezi toate');
    TestBed.resetTestingModule();

    element = await render(OWNER, {
      answer: async () => listOf(five.slice(0, 4)),
    });
    expect(element.querySelectorAll('li[data-live-id]')).toHaveLength(4);
    expect(text(element)).not.toContain('Vezi toate');
  });

  // @traces 101-FR-001
  it('shows the verification page, and no panel, pill or legal check, while the garage is a draft', async () => {
    const element = await render(OWNER, { status: 'draft' });

    expect(element.querySelector('mf-verification-progress')).not.toBeNull();
    expect(element.querySelector('h1')).toBeNull();
    expect(panel(element)).toBeNull();
    expect(element.querySelector('[data-verified-pill]')).toBeNull();
    expect(element.querySelector('mf-garage-legal-check')).toBeNull();
  });

  // @traces 101-FR-001
  it.each(['approved', 'suspended'] as const)(
    'shows Panou, not the verification page, for an %s garage',
    async (status) => {
      const element = await render(OWNER, { status });

      expect(element.querySelector('mf-verification-progress')).toBeNull();
      expect(panel(element)).not.toBeNull();
      expect(element.querySelector('mf-garage-legal-check')).not.toBeNull();
      expect(element.querySelector('[data-verified-pill]') !== null).toBe(
        status === 'approved',
      );
    },
  );

  it('shows the panel for a suspended garage', async () => {
    const element = await render(OWNER, { status: 'suspended' });

    expect(panel(element)).not.toBeNull();
  });
});

// @traces 343-FR-015
describe('the garage Panou for each role', () => {
  it.each([
    ['the owner', OWNER],
    ['the receptionist', RECEPTIONIST],
    ['a mechanic who may answer quotes', ANSWERING_MECHANIC],
  ])('shows the panel to %s', async (_, capabilities) => {
    const element = await render(capabilities);

    expect(panel(element)).not.toBeNull();
    expect(list).toHaveBeenCalledWith({ status: 'waiting' });
  });

  // @traces 102-FR-005
  // @traces 423-FR-001
  it('shows a mechanic without the permission no panel and no request call, but her own jobs', async () => {
    const element = await render(MECHANIC);

    expect(panel(element)).toBeNull();
    expect(list).not.toHaveBeenCalled();
    expect(ownJobs(element)).not.toBeNull();
    expect(jobs).toHaveBeenCalledTimes(1);
    expect(text(element)).not.toContain('Lucrările tale vor apărea aici.');
    expect(text(element)).toContain('Nicio lucrare azi');
  });

  it('shows nothing of the requests, and no error, when the server answers 404', async () => {
    const element = await render(OWNER, {
      answer: () => Promise.reject(new HttpErrorResponse({ status: 404 })),
    });

    expect(panel(element)).toBeNull();
    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(element.querySelector('[data-section="req"]')).toBeNull();
    expect(text(element)).not.toContain('Cereri de ofertă');
  });

  // @traces 099-FR-005
  it('shows the empty sections, not the coming-soon line, for a role with neither requests nor reviews', async () => {
    const element = await render(
      OWNER.filter((c) => c !== 'garage.reviews'),
      {
        answer: () => Promise.reject(new HttpErrorResponse({ status: 404 })),
      },
    );

    expect(text(element)).not.toContain('Aici vei vedea ce se întâmplă azi');
    expect(
      [...element.querySelectorAll('[data-section]')].map((el) =>
        el.getAttribute('data-section'),
      ),
    ).toEqual(['kpi', 'load', 'sched', 'funnel', 'brands']);
  });
});

// @traces 102-FR-005
// @traces 102-FR-006
describe('the garage Panou sections, each behind a capability of the table', () => {
  const sections = (element: HTMLElement) => ({
    legal: element.querySelector('mf-garage-legal-check') !== null,
    ownJobs: ownJobs(element) !== null,
    requests: panel(element) !== null,
    strip: element.querySelector('[data-verified-pill]') !== null,
  });

  // @traces 423-FR-001
  it.each([
    [
      'the owner',
      OWNER,
      { legal: true, ownJobs: false, requests: true, strip: true },
    ],
    [
      'the receptionist',
      RECEPTIONIST,
      { legal: false, ownJobs: false, requests: true, strip: true },
    ],
    [
      'a mechanic who may answer quotes',
      ANSWERING_MECHANIC,
      { legal: false, ownJobs: true, requests: true, strip: false },
    ],
    [
      'a mechanic',
      MECHANIC,
      { legal: false, ownJobs: true, requests: false, strip: false },
    ],
  ])('gives %s the sections of the row', async (_, capabilities, shown) => {
    const element = await render(capabilities);

    expect(sections(element)).toEqual(shown);
  });

  // @traces 423-FR-001
  it('puts the requests panel above the own jobs of a mechanic who may answer quotes', async () => {
    const element = await render(ANSWERING_MECHANIC);
    const requests = panel(element) as Element;
    const own = ownJobs(element) as Element;

    expect(
      requests.compareDocumentPosition(own) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // @traces 423-FR-001
  it('shows a mechanic no figures, demand or reviews on Panou', async () => {
    const element = await render(ANSWERING_MECHANIC);

    expect(text(element)).not.toMatch(/Recenzi|Cerere în zonă/);
  });

  // @traces 423-FR-001
  it('reads the capabilities, not the role string: a row without the own jobs has no section', async () => {
    const element = await render(
      MECHANIC.filter((c) => c !== 'garage.own_jobs'),
      { role: 'mechanic' },
    );

    expect(ownJobs(element)).toBeNull();
    expect(jobs).not.toHaveBeenCalled();
  });

  it('reads the capabilities, not the role string: an owner row without the switches has no legal check', async () => {
    const element = await render(
      OWNER.filter((c) => c !== 'garage.feature_switches'),
      { role: 'owner' },
    );

    expect(sections(element).legal).toBe(false);
    expect(sections(element).strip).toBe(true);
  });

  it('reads the capabilities, not the role string: an owner row without the profile has no strip', async () => {
    const element = await render(
      OWNER.filter((c) => c !== 'garage.profile'),
      { role: 'owner' },
    );

    expect(sections(element).strip).toBe(false);
    expect(sections(element).legal).toBe(true);
  });

  it('shows the receptionist no action button on Panou', async () => {
    const element = await render(RECEPTIONIST);
    const buttons = [...element.querySelectorAll('button')].map(text);

    expect(buttons).not.toContain('Răspunde');
    expect(buttons).not.toContain('Modifică profilul');
  });

  // @traces 423-FR-011
  it('says the own-jobs texts in English too, and no longer the placeholder line', () => {
    const en = JSON.parse(
      readFileSync(
        join(__dirname, '../../../../../../../libs/i18n/src/garage/en.json'),
        'utf8',
      ),
    );

    expect(en.home.mechanic).toBeUndefined();
    expect(en.home.ownJobs.daySheet).toBe('My day sheet');
    expect(en.home.ownJobs.none).toBe('No jobs today');
  });
});

// @traces 423-FR-003
describe("the mechanic's day-sheet link on Panou", () => {
  it('links a mechanic to Programări above her own jobs', async () => {
    const element = await render(MECHANIC);
    const link = daySheet(element);

    expect(link).toBeDefined();
    expect(link?.getAttribute('href')).toMatch(/\/schedule$/);
    expect(
      (link as Element).compareDocumentPosition(
        element.querySelector('[data-job], [data-skeleton], [role="status"]') ??
          element,
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows no link while the day sheets are switched off', async () => {
    const element = await render(MECHANIC, {
      features: { day_sheets: false },
    });

    expect(ownJobs(element)).not.toBeNull();
    expect(daySheet(element)).toBeUndefined();
  });

  it('shows no link to a row without garage.schedule', async () => {
    const element = await render(
      MECHANIC.filter((c) => c !== 'garage.schedule'),
      { role: 'mechanic' },
    );

    expect(daySheet(element)).toBeUndefined();
  });

  it('shows the owner and the receptionist no day-sheet link on Panou', async () => {
    for (const capabilities of [OWNER, RECEPTIONIST]) {
      const element = await render(capabilities);
      expect(daySheet(element)).toBeUndefined();
      TestBed.resetTestingModule();
    }
  });
});

// @traces 074-FR-001 074-FR-007
describe('Recenzii noi on Panou', () => {
  const reviewsPanel = (element: HTMLElement) =>
    element.querySelector('mf-garage-reviews-panel');

  it.each([
    ['the owner', OWNER],
    ['the receptionist', RECEPTIONIST],
  ])(
    'shows %s the newest reviews under the requests',
    async (_, capabilities) => {
      const element = await render(capabilities);

      expect(reviewsPanel(element)).not.toBeNull();
      expect(reviews).toHaveBeenCalledWith({ garageId: 'garage-1', page: 1 });
      expect(
        panel(element)?.compareDocumentPosition(
          reviewsPanel(element) as Element,
        ),
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    },
  );

  it.each([
    ['a mechanic', MECHANIC],
    ['a mechanic who may answer quotes', ANSWERING_MECHANIC],
  ])('shows %s no reviews and reads none', async (_, capabilities) => {
    const element = await render(capabilities);

    expect(reviewsPanel(element)).toBeNull();
    expect(reviews).not.toHaveBeenCalled();
  });

  it('shows a draft garage no reviews', async () => {
    const element = await render(OWNER, { status: 'draft' });

    expect(reviewsPanel(element)).toBeNull();
    expect(reviews).not.toHaveBeenCalled();
  });

  it('shows a suspended garage its reviews', async () => {
    const element = await render(OWNER, { status: 'suspended' });

    expect(reviewsPanel(element)).not.toBeNull();
  });
});

describe('the Panou strip', () => {
  it('spaces its lines on the 4 px grid', () => {
    const css = readFileSync(join(__dirname, 'garage-home.css'), 'utf8');

    expect(css).toMatch(
      /\.strip \{[^}]*gap: var\(--mf-space-2\) var\(--mf-space-4\);/,
    );
  });
});
