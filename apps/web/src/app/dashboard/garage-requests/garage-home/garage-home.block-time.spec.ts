import { signal } from '@angular/core';
import { DeferBlockBehavior, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { capabilitiesOf } from '@motor-fix/contracts/capabilities';
import {
  GarageRequestsService,
  GaragesService,
  type MeDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import type { Mock } from 'vitest';

import { GarageHome } from './garage-home';
import { Live } from '../../live';
import { Session } from '../../session';
import { fakeLive, listOf, wait } from '../garage-requests.testing';
import { GarageRequestsFeed } from '../garage-requests-feed';

// Fetched before the first test, so the import() under test finds it loaded;
// the bundler would drop a bare side-effect import of it.
beforeAll(async () => {
  await import('../../block-time-dialog/block-time-dialog');
});

type Role = 'owner' | 'receptionist' | 'mechanic';

const ALL = {
  canAnswerQuotes: true,
  canMoveBookings: true,
  canRecordFinalPrice: true,
};

const account = (role: Role, features: Record<string, boolean>) =>
  ({
    capabilities: capabilitiesOf(role === 'owner' ? 'garage' : role, ALL),
    garageAccess: [
      {
        features,
        garageId: 'garage-1',
        name: 'Atelier Dinamo',
        permissions: ALL,
        role,
        status: 'approved',
      },
    ],
    garageId: 'garage-1',
  }) as unknown as MeDto;

let overlays: { open: Mock };

async function render(
  role: Role,
  features: Record<string, boolean> = {},
  language: 'ro' | 'en' = 'ro',
) {
  const me = signal(account(role, features));
  // The dialog opens through Overlays.open once its chunk has loaded.
  overlays = { open: vi.fn(async () => 'cancelled') };
  TestBed.configureTestingModule({
    deferBlockBehavior: DeferBlockBehavior.Manual,
    providers: [
      provideRouter([]),
      GarageRequestsFeed,
      { provide: Live, useValue: fakeLive() },
      { provide: Session, useValue: { current: me, shown: me } },
      { provide: Overlays, useValue: overlays },
      {
        provide: GarageRequestsService,
        useValue: {
          garageRequestsControllerList: () => Promise.resolve(listOf([])),
        },
      },
      {
        provide: GaragesService,
        useValue: {
          // Today's numbers have their own spec; here they wait.
          garageTodayFigures: () => new Promise(() => undefined),
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

const button = (el: HTMLElement) =>
  el.querySelector<HTMLButtonElement>('.strip button[data-block-time]');

afterEach(() => {
  TestBed.resetTestingModule();
});

// @traces 1403-FR-001
describe('the dashboard strip: Blochează timp', () => {
  it.each<Role>(['owner', 'receptionist'])(
    'is offered to the %s, beside Personalizează panoul',
    async (role) => {
      const el = await render(role);

      const block = button(el);
      expect(block?.textContent?.trim()).toBe('Blochează timp');
      expect(block?.hasAttribute('hlmbtn')).toBe(true);
      expect(block?.type).toBe('button');
      const customise = el.querySelector(
        '.strip [data-customise]',
      ) as HTMLElement;
      const row = [...(customise.parentElement?.children ?? [])];
      expect(row.indexOf(block as HTMLElement)).toBe(
        row.indexOf(customise) - 1,
      );
    },
  );

  it('reads Block time in English', async () => {
    const el = await render('receptionist', {}, 'en');

    expect(button(el)?.textContent?.trim()).toBe('Block time');
  });

  it('is not offered to a mechanic, whatever she may do', async () => {
    const el = await render('mechanic');

    expect(button(el)).toBeNull();
  });

  it.each<[string, Record<string, boolean>]>([
    ['both switches on', { lift_schedule: true, team_mechanics: true }],
    ['no key for either switch', {}],
    ['the team off', { team_mechanics: false }],
    ['the lifts off', { lift_schedule: false }],
  ])('is offered with %s', async (_, features) => {
    expect(button(await render('owner', features))).not.toBeNull();
    TestBed.resetTestingModule();
    expect(button(await render('receptionist', features))).not.toBeNull();
  });

  it('is not offered with both switches off, to the owner or a receptionist', async () => {
    const off = { lift_schedule: false, team_mechanics: false };

    expect(button(await render('owner', off))).toBeNull();
    TestBed.resetTestingModule();
    expect(button(await render('receptionist', off))).toBeNull();
  });
});

// @traces 1403-FR-002
describe('the dashboard strip: pressing Blochează timp', () => {
  it.each<[string, Record<string, boolean>, boolean, boolean]>([
    ['both on', {}, true, true],
    ['the team off', { team_mechanics: false }, false, true],
    ['the lifts off', { lift_schedule: false }, true, false],
  ])(
    'opens the dialog for the shown garage with %s',
    async (_, features, team, lifts) => {
      const el = await render('receptionist', features);

      button(el)?.click();
      await wait(0);

      expect(overlays.open).toHaveBeenCalledTimes(1);
      expect(overlays.open).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          data: { garageId: 'garage-1', lifts, team },
        }),
      );
    },
  );
});
