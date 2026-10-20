import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  GarageRequestsService,
  GaragesService,
  type MeDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { GarageHome } from './garage-home';
import { Live } from '../../live';
import { Session } from '../../session';
import { fakeLive, listOf, wait } from '../garage-requests.testing';
import { GarageRequestsFeed } from '../garage-requests-feed';

type Role = 'owner' | 'receptionist' | 'mechanic';

const account = (
  role: Role,
  status: string,
  lastCheckedOn: string | null,
  rechecked: boolean,
) =>
  ({
    capabilities: [],
    garageAccess: [
      {
        features: {},
        garageId: 'garage-1',
        lastCheckedOn,
        name: 'Atelier Dinamo',
        permissions: {},
        rechecked,
        role,
        status,
      },
    ],
    garageId: 'garage-1',
  }) as unknown as MeDto;

async function render(
  role: Role,
  status: string,
  lastCheckedOn: string | null,
  rechecked: boolean,
  language: 'ro' | 'en' = 'ro',
) {
  const me = signal(account(role, status, lastCheckedOn, rechecked));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      GarageRequestsFeed,
      { provide: Live, useValue: fakeLive() },
      { provide: Session, useValue: { current: me, shown: me } },
      {
        provide: GarageRequestsService,
        useValue: {
          garageRequestsControllerList: () => Promise.resolve(listOf([])),
        },
      },
      {
        provide: GaragesService,
        useValue: {
          legalCheckControllerRead: () => new Promise(() => undefined),
        },
      },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('garage');
  if (language === 'en') await i18n.use('en');
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
const line = (el: HTMLElement) => el.querySelector('[data-verified-line]');

afterEach(() => TestBed.resetTestingModule());

describe('the verified strip date line adversary', () => {
  // @traces 1354-FR-005
  it('says re-checked with day and month for the owner in Romanian', async () => {
    const el = await render('owner', 'approved', '2026-10-01', true);

    expect(text(line(el))).toBe('Autorizația RAR, reverificată pe 1 oct.');
  });

  // @traces 1354-FR-005
  it('says checked in English when only the approval checked', async () => {
    const el = await render('owner', 'approved', '2026-10-01', false, 'en');

    expect(text(line(el))).toBe('RAR authorisation, checked on 1 Oct');
  });

  // @traces 1354-FR-005
  it('says re-checked in English', async () => {
    const el = await render('owner', 'approved', '2026-10-01', true, 'en');

    expect(text(line(el))).toBe('RAR authorisation, re-checked on 1 Oct');
  });

  // @traces 1354-FR-005
  it('shows the receptionist the same line', async () => {
    const el = await render('receptionist', 'approved', '2026-10-01', true);

    expect(text(line(el))).toBe('Autorizația RAR, reverificată pe 1 oct.');
  });

  // @traces 1354-FR-005
  it('shows the pill and no line when the stored date is empty', async () => {
    const el = await render('owner', 'approved', null, false);

    expect(text(el.querySelector('[data-verified-pill]'))).toBe(
      'Profil verificat',
    );
    expect(line(el)).toBeNull();
  });

  // @traces 1354-FR-005
  it('shows no line for a re-check flag with no stored date', async () => {
    const el = await render('owner', 'approved', null, true);

    expect(line(el)).toBeNull();
  });

  // @traces 1354-FR-005
  it('hides the strip for a suspended garage', async () => {
    const el = await render('owner', 'suspended', '2026-10-01', true);

    expect(el.querySelector('[data-verified-pill]')).toBeNull();
    expect(line(el)).toBeNull();
  });

  // @traces 1354-FR-005
  it('shows the mechanic no strip', async () => {
    const el = await render('mechanic', 'approved', '2026-10-01', true);

    expect(el.querySelector('[data-verified-pill]')).toBeNull();
  });

  // @traces 1354-FR-005
  it('writes the Bucharest day for a stored date near year end', async () => {
    const el = await render('owner', 'approved', '2026-12-31', false);

    expect(text(line(el))).toBe('Autorizația RAR, verificată pe 31 dec.');
  });
});
