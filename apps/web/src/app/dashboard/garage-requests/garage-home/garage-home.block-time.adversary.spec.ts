import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { capabilitiesOf } from '@motor-fix/contracts/capabilities';
import {
  GarageRequestsService,
  GaragesService,
  type MeDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { GarageHome } from './garage-home';
import { openBlockTime } from '../../block-time-dialog/open-block-time';
import { Live } from '../../live';
import { Session } from '../../session';
import { fakeLive, listOf, wait } from '../garage-requests.testing';
import { GarageRequestsFeed } from '../garage-requests-feed';

jest.mock('../../block-time-dialog/open-block-time', () => ({
  openBlockTime: jest.fn(async () => 'cancelled'),
}));

const ALL = {
  canAnswerQuotes: true,
  canMoveBookings: true,
  canRecordFinalPrice: true,
};

const account = (
  role: 'owner' | 'receptionist' | 'mechanic',
  features: Record<string, unknown>,
) =>
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

async function render(me: MeDto) {
  const shown = signal(me);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      GarageRequestsFeed,
      { provide: Live, useValue: fakeLive() },
      { provide: Session, useValue: { current: shown, shown } },
      { provide: Overlays, useValue: { open: jest.fn() } },
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
  await TestBed.inject(I18n).enter('garage');
  const fixture = TestBed.createComponent(GarageHome);
  for (let i = 0; i < 4; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
    await wait(0);
  }
  return fixture.nativeElement as HTMLElement;
}

const button = (el: HTMLElement) =>
  el.querySelector<HTMLButtonElement>('[data-block-time]');

afterEach(() => {
  (openBlockTime as jest.Mock).mockReset();
  (openBlockTime as jest.Mock).mockResolvedValue('cancelled');
  TestBed.resetTestingModule();
});

// @traces 1403-FR-001
describe('the dashboard strip: Blochează timp under odd switches', () => {
  it('counts a switch with no value as on', async () => {
    const el = await render(
      account('owner', { lift_schedule: undefined, team_mechanics: false }),
    );

    expect(button(el)).not.toBeNull();
  });

  it('hides it from a mechanic even when both switches are on', async () => {
    const el = await render(
      account('mechanic', { lift_schedule: true, team_mechanics: true }),
    );

    expect(button(el)).toBeNull();
  });

  it('shows one button only', async () => {
    const el = await render(account('owner', {}));

    expect(el.querySelectorAll('[data-block-time]').length).toBe(1);
  });
});

// @traces 1403-FR-002
describe('the dashboard strip: pressing Blochează timp twice', () => {
  it('opens one dialog while the first is still open', async () => {
    let close: (r: string) => void = () => undefined;
    (openBlockTime as jest.Mock).mockImplementation(
      () => new Promise((resolve) => (close = resolve)),
    );
    const el = await render(account('owner', {}));

    button(el)?.click();
    button(el)?.click();
    await wait(0);

    expect(openBlockTime).toHaveBeenCalledTimes(1);
    close('cancelled');
  });

  it('opens again once the first dialog closed', async () => {
    const el = await render(account('owner', {}));

    button(el)?.click();
    await wait(0);
    button(el)?.click();
    await wait(0);

    expect(openBlockTime).toHaveBeenCalledTimes(2);
  });
});
