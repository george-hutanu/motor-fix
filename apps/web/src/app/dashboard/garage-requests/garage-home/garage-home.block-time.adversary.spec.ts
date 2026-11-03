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

// The dialog opens through Overlays.open once its chunk has loaded.
const open = vi.fn<(...args: unknown[]) => Promise<string>>(
  async () => 'cancelled',
);

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
    deferBlockBehavior: DeferBlockBehavior.Manual,
    providers: [
      provideRouter([]),
      GarageRequestsFeed,
      { provide: Live, useValue: fakeLive() },
      { provide: Session, useValue: { current: shown, shown } },
      { provide: Overlays, useValue: { open } },
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
  open.mockReset();
  open.mockResolvedValue('cancelled');
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
    open.mockImplementation(() => new Promise((resolve) => (close = resolve)));
    const el = await render(account('owner', {}));

    button(el)?.click();
    button(el)?.click();
    await wait(0);

    expect(open).toHaveBeenCalledTimes(1);
    close('cancelled');
  });

  it('opens again once the first dialog closed', async () => {
    const el = await render(account('owner', {}));

    button(el)?.click();
    await wait(0);
    button(el)?.click();
    await wait(0);

    expect(open).toHaveBeenCalledTimes(2);
  });
});
