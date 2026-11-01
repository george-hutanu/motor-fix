import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
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
import { SignInDialog } from '../../sign-in/sign-in-dialog';

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

let accept: jest.Mock;
let gate: jest.Mock;
let track: jest.Mock;
let load: jest.Mock;
let current: ReturnType<typeof signal<MeDto | null>>;
let session: {
  current: typeof current;
  roleHint: ReturnType<typeof signal<MeDto['role'] | null>>;
  load: jest.Mock;
  reload: jest.Mock;
  switchRole: jest.Mock;
};
let harness: RouterTestingHarness;

async function settle() {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve));
    harness.detectChanges();
  }
}

interface Options {
  me?: MeDto | null;
  accepted?: () => Promise<CarTransferAcceptedDto>;
  signIn?: () => Promise<boolean>;
  loaded?: () => Promise<MeDto | null>;
}

async function open(
  answer: (withSession: boolean) => Promise<CarTransferLinkDto>,
  {
    me = null,
    accepted = async () => ({ carId: 'car-9' }),
    signIn = async () => {
      current.set(VICTOR);
      return true;
    },
    loaded,
  }: Options = {},
) {
  const read = jest.fn((_params, context) => answer(!context));
  accept = jest.fn(accepted);
  gate = jest.fn(signIn);
  track = jest.fn();
  current = signal<MeDto | null>(me);
  load = jest.fn(loaded ?? (async () => current()));
  session = {
    current,
    load,
    reload: jest.fn(async () => undefined),
    // A browser that saw nobody signed in: the page asks for no session.
    roleHint: signal<MeDto['role'] | null>(null),
    switchRole: jest.fn(async (role: MeDto['role']) => {
      current.set({ ...(current() as MeDto), role });
      return current();
    }),
  };
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
      { provide: Consent, useValue: { track } },
    ],
  });
  await TestBed.inject(I18n).enter('public');
  harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/ro/transfer/abc123');
  await settle();
  return read;
}

const page = () => harness.routeNativeElement as HTMLElement;
const said = () => (page().textContent ?? '').replace(/\s+/g, ' ').trim();
const heading = () => page().querySelector('h1')?.textContent?.trim();
const buttons = () => [...page().querySelectorAll('button')];
const press = (name: string) =>
  buttons()
    .find((b) => b.textContent?.trim() === name)
    ?.click();
const url = () => TestBed.inject(Router).url;

const forSession =
  (over: Partial<CarTransferLinkDto> = {}) =>
  async () =>
    offer(over);

// @traces 1394-FR-001
describe('the offer line under odd offers', () => {
  it.each([
    [0, 'nicio reparație transmisă'],
    [1, '1 reparație transmisă'],
    [2, '2 reparații transmise'],
    [19, '19 reparații transmise'],
    [20, '20 de reparații transmise'],
    [101, '101 reparații transmise'],
    [120, '120 de reparații transmise'],
  ])('writes %p repairs as "%s"', async (count, text) => {
    await open(forSession({ repairCount: count }), { me: VICTOR });

    expect(heading()).toBe(`VW Golf 2015 · ${text} · de la Andrei M.`);
  });

  it('leaves the seller out when the seller has no name', async () => {
    await open(forSession({ sellerName: '' }), { me: VICTOR });

    expect(heading()).toBe('VW Golf 2015 · 5 reparații transmise');
  });

  it('leaves the seller out when the name is null', async () => {
    await open(forSession({ sellerName: null as unknown as string }), {
      me: VICTOR,
    });

    expect(heading()).toBe('VW Golf 2015 · 5 reparații transmise');
  });

  it('shows markup in a seller name as plain text', async () => {
    await open(forSession({ sellerName: '<img src=x onerror=alert(1)>' }), {
      me: VICTOR,
    });

    expect(page().querySelector('img')).toBeNull();
    expect(heading()).toContain('de la <img src=x onerror=alert(1)>');
  });

  it('writes a car whose names are unicode as they are', async () => {
    await open(
      forSession({ car: { brand: 'Škoda', model: 'Fabia ŞŢ', year: 2015 } }),
      { me: VICTOR },
    );

    expect(heading()).toBe(
      'Škoda Fabia ŞŢ 2015 · 5 reparații transmise · de la Andrei M.',
    );
  });
});

