import type { MeDto } from '@motor-fix/data-access';

import { setup } from './signed-in.testing';

const DRIVER = {
  capabilities: [],
  city: null,
  email: 'andrei@example.ro',
  emailConfirmed: false,
  garageAccess: [],
  garageId: null,
  hasPassword: true,
  id: 'account-1',
  landing: '/app/driver',
  language: 'ro',
  name: 'Andrei Marin',
  pendingEmail: null,
  phone: null,
  phoneConfirmed: false,
  role: 'driver',
  roles: ['driver'],
} as MeDto;

const GARAGE = {
  ...DRIVER,
  garageAccess: [],
  garageId: 'garage-1',
  landing: '/app/garage',
  role: 'garage',
  roles: ['driver', 'garage'],
} as MeDto;

function reloadSetup() {
  const { me, session } = setup({
    auth: {
      authControllerSignIn: jest.fn(() =>
        Promise.resolve({ accessToken: 'signed-in' }),
      ),
      authControllerSwitchRole: jest.fn(() =>
        Promise.resolve({ accessToken: 'as-garage' }),
      ),
    },
    me: { meControllerMe: jest.fn(() => Promise.resolve(DRIVER)) },
  });
  return { meControllerMe: me.meControllerMe, session };
}

// The next read of the account waits until the test answers it.
function held(meControllerMe: jest.Mock) {
  let answer: (me: MeDto) => void = () => undefined;
  meControllerMe.mockImplementationOnce(
    () =>
      new Promise<MeDto>((resolve) => {
        answer = resolve;
      }),
  );
  return (me: MeDto) => answer(me);
}

describe('reading the account again', () => {
  it('replaces the account with what the server now says, keeping it on screen meanwhile', async () => {
    const { meControllerMe, session } = reloadSetup();
    await session.load();
    const answer = held(meControllerMe);

    const reading = session.reload();
    expect(session.current()).toBe(DRIVER);
    const confirmed = { ...DRIVER, emailConfirmed: true };
    answer(confirmed);
    await reading;

    expect(session.current()).toEqual(confirmed);
  });

  it('keeps the account it has when the server does not answer', async () => {
    const { meControllerMe, session } = reloadSetup();
    await session.load();
    meControllerMe.mockRejectedValueOnce(new Error('offline'));

    await session.reload();

    expect(session.current()).toBe(DRIVER);
  });

  it('restores nothing after a sign-out', async () => {
    const { meControllerMe, session } = reloadSetup();
    await session.load();
    const answer = held(meControllerMe);

    const reading = session.reload();
    await session.signOut();
    answer({ ...DRIVER, emailConfirmed: true });
    await reading;

    expect(session.current()).toBeNull();
  });

  it('keeps the role switched to when the old role answers late', async () => {
    const { meControllerMe, session } = reloadSetup();
    await session.load();
    const answer = held(meControllerMe);

    const reading = session.reload();
    meControllerMe.mockResolvedValueOnce(GARAGE);
    await session.switchRole('garage');
    answer({ ...DRIVER, emailConfirmed: true });
    await reading;

    expect(session.token()).toBe('as-garage');
    expect(session.current()).toBe(GARAGE);
  });

  it('keeps the account signed in meanwhile when the old session answers late', async () => {
    const { meControllerMe, session } = reloadSetup();
    await session.load();
    const answer = held(meControllerMe);
    const other = { ...DRIVER, id: 'account-2', name: 'Ioana Pop' } as MeDto;

    const reading = session.reload();
    meControllerMe.mockResolvedValueOnce(other);
    await session.signIn('ioana@example.ro', 'parola-lunga', false);
    answer(DRIVER);
    await reading;

    expect(session.current()).toBe(other);
  });

  it('keeps the answer when the token was only renewed meanwhile', async () => {
    const { meControllerMe, session } = reloadSetup();
    await session.signIn('andrei@example.ro', 'parola-lunga', false);
    const answer = held(meControllerMe);

    const reading = session.reload();
    await session.renew();
    const confirmed = { ...DRIVER, emailConfirmed: true };
    answer(confirmed);
    await reading;

    expect(session.token()).toBe('renewed');
    expect(session.current()).toEqual(confirmed);
  });

  it('does nothing signed out', async () => {
    const { meControllerMe, session } = reloadSetup();

    await session.reload();

    expect(meControllerMe).not.toHaveBeenCalled();
    expect(session.current()).toBeNull();
  });
});
