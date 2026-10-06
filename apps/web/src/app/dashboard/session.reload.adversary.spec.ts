import { TestBed } from '@angular/core/testing';
import { AuthService, type MeDto, MeService } from '@motor-fix/data-access';

import { Session } from './session';

const DRIVER = {
  capabilities: [],
  email: 'andrei@example.ro',
  emailConfirmed: false,
  garageId: null,
  id: 'account-1',
  landing: '/app/driver',
  language: 'ro',
  name: 'Andrei Marin',
  role: 'driver',
  roles: ['driver', 'garage'],
} as MeDto;

const GARAGE = {
  ...DRIVER,
  garageId: 'garage-1',
  landing: '/app/garage',
  role: 'garage',
} as MeDto;

function setup() {
  const meControllerMe = jest.fn(() => Promise.resolve(DRIVER));
  const auth = {
    authControllerRefresh: jest.fn(() =>
      Promise.resolve({ accessToken: 'renewed' }),
    ),
    authControllerSignIn: jest.fn(() =>
      Promise.resolve({ accessToken: 'signed-in' }),
    ),
    authControllerSignOut: jest.fn(() => Promise.resolve()),
    authControllerSwitchRole: jest.fn(() =>
      Promise.resolve({ accessToken: 'as-garage' }),
    ),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: MeService, useValue: { meControllerMe } },
      { provide: AuthService, useValue: auth },
    ],
  });
  return { auth, meControllerMe, session: TestBed.inject(Session) };
}

function held(meControllerMe: jest.Mock) {
  const pending: { resolve: (me: MeDto) => void } = {
    resolve: () => undefined,
  };
  meControllerMe.mockImplementationOnce(
    () =>
      new Promise<MeDto>((resolve) => {
        pending.resolve = resolve;
      }),
  );
  return pending;
}

async function signedIn() {
  const ctx = setup();
  await ctx.session.signIn('andrei@example.ro', 'parola-lunga', false);
  return ctx;
}

describe('reading the account again, under overlapping changes', () => {
  it('accepts a reload sent after the switch even though an older one is still pending', async () => {
    const { meControllerMe, session } = await signedIn();
    const stale = held(meControllerMe);
    const staleReading = session.reload();
    meControllerMe.mockResolvedValueOnce(GARAGE);
    await session.switchRole('garage');
    const fresh = { ...GARAGE, emailConfirmed: true };
    meControllerMe.mockResolvedValueOnce(fresh);

    await session.reload();
    stale.resolve(DRIVER);
    await staleReading;

    expect(session.current()).toEqual(fresh);
  });

  it('lets a reload that answers mid-switch land, then the switch replaces it', async () => {
    const { meControllerMe, session } = await signedIn();
    const reloadAnswer = held(meControllerMe);
    const reading = session.reload();
    const switchedLoad = held(meControllerMe);

    const switching = session.switchRole('garage');
    await Promise.resolve();
    await Promise.resolve();
    const confirmed = { ...DRIVER, emailConfirmed: true };
    reloadAnswer.resolve(confirmed);
    await reading;
    expect(session.current()).toEqual(confirmed);
    switchedLoad.resolve(GARAGE);
    await switching;

    expect(session.current()).toBe(GARAGE);
  });

  it('keeps the switched account when a reload sent during the switch load answers with the new role', async () => {
    const { meControllerMe, session } = await signedIn();
    const switchedLoad = held(meControllerMe);
    const switching = session.switchRole('garage');
    await Promise.resolve();
    await Promise.resolve();
    const confirmed = { ...GARAGE, emailConfirmed: true };
    meControllerMe.mockResolvedValueOnce(confirmed);

    await session.reload();
    switchedLoad.resolve(GARAGE);
    await switching;

    expect(session.token()).toBe('as-garage');
    expect(session.current()?.role).toBe('garage');
  });

  it('accepts the answer when a failed switch put the original token back', async () => {
    const { meControllerMe, session } = await signedIn();
    const before = session.token();
    await session.load();
    const reloadAnswer = held(meControllerMe);
    const reading = session.reload();
    meControllerMe.mockRejectedValueOnce(new Error('offline'));

    await expect(session.switchRole('garage')).rejects.toThrow('offline');
    const confirmed = { ...DRIVER, emailConfirmed: true };
    reloadAnswer.resolve(confirmed);
    await reading;

    expect(session.token()).toBe(before);
    expect(session.current()).toEqual(confirmed);
  });
});
