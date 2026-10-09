import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { GarageRequestsService, type MeDto } from '@motor-fix/data-access';

import { GarageHome } from './garage-home';
import { Live } from '../../live';
import { Session } from '../../session';
import { fakeLive, listOf, requestRow, wait } from '../garage-requests.testing';
import { GarageRequestsFeed } from '../garage-requests-feed';

const OWNER = ['garage.requests', 'garage.schedule', 'garage.team'];
const RECEPTIONIST = ['garage.requests', 'garage.schedule'];
const ANSWERING_MECHANIC = ['garage.own_jobs', 'garage.requests'];
const MECHANIC = ['garage.own_jobs'];

let list: jest.Mock;

const account = (
  capabilities: string[],
  status: 'draft' | 'approved' | 'suspended',
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
        role: 'owner',
        status,
      },
    ],
    garageId: 'garage-1',
  }) as unknown as MeDto;

async function render(
  capabilities: string[],
  {
    answer = () => Promise.resolve(listOf([requestRow()])),
    status = 'approved',
  }: {
    answer?: () => Promise<unknown>;
    status?: 'draft' | 'approved' | 'suspended';
  } = {},
) {
  list = jest.fn(({ status: filter }: { status: string }) =>
    filter === 'waiting' ? answer() : Promise.resolve(listOf([])),
  );
  const me = signal(account(capabilities, status));
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

  it('keeps the check line, and no panel, while the garage is a draft', async () => {
    const element = await render(OWNER, { status: 'draft' });

    expect(text(element)).toBe('Profilul tău e în verificare.');
    expect(panel(element)).toBeNull();
  });

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

  it('shows a mechanic without the permission no panel, and makes no call', async () => {
    const element = await render(MECHANIC);

    expect(panel(element)).toBeNull();
    expect(list).not.toHaveBeenCalled();
    expect(text(element)).toBe('Aici vei vedea ce se întâmplă azi în service.');
  });

  it('shows nothing of the requests, and no error, when the server answers 404', async () => {
    const element = await render(OWNER, {
      answer: () => Promise.reject(new HttpErrorResponse({ status: 404 })),
    });

    expect(panel(element)).toBeNull();
    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(text(element)).toBe('Aici vei vedea ce se întâmplă azi în service.');
  });
});
