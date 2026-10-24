import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { GarageMechanicDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';

import { RemoveMechanic, type RemoveMechanicData } from './remove-mechanic';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const URL = '/api/v1/garages/garage-1/mechanics/mechanic-1';

const elena = (futureBookings: number): GarageMechanicDto => ({
  brandIds: [],
  certifications: [],
  futureBookings,
  hasAccount: true,
  id: 'mechanic-1',
  isOwner: false,
  name: 'Elena Stan',
  onProfile: true,
  rating: null,
  reviewCount: 0,
  roleTitle: null,
  speciality: null,
  specialties: [],
  years: null,
});

let http: HttpTestingController;
let result: Promise<OverlayResult<true>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(futureBookings = 0, language: 'ro' | 'en' = 'ro') {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  await TestBed.inject(I18n).enter('garage');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  http = TestBed.inject(HttpTestingController);
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<true, RemoveMechanicData>(
    RemoveMechanic,
    {
      data: { card: elena(futureBookings), garageId: 'garage-1' },
      shape: 'dialog',
      title: 'garage.mechanicCard.remove.title',
    },
  );
  await settle();
}

const body = () => document.querySelector('mf-remove-mechanic') as HTMLElement;
const said = () => (body().textContent ?? '').replace(/\s+/g, ' ').trim();
// A button's own label: the busy button's spoken "sending" line is not it.
const labelOf = (b: HTMLButtonElement) =>
  [...b.childNodes]
    .filter((n) =>
      n instanceof HTMLElement
        ? !n.matches('.mf-task-sending')
        : n.nodeType === Node.TEXT_NODE,
    )
    .map((n) => n.textContent ?? '')
    .join('')
    .trim();

const buttons = () => [...body().querySelectorAll('button')].map(labelOf);
const button = (name: string) =>
  [...body().querySelectorAll('button')].find(
    (b) => labelOf(b) === name,
  ) as HTMLButtonElement;

afterEach(() => {
  http?.verify();
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  jest.mocked(toast).mockReset();
  TestBed.resetTestingModule();
});

// @traces 056-FR-018
describe('the removal confirmation', () => {
  it('asks to remove the mechanic when no booking is ahead, with the two buttons', async () => {
    await open(0);

    expect(said()).toContain('Elimini pe Elena Stan din echipă?');
    expect(said()).not.toContain('programar');
    expect(buttons()).toEqual(expect.arrayContaining(['Elimină', 'Renunță']));
  });

  it.each([
    [1, 'Elena Stan are 1 programare viitoare.'],
    [2, 'Elena Stan are 2 programări viitoare. Vor trebui realocate.'],
    [19, 'Elena Stan are 19 programări viitoare. Vor trebui realocate.'],
    [20, 'Elena Stan are 20 de programări viitoare. Vor trebui realocate.'],
  ])(
    'names %i future bookings with the Romanian plural, in place of the question',
    async (n, line) => {
      await open(n);

      expect(said()).toContain(line);
      expect(said()).not.toContain('Elimini pe');
    },
  );

  it.each([
    [0, 'Remove Elena Stan from the team?'],
    [1, 'Elena Stan has 1 future booking.'],
    [3, 'Elena Stan has 3 future bookings. They will need reassigning.'],
  ])('reads English for %i future bookings', async (n, line) => {
    await open(n, 'en');

    expect(said()).toContain(line);
    expect(buttons()).toEqual(expect.arrayContaining(['Remove', 'Cancel']));
  });

  it('removes the card on Elimină and closes with true on 204', async () => {
    await open(3);

    button('Elimină').click();
    await settle();
    const req = http.expectOne({ method: 'DELETE', url: URL });
    expect(button('Elimină').getAttribute('aria-busy')).toBe('true');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await settle();

    await expect(result).resolves.toBe(true);
  });

  it('closes with cancelled on Renunță, removing nothing', async () => {
    await open(3);

    button('Renunță').click();
    await settle();

    http.expectNone(URL);
    await expect(result).resolves.toBe('cancelled');
  });

  it('says so in a toast and stays open when the removal is refused', async () => {
    await open(0);

    button('Elimină').click();
    await settle();
    http
      .expectOne({ method: 'DELETE', url: URL })
      .flush(
        { code: 'owner_row', title: 'owner' },
        { status: 409, statusText: 'Conflict' },
      );
    await settle();

    expect(toast).toHaveBeenCalledWith(
      expect.not.stringMatching(/^(garage|shell)\./),
    );
    expect(body().isConnected).toBe(true);
    expect(button('Elimină').getAttribute('aria-busy')).toBeNull();
  });

  it('shows a name typed with markup as text', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    await TestBed.inject(I18n).enter('garage');
    http = TestBed.inject(HttpTestingController);
    const host = TestBed.createComponent(Host);
    void host.componentInstance.overlays.open<true, RemoveMechanicData>(
      RemoveMechanic,
      {
        data: {
          card: { ...elena(0), name: '<b>Elena</b>' },
          garageId: 'garage-1',
        },
        shape: 'dialog',
        title: 'garage.mechanicCard.remove.title',
      },
    );
    await settle();

    expect(body().querySelector('b')).toBeNull();
    expect(said()).toContain('Elimini pe <b>Elena</b> din echipă?');
  });
});
