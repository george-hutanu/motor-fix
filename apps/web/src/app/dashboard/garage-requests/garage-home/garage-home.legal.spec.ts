import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  GarageRequestsService,
  GaragesService,
  type LegalCheckDto,
  type MeDto,
} from '@motor-fix/data-access';

import { GarageHome } from './garage-home';
import { Live } from '../../live';
import { Session } from '../../session';
import { fakeLive, listOf, wait } from '../garage-requests.testing';
import { GarageRequestsFeed } from '../garage-requests-feed';

type Role = 'owner' | 'receptionist' | 'mechanic';
type Status = 'draft' | 'approved' | 'suspended';

const CAPABILITIES: Record<Role, string[]> = {
  mechanic: ['garage.own_jobs'],
  owner: ['garage.requests', 'garage.schedule', 'garage.team'],
  receptionist: ['garage.requests', 'garage.schedule'],
};

const ANSWER: LegalCheckDto = {
  companyName: 'ATELIER DINAMO SRL',
  isMobile: false,
  lastCheckedOn: '2026-10-01',
  latestRecheck: null,
  rarActivities: [],
  rows: (['company', 'caen', 'rar', 'documents'] as const).map((kind) => ({
    checkedOn: '2026-10-01',
    detail: null,
    kind,
    missing: [],
    state: 'ok' as const,
  })),
  status: 'approved',
};

type Checked = { lastCheckedOn: string | null; rechecked: boolean };

const account = (
  role: Role,
  status: Status,
  checked: Checked = { lastCheckedOn: null, rechecked: false },
) =>
  ({
    capabilities: CAPABILITIES[role],
    garageAccess: [
      {
        features: {},
        garageId: 'garage-1',
        name: 'Atelier Dinamo',
        permissions: {
          canAnswerQuotes: role !== 'mechanic',
          canMoveBookings: false,
          canRecordFinalPrice: false,
        },
        role,
        status,
        ...checked,
      },
    ],
    garageId: 'garage-1',
  }) as unknown as MeDto;

let read: jest.Mock;
let live: ReturnType<typeof fakeLive>;

async function settle(fixture: {
  detectChanges(): void;
  whenStable(): Promise<unknown>;
}) {
  for (let i = 0; i < 4; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
    await wait(0);
  }
}

async function render(
  role: Role,
  {
    answer = () => Promise.resolve(ANSWER),
    checked,
    status = 'approved',
  }: {
    answer?: () => Promise<LegalCheckDto>;
    checked?: Checked;
    status?: Status;
  } = {},
) {
  read = jest.fn(answer);
  live = fakeLive();
  const me = signal(account(role, status, checked));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      GarageRequestsFeed,
      { provide: Live, useValue: live },
      { provide: Session, useValue: { current: me, shown: me } },
      {
        provide: GarageRequestsService,
        useValue: {
          garageRequestsControllerList: () => Promise.resolve(listOf([])),
        },
      },
      { provide: GaragesService, useValue: { legalCheckControllerRead: read } },
    ],
  });
  const fixture = TestBed.createComponent(GarageHome);
  await settle(fixture);
  return fixture;
}

const text = (el: Element | null) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const pill = (element: HTMLElement) =>
  element.querySelector('[data-verified-pill]');
const panel = (element: HTMLElement) =>
  element.querySelector('mf-legal-check-panel');

afterEach(() => TestBed.resetTestingModule());

