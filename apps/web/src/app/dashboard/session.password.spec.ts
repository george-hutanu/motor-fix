import { setup } from './signed-in.testing';

function passwordSetup() {
  let answer: (value?: unknown) => void = () => undefined;
  let refuse: (error: unknown) => void = () => undefined;
  const { auth, session } = setup({
    auth: {
      authControllerRefresh: jest.fn(() => Promise.reject(new Error('401'))),
      passwordChangeControllerChange: jest.fn(
        () =>
          new Promise((resolve, reject) => {
            answer = resolve;
            refuse = reject;
          }),
      ),
    },
    me: { meControllerMe: jest.fn() },
  });
  return {
    answer: () => answer(),
    api: auth,
    refuse: (error: unknown) => refuse(error),
    session,
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve));

afterEach(() => jest.useRealTimers());

// @traces 139-FR-014
describe('changing the password from this tab', () => {
  it('sends the passwords to the password change', async () => {
    const { answer, api, session } = passwordSetup();

    const done = session.changePassword({
      currentPassword: 'veche',
      newPassword: 'parola-noua',
    });
    answer();
    await done;

    expect(api.passwordChangeControllerChange).toHaveBeenCalledWith({
      body: { currentPassword: 'veche', newPassword: 'parola-noua' },
    });
  });

  it('keeps this tab signed in through the sign-out it sends the others, while it is sent and for a while after', async () => {
    jest.useFakeTimers({ now: 0 });
    const { answer, session } = passwordSetup();
    expect(session.keepsThroughRevoke()).toBe(false);

    const done = session.changePassword({ newPassword: 'parola-noua' });
    expect(session.keepsThroughRevoke()).toBe(true);
    answer();
    await done;
    expect(session.keepsThroughRevoke()).toBe(true);

    jest.advanceTimersByTime(60_000);
    expect(session.keepsThroughRevoke()).toBe(false);
  });

  it('stops keeping it when the change is refused', async () => {
    const { refuse, session } = passwordSetup();

    const done = session.changePassword({ newPassword: 'parola-noua' });
    refuse(new Error('invalid_credentials'));
    await expect(done).rejects.toThrow('invalid_credentials');
    await tick();

    expect(session.keepsThroughRevoke()).toBe(false);
  });
});

// @traces 129-FR-008
describe('deleting the account from this tab', () => {
  it('owns the "sessions ended" word while the deletion is sent, and until the tab forgets the session', async () => {
    const { session } = passwordSetup();
    let answer: () => void = () => undefined;
    expect(session.deletingAccount()).toBe(false);

    const done = session.deleteAccount(
      () => new Promise<void>((resolve) => (answer = resolve)),
    );
    expect(session.deletingAccount()).toBe(true);
    answer();
    await done;
    expect(session.deletingAccount()).toBe(true);

    session.revoked();
    expect(session.deletingAccount()).toBe(false);
  });

  it('gives the word back when the deletion is refused', async () => {
    const { session } = passwordSetup();

    await expect(
      session.deleteAccount(() => Promise.reject(new Error('mismatch'))),
    ).rejects.toThrow('mismatch');

    expect(session.deletingAccount()).toBe(false);
  });
});
