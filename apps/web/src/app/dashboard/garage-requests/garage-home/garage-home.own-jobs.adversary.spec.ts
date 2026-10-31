import { signal } from '@angular/core';
import { DeferBlockBehavior, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { capabilitiesOf } from '@motor-fix/contracts/capabilities';
import {
  GarageJobsService,
  GarageRequestsService,
  GaragesService,
  type MeDto,
} from '@motor-fix/data-access';
import { Overlays } from '@motor-fix/overlays';

import { GarageHome } from './garage-home';
import { Live } from '../../live';
import { Session } from '../../session';
import { fakeLive, listOf, wait } from '../garage-requests.testing';
import { GarageRequestsFeed } from '../garage-requests-feed';

const NONE = {
  canAnswerQuotes: false,
  canMoveBookings: false,
  canRecordFinalPrice: false,
};
const MECHANIC = capabilitiesOf('mechanic', NONE) as string[];

async function render(
  capabilities: string[],
  features: unknown,
  role = 'mechanic',
) {
  const me = signal({
    capabilities,
    garageAccess: [
      {
        features,
        garageId: 'garage-1',
        name: 'Atelier Test',
        permissions: NONE,
        role,
        status: 'approved',
      },
    ],
    garageId: 'garage-1',
  } as unknown as MeDto);
  TestBed.configureTestingModule({
    deferBlockBehavior: DeferBlockBehavior.Manual,
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
        provide: GaragesService,
        useValue: {
          legalCheckControllerRead: () => new Promise(() => undefined),
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
const link = (el: HTMLElement) =>
  [...el.querySelectorAll('a')].find((a) => text(a) === 'Foaia mea de zi');
const section = (el: HTMLElement) => el.querySelector('mf-own-jobs-section');

afterEach(() => TestBed.resetTestingModule());

// @traces 423-FR-003
describe('the day-sheet link with unusual switch values', () => {
  it.each([
    ['true', { day_sheets: true }, true],
    ['missing', {}, true],
    ['false', { day_sheets: false }, false],
    ['null', { day_sheets: null }, true],
    ['the string "false"', { day_sheets: 'false' }, true],
    ['zero', { day_sheets: 0 }, true],
    ['an empty features object replaced by null', null, true],
  ])(
    'with day_sheets %s the link shows: %s',
    async (_name, features, shown) => {
      const el = await render(MECHANIC, features);
      expect(link(el) !== undefined).toBe(shown);
      expect(section(el)).not.toBeNull();
    },
  );
});

// @traces 423-FR-001
describe('who gets the own-jobs section', () => {
  it('shows a mechanic who also holds garage.profile no own-jobs section', async () => {
    const el = await render([...MECHANIC, 'garage.profile'], {});
    expect(section(el)).toBeNull();
  });

  it('shows a mechanic who also holds garage.feature_switches no own-jobs section', async () => {
    const el = await render([...MECHANIC, 'garage.feature_switches'], {});
    expect(section(el)).toBeNull();
  });

  it('shows nobody with no capability any own-jobs section or link', async () => {
    const el = await render([], {}, 'mechanic');
    expect(section(el)).toBeNull();
    expect(link(el)).toBeUndefined();
  });

  it('shows the link only once in the page', async () => {
    const el = await render(MECHANIC, {});
    expect(
      [...el.querySelectorAll('a')].filter(
        (a) => text(a) === 'Foaia mea de zi',
      ),
    ).toHaveLength(1);
  });
});
