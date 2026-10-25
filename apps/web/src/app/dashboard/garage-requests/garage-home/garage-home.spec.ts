import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { capabilitiesOf, type Role } from '@motor-fix/contracts/capabilities';
import {
  GarageRequestsService,
  GaragesService,
  type MeDto,
} from '@motor-fix/data-access';

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
) =>
  ({
    capabilities,
    garageAccess: [
      {
        features: {},
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
    role,
    status = 'approved',
  }: {
    answer?: () => Promise<unknown>;
    role?: string;
    status?: 'draft' | 'approved' | 'suspended';
  } = {},
) {
  list = jest.fn(({ status: filter }: { status: string }) =>
    filter === 'waiting' ? answer() : Promise.resolve(listOf([])),
  );
  const me = signal(account(capabilities, status, role));
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
  it('shows a mechanic without the permission no panel, makes no call, and says her jobs will appear', async () => {
    const element = await render(MECHANIC);

    expect(panel(element)).toBeNull();
    expect(list).not.toHaveBeenCalled();
    expect(text(element)).toBe('Lucrările tale vor apărea aici.');
    expect(text(element.querySelector('[role="status"]'))).toBe(
      'Lucrările tale vor apărea aici.',
    );
  });

  it('shows nothing of the requests, and no error, when the server answers 404', async () => {
    const element = await render(OWNER, {
      answer: () => Promise.reject(new HttpErrorResponse({ status: 404 })),
    });

    expect(panel(element)).toBeNull();
    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(text(element)).toBe(
      'Profil verificat Aici vei vedea ce se întâmplă azi în service.',
    );
  });
});

// @traces 102-FR-005
// @traces 102-FR-006
describe('the garage Panou sections, each behind a capability of the table', () => {
  const sections = (element: HTMLElement) => ({
    legal: element.querySelector('mf-garage-legal-check') !== null,
    requests: panel(element) !== null,
    status: element.querySelector('[role="status"]') !== null,
    strip: element.querySelector('[data-verified-pill]') !== null,
  });

  it.each([
    ['the owner', OWNER, { legal: true, requests: true, strip: true }],
    [
      'the receptionist',
      RECEPTIONIST,
      { legal: false, requests: true, strip: true },
    ],
    [
      'a mechanic who may answer quotes',
      ANSWERING_MECHANIC,
      { legal: false, requests: true, strip: false },
    ],
    ['a mechanic', MECHANIC, { legal: false, requests: false, strip: false }],
  ])('gives %s the sections of the row', async (_, capabilities, shown) => {
    const element = await render(capabilities);

    expect(sections(element)).toEqual({
      ...shown,
      status: !shown.requests && !shown.strip,
    });
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

  it('says the mechanic line in English too', () => {
    const en = JSON.parse(
      readFileSync(
        join(__dirname, '../../../../../../../libs/i18n/src/garage/en.json'),
        'utf8',
      ),
    );

    expect(en.home.mechanic).toBe('Your jobs will appear here.');
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
