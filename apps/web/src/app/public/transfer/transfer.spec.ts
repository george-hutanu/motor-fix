import { HttpErrorResponse } from '@angular/common/http';
import { Component, RESPONSE_INIT, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  CarsService,
  type CarTransferAcceptedDto,
  type CarTransferLinkDto,
  type MeDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { TransferPage } from './transfer';
import { Consent } from '../../consent/consent';
import { Session } from '../../dashboard/session';
import { PUBLIC_READ } from '../../public-read';
import { ReacceptDialog } from '../../sign-in/reaccept/reaccept-dialog';
import { SignInDialog } from '../../sign-in/sign-in-dialog';
import { publicChildren } from '../routes';

@Component({ selector: 'mf-cars-stand-in', template: '' })
class CarsStandIn {}

const refusal = (status: number, code?: string) =>
  new HttpErrorResponse({
    error: code ? { code, title: 'no' } : null,
    status,
  });

const VICTOR = { id: 'victor', role: 'driver', roles: ['driver'] } as MeDto;
const offer = (over: Partial<CarTransferLinkDto> = {}): CarTransferLinkDto => ({
  car: { brand: 'VW', model: 'Golf', year: 2015 },
  repairCount: 5,
  sellerName: 'Andrei M.',
  status: 'sent',
  ...over,
});

let read: jest.Mock;
let accept: jest.Mock;
let gate: jest.Mock;
let reaccept: jest.Mock;
let track: jest.Mock;
let current: ReturnType<typeof signal<MeDto | null>>;
let session: {
  current: typeof current;
  roleHint: ReturnType<typeof signal<MeDto['role'] | null>>;
  load: jest.Mock;
  reload: jest.Mock;
  switchRole: jest.Mock;
};
let response: { status?: number };
let harness: RouterTestingHarness;

async function settle() {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    harness.detectChanges();
  }
}

interface Options {
  language?: 'ro' | 'en';
  server?: boolean;
  me?: MeDto | null;
  // The session the browser's cookie holds, loaded only when asked for.
  cookie?: MeDto | null;
  // The role this browser last saw signed in; the cookie's by default.
  hint?: MeDto['role'] | null;
  accepted?: () => Promise<CarTransferAcceptedDto>;
  signIn?: () => Promise<boolean>;
}

async function open(
  answer: (withSession: boolean) => Promise<CarTransferLinkDto>,
  {
    language = 'ro',
    server = true,
    me = null,
    cookie = me,
    hint = cookie?.role ?? null,
    accepted = async () => ({ carId: 'car-9' }),
    signIn = async () => {
      current.set(VICTOR);
      return true;
    },
  }: Options = {},
) {
  read = jest.fn((_params, context) => answer(!context?.get(PUBLIC_READ)));
  accept = jest.fn(accepted);
  gate = jest.fn(signIn);
  reaccept = jest.fn(async () => true);
  track = jest.fn();
  current = signal<MeDto | null>(me);
  session = {
    current,
    load: jest.fn(async () => {
      if (cookie && !current()) current.set(cookie);
      return current();
    }),
    reload: jest.fn(async () => undefined),
    roleHint: signal<MeDto['role'] | null>(hint),
    switchRole: jest.fn(async (role: MeDto['role']) => {
      current.set({ ...(current() as MeDto), role });
      return current();
    }),
  };
  response = {};
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { component: TransferPage, path: ':lang/transfer/:token' },
        { component: CarsStandIn, path: 'app/driver/cars/:id' },
        { children: [], path: ':lang' },
      ]),
      {
        provide: CarsService,
        useValue: {
          carTransferLinkControllerAccept: accept,
          carTransferLinkControllerRead: read,
        },
      },
      { provide: Session, useValue: session },
      { provide: SignInDialog, useValue: { gate } },
      { provide: ReacceptDialog, useValue: { gate: reaccept } },
      { provide: Consent, useValue: { track } },
      ...(server ? [{ provide: RESPONSE_INIT, useValue: response }] : []),
    ],
  });
  await TestBed.inject(I18n).enter('public');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(`/${language}/transfer/abc123`);
  await settle();
}