// @traces 1394-FR-002 1394-FR-007
describe('taking the car over under odd answers', () => {
  it.each([
    [409, 'something_new'],
    [409, undefined],
    [429, 'rate_limited'],
    [500, 'error'],
  ])(
    'keeps the offer and shows the error for a %s %s',
    async (status, code) => {
      await open(forSession(), {
        accepted: async () => {
          throw refusal(status, code);
        },
        me: VICTOR,
      });

      press('Preiau mașina');
      await settle();

      expect(said()).toContain('Ceva nu a mers. Încearcă din nou.');
      expect(buttons()[0].disabled).toBe(false);
      expect(track).not.toHaveBeenCalled();
    },
  );

  it('shows the error when the accept throws a plain error', async () => {
    await open(forSession(), {
      accepted: async () => {
        throw new Error('socket hang up');
      },
      me: VICTOR,
    });

    press('Preiau mașina');
    await settle();

    expect(said()).toContain('Ceva nu a mers. Încearcă din nou.');
    expect(url()).toBe('/ro/transfer/abc123');
  });

  it('clears the error while the next try is out', async () => {
    let calls = 0;
    let answer: (value: CarTransferAcceptedDto) => void = () => undefined;
    await open(forSession(), {
      accepted: () => {
        calls += 1;
        if (calls === 1) return Promise.reject(refusal(500, 'error'));
        return new Promise((resolve) => {
          answer = resolve;
        });
      },
      me: VICTOR,
    });

    press('Preiau mașina');
    await settle();
    press('Preiau mașina');
    await settle();

    expect(said()).not.toContain('Ceva nu a mers');
    answer({ carId: 'car-9' });
    await settle();
  });

  it('reads the offer again for the signed-in buyer after a 401 whose sign-in succeeded', async () => {
    let calls = 0;
    const read = await open(forSession(), {
      accepted: async () => {
        calls += 1;
        throw refusal(401, 'sign_in_required');
      },
      me: VICTOR,
    });

    press('Preiau mașina');
    await settle();

    expect(read).toHaveBeenCalledTimes(2);
    expect(calls).toBe(1);
    expect(heading()).toContain('VW Golf 2015');
    expect(track).not.toHaveBeenCalled();
  });

  it('shows the cancelled state for a 403 that is not the own link', async () => {
    await open(forSession(), {
      accepted: async () => {
        throw refusal(403, 'forbidden');
      },
      me: VICTOR,
    });

    press('Preiau mașina');
    await settle();

    expect(said()).not.toContain('VW Golf');
    expect(track).not.toHaveBeenCalled();
    expect(url()).toBe('/ro/transfer/abc123');
  });

  it('opens the car and does not switch role when the reload leaves no session', async () => {
    await open(forSession(), { me: VICTOR });
    session.reload.mockImplementation(async () => {
      current.set(null);
    });

    press('Preiau mașina');
    await settle();

    expect(session.switchRole).not.toHaveBeenCalled();
    expect(url()).toBe('/app/driver/cars/car-9');
  });

  it('still opens the car when switching to the driver role fails', async () => {
    await open(forSession(), {
      me: { ...VICTOR, role: 'garage', roles: ['garage'] },
    });
    session.switchRole.mockRejectedValue(new Error('offline'));

    press('Preiau mașina');
    await settle();

    expect(track).toHaveBeenCalledTimes(1);
    expect(url()).toBe('/app/driver/cars/car-9');
  });

  it('tracks the takeover once even when the buyer is slow to open the car', async () => {
    await open(forSession(), { me: VICTOR });
    let release: () => void = () => undefined;
    session.reload.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    press('Preiau mașina');
    await settle();
    press('Preiau mașina');
    await settle();
    release();
    await settle();

    expect(accept).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('keeps a car id with a slash inside the cars address', async () => {
    await open(forSession(), {
      accepted: async () => ({ carId: '../../admin' }),
      me: VICTOR,
    });

    press('Preiau mașina');
    await settle();

    expect(url()).toMatch(/^\/app\/driver\/cars\/[^/]+$/);
  });

  it('keeps a car id with a query or fragment inside the cars address', async () => {
    await open(forSession(), {
      accepted: async () => ({ carId: 'car-9?next=/admin#x' }),
      me: VICTOR,
    });

    press('Preiau mașina');
    await settle();

    expect(url()).toBe(
      `/app/driver/cars/${encodeURIComponent('car-9?next=/admin#x')}`,
    );
  });
});

// @traces 1394-FR-001
describe('the sign-in line under odd sessions', () => {
  const waiting = async () => ({ status: 'sent' as const });

  it('asks to sign in once when the button is pressed twice at once', async () => {
    await open(waiting, {
      loaded: async () => null,
      signIn: () =>
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5)),
    });

    press('Intră în cont');
    press('Intră în cont');
    await settle();

    expect(gate).toHaveBeenCalledTimes(1);
  });

  it('asks to sign in when loading the session fails', async () => {
    await open(waiting, {
      loaded: async () => {
        throw new Error('offline');
      },
      signIn: async () => false,
    });

    press('Intră în cont');
    await settle();

    expect(gate).toHaveBeenCalledTimes(1);
    expect(heading()).toBe('O mașină te așteaptă.');
  });

  it('does not read again when the dialog says signed in but no session exists', async () => {
    const read = await open(waiting, {
      loaded: async () => null,
      signIn: async () => true,
    });

    press('Intră în cont');
    await settle();

    expect(read).toHaveBeenCalledTimes(1);
    expect(heading()).toBe('O mașină te așteaptă.');
  });

  it('can ask again after a closed dialog', async () => {
    await open(waiting, {
      loaded: async () => null,
      signIn: async () => false,
    });

    press('Intră în cont');
    await settle();
    press('Intră în cont');
    await settle();

    expect(gate).toHaveBeenCalledTimes(2);
  });
});
