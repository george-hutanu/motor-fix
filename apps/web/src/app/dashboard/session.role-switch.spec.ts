import { TestBed } from '@angular/core/testing';
import { AuthService, type MeDto, MeService } from '@motor-fix/data-access';

import { Session } from './session';

const account = (role: 'garage' | 'driver') =>
  ({
    capabilities: [],
    email: 'mihai@example.ro',
    garageId: role === 'garage' ? 'garage-1' : null,
    id: 'account-1',
    landing: role === 'garage' ? '/app/garage' : '/app/driver',
    language: 'ro',
    name: 'Mihai',
    role,
    roles: ['garage', 'driver'],
  }) as unknown as MeDto;

function setup(switches: () => Promise<{ accessToken: string }>) {
  let role: 'garage' | 'driver' = 'garage';
  const auth = {
    authControllerRefresh: jest.fn(() =>
      Promise.resolve({ accessToken: 'renewed' }),
    ),
    authControllerSignOut: jest.fn(() => Promise.resolve()),
  };
  const me = {
    meControllerMe: jest.fn(() => Promise.resolve(account(role))),
    meControllerSwitchRole: jest.fn(async () => {
      const answer = await switches();
      role = 'driver';
      return answer;
    }),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: MeService, useValue: me },
      { provide: AuthService, useValue: auth },
    ],
  });
  return { auth, me, session: TestBed.inject(Session) };
}

describe('Session, switching the role', () => {
  it('asks for the role, keeps the new token and loads the account in that role', async () => {
    const { me, session } = setup(async () => ({ accessToken: 'as-driver' }));
    await session.load();

    const after = await session.switchRole('driver');

    expect(me.meControllerSwitchRole).toHaveBeenCalledWith({
      body: { role: 'driver' },
    });
    expect(session.token()).toBe('as-driver');
    expect(after?.role).toBe('driver');
    expect(session.current()?.landing).toBe('/app/driver');
  });

  it('keeps the token and the account when the switch fails, and rejects', async () => {
    const { session } = setup(() => Promise.reject(new Error('offline')));
    await session.load();
    const before = session.current();
    const token = session.token();

    await expect(session.switchRole('driver')).rejects.toThrow('offline');

    expect(session.current()).toBe(before);
    expect(session.token()).toBe(token);
  });

  it('keeps the account when the switch answers no token', async () => {
    const { session } = setup(async () => ({ accessToken: '' }));
    await session.load();
    const before = session.current();

    await expect(session.switchRole('driver')).rejects.toThrow();

    expect(session.current()).toBe(before);
  });

  it('goes back to the old token when the account does not load in the new role', async () => {
    const { me, session } = setup(async () => ({ accessToken: 'as-driver' }));
    await session.load();
    const before = session.current();
    const token = session.token();
    me.meControllerMe.mockImplementationOnce(() =>
      Promise.reject(new Error('offline')),
    );

    await expect(session.switchRole('driver')).rejects.toThrow('offline');

    expect(session.current()).toBe(before);
    expect(session.token()).toBe(token);
  });

  it('restores nothing when signed out while the switch was on its way', async () => {
    let answer: (value: { accessToken: string }) => void = () => undefined;
    const { session } = setup(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    await session.load();
    const switching = session.switchRole('driver');
    await session.signOut();

    answer({ accessToken: 'as-driver' });
    await switching.catch(() => undefined);

    expect(session.current()).toBeNull();
    expect(session.token()).toBeNull();
  });
});

describe('Session, renewing the token', () => {
  it('asks for the role the tab is showing', async () => {
    const { auth, session } = setup(async () => ({ accessToken: 'x' }));
    await session.load();

    await session.renew();

    expect(auth.authControllerRefresh).toHaveBeenLastCalledWith({
      body: { role: 'garage' },
    });
  });

  it('keeps the switch’s token when a renewal sent before the switch answers after it', async () => {
    const { auth, session } = setup(async () => ({ accessToken: 'as-driver' }));
    await session.load();
    let answer: (value: { accessToken: string }) => void = () => undefined;
    auth.authControllerRefresh.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    const renewing = session.renew();

    await session.switchRole('driver');
    answer({ accessToken: 'as-garage' });
    await renewing;

    expect(session.token()).toBe('as-driver');
    expect(session.current()?.role).toBe('driver');
  });

  it('asks for no role before an account is on screen', async () => {
    const { auth, session } = setup(async () => ({ accessToken: 'x' }));

    await session.renew();

    expect(auth.authControllerRefresh).toHaveBeenCalledWith({ body: {} });
  });
});