const page = () => harness.routeNativeElement as HTMLElement;
const said = () => (page().textContent ?? '').replace(/\s+/g, ' ').trim();
const heading = () => page().querySelector('h1')?.textContent?.trim();
const title = () => TestBed.inject(Title).getTitle();
const buttons = () => [...page().querySelectorAll('button')];
const press = (name: string) =>
  buttons()
    .find((b) => b.textContent?.trim() === name)
    ?.click();
const url = () => TestBed.inject(Router).url;

// An offer for whoever reads with a session, the waiting line otherwise.
const forSession = async (withSession: boolean) =>
  withSession ? offer() : { status: 'sent' as const };

// @traces 1392-FR-005 1392-FR-006 1392-FR-007 1392-SC-003
describe('the public transfer page', () => {
  it.each([
    [404, 'not_found', 'Linkul nu există'],
    [410, 'transfer_cancelled', 'Linkul nu mai e valabil'],
    [410, 'transfer_expired', 'Linkul a expirat'],
    [410, 'transfer_accepted', 'Mașina a fost deja preluată'],
  ])('serves %s %s as "%s"', async (status, code, text) => {
    await open(async () => {
      throw refusal(status, code);
    });

    expect(heading()).toBe(text);
    expect(title()).toBe(text);
    expect(response.status).toBe(status);
    expect(buttons()).toHaveLength(0);
  });

  it.each([
    [404, 'not_found', 'This link does not exist'],
    [410, 'transfer_cancelled', 'The link is no longer valid'],
    [410, 'transfer_expired', 'The link has expired'],
    [410, 'transfer_accepted', 'The car has already been taken over'],
  ])('reads %s %s in English', async (status, code, text) => {
    await open(
      async () => {
        throw refusal(status, code);
      },
      { language: 'en' },
    );

    expect(heading()).toBe(text);
  });

  it('says the link could not be checked and reads again on the retry', async () => {
    let calls = 0;
    await open(async () => {
      calls += 1;
      if (calls === 1) throw refusal(500, 'error');
      return { status: 'sent' };
    });

    expect(said()).toContain('Nu am putut verifica linkul. Încearcă din nou.');
    expect(response.status).toBeUndefined();
    press('Încearcă din nou');
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(heading()).toBe('O mașină te așteaptă.');
  });

  it('shows the loading state until the read answers', async () => {
    let answer: (value: CarTransferLinkDto) => void = () => undefined;
    await open(
      () =>
        new Promise<CarTransferLinkDto>((resolve) => {
          answer = resolve;
        }),
      { server: false },
    );

    expect(page().querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(said()).toContain('Verificăm linkul…');

    answer({ status: 'sent' });
    await settle();
    expect(page().querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('is routed as a page search engines must not index', () => {
    expect(
      publicChildren.find((route) => route.path === 'transfer/:token')?.data,
    ).toEqual({ noindex: true });
  });
});

// @traces 1394-FR-001 1394-FR-005
describe('the waiting line', () => {
  it('reads the link as a visitor and asks a signed-out buyer to sign in, served 200', async () => {
    await open(async () => ({ status: 'sent' }));

    expect(read).toHaveBeenCalledWith({ token: 'abc123' }, expect.anything());
    expect(read.mock.calls[0][1].get(PUBLIC_READ)).toBe(true);
    expect(heading()).toBe('O mașină te așteaptă.');
    expect(said()).toContain('Intră în cont ca să o preiei.');
    expect(buttons().map((b) => b.textContent?.trim())).toEqual([
      'Intră în cont',
    ]);
    expect(title()).toBe('O mașină te așteaptă.');
    expect(response.status).toBeUndefined();
  });

  it('reads in English', async () => {
    await open(async () => ({ status: 'sent' }), { language: 'en' });

    expect(heading()).toBe('A car is waiting for you.');
    expect(said()).toContain('Sign in to take it over.');
    expect(buttons().map((b) => b.textContent?.trim())).toEqual(['Sign in']);
    expect(title()).toBe('A car is waiting for you.');
  });

  it('never shows the car, the seller or the repairs a visitor’s read lacks', async () => {
    await open(async () => ({ status: 'sent' }));

    expect(said()).not.toContain('VW');
    expect(said()).not.toContain('Andrei');
    expect(said()).not.toContain('reparați');
  });

  it('opens the sign-in dialog, then reads the link with the session and shows the offer in place', async () => {
    await open(forSession);

    press('Intră în cont');
    await settle();

    expect(gate).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[1][1]?.get(PUBLIC_READ) ?? false).toBe(false);
    expect(heading()).toBe(
      'VW Golf 2015 · 5 reparații transmise · de la Andrei M.',
    );
    expect(url()).toBe('/ro/transfer/abc123');
    expect(document.activeElement).toBe(page().querySelector('h1'));
  });

  it('leaves the waiting line as it was when the dialog closes without a session', async () => {
    await open(forSession, { signIn: async () => false });

    press('Intră în cont');
    await settle();

    expect(gate).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(heading()).toBe('O mașină te așteaptă.');
  });

  it('reads with a remembered session without asking to sign in again', async () => {
    await open(forSession);
    session.load.mockImplementation(async () => {
      current.set(VICTOR);
      return VICTOR;
    });

    press('Intră în cont');
    await settle();

    expect(gate).not.toHaveBeenCalled();
    expect(heading()).toBe(
      'VW Golf 2015 · 5 reparații transmise · de la Andrei M.',
    );
  });

  it('shows the waiting line again, with no second dialog, when the read with the session still has no car', async () => {
    await open(async () => ({ status: 'sent' }));

    press('Intră în cont');
    await settle();

    expect(gate).toHaveBeenCalledTimes(1);
    expect(heading()).toBe('O mașină te așteaptă.');
    await settle();
    expect(gate).toHaveBeenCalledTimes(1);
  });

  it('reads with the session at once for a buyer already signed in', async () => {
    await open(forSession, { me: VICTOR });

    expect(read).toHaveBeenCalledTimes(1);
    expect(heading()).toBe(
      'VW Golf 2015 · 5 reparații transmise · de la Andrei M.',
    );
  });

  it('loads the session the cookie holds before the first read, so a signed-in buyer reads the car', async () => {
    await open(forSession, { cookie: VICTOR });

    expect(session.load).toHaveBeenCalledWith({ keepLanguage: true });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][1]?.get(PUBLIC_READ) ?? false).toBe(false);
    expect(heading()).toBe(
      'VW Golf 2015 · 5 reparații transmise · de la Andrei M.',
    );
  });

  it('never asks for the session of a browser that saw nobody signed in, so a visitor’s open renews nothing', async () => {
    await open(async () => ({ status: 'sent' }), {
      cookie: VICTOR,
      hint: null,
    });

    expect(session.load).not.toHaveBeenCalled();
    expect(read.mock.calls[0][1].get(PUBLIC_READ)).toBe(true);
    expect(heading()).toBe('O mașină te așteaptă.');
  });

  it('tells a seller signed in by cookie that they cannot take over their own car', async () => {
    await open(
      async (withSession) => {
        if (withSession) throw refusal(403, 'own_transfer');
        return { status: 'sent' };
      },
      { cookie: VICTOR },
    );

    expect(heading()).toBe('Nu poți prelua propria mașină');
    expect(buttons()).toEqual([]);
  });

  it('opens the re-accept dialog for a held session whose read has no car, then reads again', async () => {
    let accepted = false;
    await open(async () => (accepted ? offer() : { status: 'sent' }), {
      me: VICTOR,
    });
    reaccept.mockImplementation(async () => {
      accepted = true;
      return true;
    });
    expect(heading()).toBe('O mașină te așteaptă.');

    press('Intră în cont');
    await settle();

    expect(gate).not.toHaveBeenCalled();
    expect(reaccept).toHaveBeenCalledTimes(1);
    expect(reaccept.mock.calls[0][0]).toEqual({
      privacyVersion: expect.any(String),
      termsVersion: expect.any(String),
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(heading()).toBe(
      'VW Golf 2015 · 5 reparații transmise · de la Andrei M.',
    );
    expect(document.activeElement).toBe(page().querySelector('h1'));
  });

  it('leaves the waiting line, with no second dialog, when the re-read after re-accepting still has no car', async () => {
    await open(async () => ({ status: 'sent' }), { me: VICTOR });

    press('Intră în cont');
    await settle();
    await settle();

    expect(reaccept).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(2);
    expect(heading()).toBe('O mașină te așteaptă.');
  });

  it('keeps the waiting line without reading again when the re-accept dialog ends in a sign-out', async () => {
    await open(async () => ({ status: 'sent' }), { me: VICTOR });
    reaccept.mockImplementation(async () => {
      current.set(null);
      return false;
    });

    press('Intră în cont');
    await settle();

    expect(reaccept).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(heading()).toBe('O mașină te așteaptă.');
  });

  it('reads again when the person signs in elsewhere on the page', async () => {
    await open(forSession);

    current.set(VICTOR);
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(heading()).toBe(
      'VW Golf 2015 · 5 reparații transmise · de la Andrei M.',
    );
  });

  it('announces its state changes politely', async () => {
    await open(async () => ({ status: 'sent' }));

    expect(page().querySelector('[aria-live="polite"] h1')).not.toBeNull();
  });
});

// @traces 1394-FR-001
describe('the buyer’s offer', () => {
  it.each([
    [5, 'Andrei M.', 'VW Golf 2015 · 5 reparații transmise · de la Andrei M.'],
    [1, 'Andrei M.', 'VW Golf 2015 · 1 reparație transmisă · de la Andrei M.'],
    [
      0,
      'Andrei M.',
      'VW Golf 2015 · nicio reparație transmisă · de la Andrei M.',
    ],
    [20, null, 'VW Golf 2015 · 20 de reparații transmise'],
    [5, null, 'VW Golf 2015 · 5 reparații transmise'],
  ])(
    'reads %s repairs from %s as "%s"',
    async (repairCount, sellerName, line) => {
      await open(async () => offer({ repairCount, sellerName }), {
        me: VICTOR,
      });

      expect(heading()).toBe(line);
      expect(title()).toBe(line);
      expect(buttons().map((b) => b.textContent?.trim())).toEqual([
        'Preiau mașina',
      ]);
    },
  );

  it.each([
    [5, 'Andrei M.', 'VW Golf 2015 · 5 repairs passed on · from Andrei M.'],
    [1, 'Andrei M.', 'VW Golf 2015 · 1 repair passed on · from Andrei M.'],
    [0, null, 'VW Golf 2015 · no repairs passed on'],
  ])(
    'reads %s repairs from %s in English',
    async (repairCount, sellerName, line) => {
      await open(async () => offer({ repairCount, sellerName }), {
        language: 'en',
        me: VICTOR,
      });

      expect(heading()).toBe(line);
      expect(buttons().map((b) => b.textContent?.trim())).toEqual([
        'Take the car',
      ]);
    },
  );

  it('tells the seller opening their own link they cannot take it over, served 200', async () => {
    await open(async () => {
      throw refusal(403, 'own_transfer');
    });

    expect(heading()).toBe('Nu poți prelua propria mașină');
    expect(title()).toBe('Nu poți prelua propria mașină');
    expect(buttons()).toHaveLength(0);
    expect(response.status).toBeUndefined();
  });

  it('says the own-link text in English', async () => {
    await open(
      async () => {
        throw refusal(403, 'own_transfer');
      },
      { language: 'en' },
    );

    expect(heading()).toBe("You can't take over your own car");
  });
});

// @traces 1394-FR-002 1394-FR-007
describe('taking the car over', () => {
  it('sends one accept, disabled while it is out, then tracks, reloads and opens the car', async () => {
    let answer: (value: CarTransferAcceptedDto) => void = () => undefined;
    await open(forSession, {
      accepted: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
      me: VICTOR,
    });

    press('Preiau mașina');
    await settle();
    const button = buttons()[0];
    expect(button.disabled).toBe(true);
    button.click();
    press('Preiau mașina');
    await settle();
    expect(accept).toHaveBeenCalledTimes(1);
    expect(accept).toHaveBeenCalledWith({ token: 'abc123' });
    expect(track).not.toHaveBeenCalled();

    answer({ carId: 'car-9' });
    await settle();

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('car_taken_over');
    expect(session.reload).toHaveBeenCalledTimes(1);
    expect(session.switchRole).not.toHaveBeenCalled();
    expect(url()).toBe('/app/driver/cars/car-9');
  });

  it('switches a garage-only buyer to the driver role they just gained', async () => {
    await open(forSession, {
      me: { ...VICTOR, role: 'garage', roles: ['garage'] },
    });
    session.reload.mockImplementation(async () => {
      current.set({ ...(current() as MeDto), roles: ['garage', 'driver'] });
    });

    press('Preiau mașina');
    await settle();

    expect(session.reload).toHaveBeenCalledTimes(1);
    expect(session.switchRole).toHaveBeenCalledWith('driver');
    expect(url()).toBe('/app/driver/cars/car-9');
  });

  it.each([
    ['car_limit', 'Poți avea cel mult 20 de mașini.'],
    [
      'open_request',
      'Mașina are o cerere în curs. Poți prelua mașina după ce se încheie.',
    ],
  ])(
    'replaces the button with the %s text and keeps the car line',
    async (code, text) => {
      await open(forSession, {
        accepted: async () => {
          throw refusal(409, code);
        },
        me: VICTOR,
      });

      press('Preiau mașina');
      await settle();

      expect(heading()).toBe(
        'VW Golf 2015 · 5 reparații transmise · de la Andrei M.',
      );
      expect(said()).toContain(text);
      expect(buttons()).toHaveLength(0);
      expect(track).not.toHaveBeenCalled();
      expect(url()).toBe('/ro/transfer/abc123');
      expect(document.activeElement).toBe(page().querySelector('h1'));
    },
  );

  it.each([
    ['car_limit', 'You can have at most 20 cars.'],
    [
      'open_request',
      'The car has a request under way. You can take the car over once it ends.',
    ],
  ])('says %s in English', async (code, text) => {
    await open(forSession, {
      accepted: async () => {
        throw refusal(409, code);
      },
      language: 'en',
      me: VICTOR,
    });

    press('Take the car');
    await settle();

    expect(said()).toContain(text);
  });

  it.each([
    [410, 'transfer_cancelled', 'Linkul nu mai e valabil'],
    [410, 'transfer_expired', 'Linkul a expirat'],
    [410, 'transfer_accepted', 'Mașina a fost deja preluată'],
    [404, 'not_found', 'Linkul nu există'],
  ])(
    'shows the %s %s state and drops the car line',
    async (status, code, text) => {
      await open(forSession, {
        accepted: async () => {
          throw refusal(status, code);
        },
        me: VICTOR,
      });

      press('Preiau mașina');
      await settle();

      expect(heading()).toBe(text);
      expect(said()).not.toContain('VW Golf');
      expect(buttons()).toHaveLength(0);
      expect(track).not.toHaveBeenCalled();
    },
  );

  it('shows the own-link text when the accept answers own_transfer', async () => {
    await open(forSession, {
      accepted: async () => {
        throw refusal(403, 'own_transfer');
      },
      me: VICTOR,
    });

    press('Preiau mașina');
    await settle();

    expect(heading()).toBe('Nu poți prelua propria mașină');
    expect(buttons()).toHaveLength(0);
  });

  it('reads the link again and shows the waiting line when the sign-in the 401 asked for was closed', async () => {
    await open(forSession, {
      accepted: async () => {
        current.set(null);
        throw refusal(401, 'sign_in_required');
      },
      // The session ended: the cookie holds none either.
      cookie: null,
      me: VICTOR,
    });

    press('Preiau mașina');
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(heading()).toBe('O mașină te așteaptă.');
    expect(said()).not.toContain('Ceva nu a mers');
    expect(track).not.toHaveBeenCalled();
  });

  it('shows the error under the car line and lets the buyer try again on any other failure', async () => {
    let calls = 0;
    await open(forSession, {
      accepted: async () => {
        calls += 1;
        if (calls === 1) throw refusal(503, 'error');
        return { carId: 'car-9' };
      },
      me: VICTOR,
    });

    press('Preiau mașina');
    await settle();

    expect(heading()).toBe(
      'VW Golf 2015 · 5 reparații transmise · de la Andrei M.',
    );
    expect(said()).toContain('Ceva nu a mers. Încearcă din nou.');
    expect(buttons()[0].disabled).toBe(false);
    expect(track).not.toHaveBeenCalled();

    press('Preiau mașina');
    await settle();
    expect(accept).toHaveBeenCalledTimes(2);
    expect(track).toHaveBeenCalledTimes(1);
    expect(url()).toBe('/app/driver/cars/car-9');
  });

  it('still opens the car when the session reload fails after the takeover', async () => {
    await open(forSession, { me: VICTOR });
    session.reload.mockRejectedValue(new Error('offline'));

    press('Preiau mașina');
    await settle();

    expect(track).toHaveBeenCalledTimes(1);
    expect(url()).toBe('/app/driver/cars/car-9');
  });
});