// @traces 210-FR-005
// @traces 210-FR-006
describe('the verified profile on the garage Panou', () => {
  it('shows the owner the pill and the legal check, read for its garage', async () => {
    const element: HTMLElement = (await render('owner')).nativeElement;

    expect(text(pill(element))).toBe('Profil verificat');
    expect(panel(element)).not.toBeNull();
    expect(element.querySelectorAll('[data-legal-row]')).toHaveLength(4);
    expect(read).toHaveBeenCalledWith({ garageId: 'garage-1' });
  });

  it('shows the receptionist the pill only, and reads nothing', async () => {
    const element: HTMLElement = (await render('receptionist')).nativeElement;

    expect(text(pill(element))).toBe('Profil verificat');
    expect(panel(element)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('shows a mechanic neither', async () => {
    const element: HTMLElement = (await render('mechanic')).nativeElement;

    expect(pill(element)).toBeNull();
    expect(panel(element)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('shows neither while the garage is a draft', async () => {
    const element: HTMLElement = (await render('owner', { status: 'draft' }))
      .nativeElement;

    expect(pill(element)).toBeNull();
    expect(panel(element)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('drops the panel, with no error, when the read answers 404', async () => {
    const element: HTMLElement = (
      await render('owner', {
        answer: () => Promise.reject(new HttpErrorResponse({ status: 404 })),
      })
    ).nativeElement;

    expect(text(pill(element))).toBe('Profil verificat');
    expect(panel(element)).toBeNull();
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });
});

// @traces 210-FR-010
describe('the legal check when its read fails', () => {
  it('offers to try again, and a retry shows the rows', async () => {
    let calls = 0;
    const fixture = await render('owner', {
      answer: () =>
        calls++ === 0
          ? Promise.reject(new HttpErrorResponse({ status: 500 }))
          : Promise.resolve(ANSWER),
    });
    const element: HTMLElement = fixture.nativeElement;

    const button = element.querySelector<HTMLButtonElement>(
      '[role="alert"] button',
    );
    expect(button).not.toBeNull();
    button?.click();
    await settle(fixture);

    expect(read).toHaveBeenCalledTimes(2);
    expect(element.querySelectorAll('[data-legal-row]')).toHaveLength(4);
  });
});

// @traces 210-FR-011
describe('the legal check, live', () => {
  it.each([
    'verification.decided',
    'verification.check_recorded',
    'verification.reopened',
  ] as const)('reads again on %s', async (kind) => {
    const fixture = await render('owner');
    expect(read).toHaveBeenCalledTimes(1);

    live.emit(kind, 'file-1');
    await wait(350);
    await settle(fixture);

    expect(read).toHaveBeenCalledTimes(2);
  });

  // @traces 1351-FR-013
  it('reads again when an admin records a re-check of the garage', async () => {
    const fixture = await render('owner');

    live.emit('recheck.recorded', 'garage-1');
    await wait(350);
    await settle(fixture);

    expect(read).toHaveBeenCalledTimes(2);
  });

  it('does not read again on an unrelated event', async () => {
    const fixture = await render('owner');

    live.emit('price_list.updated', 'garage-1');
    await wait(350);
    await settle(fixture);

    expect(read).toHaveBeenCalledTimes(1);
  });
});

const line = (element: HTMLElement) =>
  element.querySelector('[data-verified-line]');

// @traces 1354-FR-001 1354-FR-005
describe('the legal check of a suspended garage on the Panou', () => {
  it('shows the owner the panel and no pill', async () => {
    const element: HTMLElement = (
      await render('owner', {
        checked: { lastCheckedOn: '2026-10-01', rechecked: true },
        status: 'suspended',
      })
    ).nativeElement;

    expect(pill(element)).toBeNull();
    expect(line(element)).toBeNull();
    expect(panel(element)).not.toBeNull();
    expect(read).toHaveBeenCalledWith({ garageId: 'garage-1' });
  });

  it('shows the receptionist neither', async () => {
    const element: HTMLElement = (
      await render('receptionist', { status: 'suspended' })
    ).nativeElement;

    expect(pill(element)).toBeNull();
    expect(panel(element)).toBeNull();
  });
});

// @traces 1354-FR-005 1354-FR-008
describe('the RAR line under the verified pill', () => {
  it('tells the owner the authorisation was re-checked, with day and month', async () => {
    const element: HTMLElement = (
      await render('owner', {
        checked: { lastCheckedOn: '2026-10-01', rechecked: true },
      })
    ).nativeElement;

    expect(text(line(element))).toBe('Autorizația RAR, reverificată pe 1 oct.');
  });

  it('tells the receptionist it was checked when no re-check is recorded since', async () => {
    const element: HTMLElement = (
      await render('receptionist', {
        checked: { lastCheckedOn: '2026-06-14', rechecked: false },
      })
    ).nativeElement;

    expect(text(line(element))).toBe('Autorizația RAR, verificată pe 14 iun.');
  });

  it('shows no line when the garage has no stored check day', async () => {
    const element: HTMLElement = (await render('owner')).nativeElement;

    expect(text(pill(element))).toBe('Profil verificat');
    expect(line(element)).toBeNull();
  });
});

// @traces 1354-FR-007
describe('the legal check, live, on a suspension', () => {
  it('reads again when the garage is suspended', async () => {
    const fixture = await render('owner');

    live.emit('garage.suspended', 'garage-1');
    await wait(350);
    await settle(fixture);

    expect(read).toHaveBeenCalledTimes(2);
  });
});
