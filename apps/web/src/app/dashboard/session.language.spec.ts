import { TestBed } from '@angular/core/testing';
import { type MeDto, MeService } from '@motor-fix/data-access';

import { account, settle, setup } from './signed-in.testing';

interface Pending {
  language: string;
  resolve(me: MeDto): void;
  reject(error: Error): void;
}

// Each save waits until the test answers it, so its order can be checked.
function savingSetup(signedIn: MeDto | null) {
  const pending: Pending[] = [];
  const meControllerUpdate = jest.fn(
    ({ body }: { body: { language: string } }) =>
      new Promise<MeDto>((resolve, reject) =>
        pending.push({ language: body.language, reject, resolve }),
      ),
  );
  const parts = setup({
    auth: {
      authControllerRefresh: () =>
        signedIn
          ? Promise.resolve({ accessToken: 'renewed' })
          : Promise.reject(new Error('401')),
    },
    me: {
      meControllerMe: jest.fn(() =>
        signedIn ? Promise.resolve(signedIn) : Promise.reject(new Error('401')),
      ),
      meControllerUpdate,
    },
  });
  return { ...parts, meControllerUpdate, pending };
}

async function signedInAs(language: 'ro' | 'en' = 'ro') {
  const parts = savingSetup(account({ language }));
  await parts.session.load();
  await settle();
  return parts;
}

beforeEach(() => localStorage.clear());

describe('saving the language on the account', () => {
  it('sends a tap made while signed in, and holds the saved account', async () => {
    const { choice, i18n, meControllerUpdate, pending, session } =
      await signedInAs('ro');

    await choice.pick('en');

    expect(i18n.language()).toBe('en');
    expect(meControllerUpdate).toHaveBeenCalledTimes(1);
    expect(meControllerUpdate).toHaveBeenCalledWith({
      body: { language: 'en' },
    });
    pending[0].resolve(account({ language: 'en' }));
    await settle();
    expect(session.current()?.language).toBe('en');
  });

  it("sends nothing for a tap on the account's own language", async () => {
    const { choice, meControllerUpdate } = await signedInAs('en');

    await choice.pick('en');
    await settle();

    expect(meControllerUpdate).not.toHaveBeenCalled();
  });

  it('sends nothing when nobody is signed in, and keeps the choice on the device', async () => {
    const { choice, i18n, meControllerUpdate, session } = savingSetup(null);
    await session.load();

    await choice.pick('en');
    await settle();

    expect(meControllerUpdate).not.toHaveBeenCalled();
    expect(i18n.language()).toBe('en');
    expect(localStorage.getItem('mf.lang')).toBe('en');
  });

  it('sends nothing for the language the account brings at sign-in', async () => {
    localStorage.setItem('mf.lang', 'en');
    const { i18n, meControllerUpdate } = await signedInAs('ro');

    expect(i18n.language()).toBe('ro');
    expect(meControllerUpdate).not.toHaveBeenCalled();
  });

  it('sends nothing for a language chosen without the switch', async () => {
    const { choice, meControllerUpdate } = await signedInAs('ro');

    await choice.choose('en');
    await settle();

    expect(meControllerUpdate).not.toHaveBeenCalled();
  });

  it('keeps the interface switched after a failed save, and sends again at the next tap', async () => {
    const { choice, i18n, meControllerUpdate, pending, session } =
      await signedInAs('ro');

    await choice.pick('en');
    pending[0].reject(new Error('offline'));
    await settle();

    expect(i18n.language()).toBe('en');
    expect(session.current()?.language).toBe('ro');

    await choice.pick('en');

    expect(meControllerUpdate).toHaveBeenCalledTimes(2);
    expect(pending[1].language).toBe('en');
  });

  it('sends one save at a time and ends on the last language tapped', async () => {
    const { choice, i18n, meControllerUpdate, pending, session } =
      await signedInAs('ro');

    await choice.pick('en');
    await choice.pick('ro');
    await choice.pick('en');
    await choice.pick('ro');

    expect(meControllerUpdate).toHaveBeenCalledTimes(1);
    pending[0].resolve(account({ language: 'en' }));
    await settle();

    expect(meControllerUpdate).toHaveBeenCalledTimes(2);
    expect(pending[1].language).toBe('ro');
    pending[1].resolve(account({ language: 'ro' }));
    await settle();

    expect(meControllerUpdate).toHaveBeenCalledTimes(2);
    expect(session.current()?.language).toBe('ro');
    expect(i18n.language()).toBe('ro');
  });

  it('sends a tap once even when the answer still says the old language', async () => {
    const { choice, meControllerUpdate, pending } = await signedInAs('ro');

    await choice.pick('en');
    pending[0].resolve(account({ language: 'ro' }));
    await settle();

    expect(meControllerUpdate).toHaveBeenCalledTimes(1);
  });

  it('drops an answer that arrives after signing out', async () => {
    const { choice, pending, session } = await signedInAs('ro');

    await choice.pick('en');
    session.current.set(null);
    pending[0].resolve(account({ language: 'en' }));
    await settle();

    expect(session.current()).toBeNull();
  });

  it('saves the last language tapped before signing out with the button', async () => {
    const { choice, meControllerUpdate, pending, session } =
      await signedInAs('ro');

    await choice.pick('en');
    await choice.pick('ro');
    const signingOut = session.signOut();
    pending[0].resolve(account({ language: 'en' }));
    await settle();

    expect(meControllerUpdate).toHaveBeenCalledTimes(2);
    expect(pending[1].language).toBe('ro');
    pending[1].resolve(account({ language: 'ro' }));
    await signingOut;
    expect(session.current()).toBeNull();
  });

  it('signs out with the button even when the save in flight fails', async () => {
    const { choice, meControllerUpdate, pending, session } =
      await signedInAs('ro');

    await choice.pick('en');
    const signingOut = session.signOut();
    pending[0].reject(new Error('offline'));
    await signingOut;

    expect(session.current()).toBeNull();
    expect(meControllerUpdate).toHaveBeenCalledTimes(1);
  });

  it('signs out with the button within three seconds when the save in flight never answers', async () => {
    const { choice, session } = await signedInAs('ro');

    await choice.pick('en');
    jest.useFakeTimers();
    try {
      let done = false;
      const signingOut = session.signOut().then(() => {
        done = true;
      });
      await jest.advanceTimersByTimeAsync(2_999);
      expect(done).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      await signingOut;
      expect(session.current()).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('drops an answer that arrives after another account signed in', async () => {
    const { choice, meControllerUpdate, pending, session } =
      await signedInAs('ro');
    const other = {
      ...account({ language: 'ro' }),
      id: 'account-2',
      name: 'Elena',
    };

    await choice.pick('en');
    session.current.set(other);
    pending[0].resolve(account({ language: 'en' }));
    await settle();

    expect(session.current()).toBe(other);
    expect(meControllerUpdate).toHaveBeenCalledTimes(1);
  });

  it('keeps a save that lands after the same account signed in again', async () => {
    const { choice, i18n, meControllerUpdate, pending, session } =
      await signedInAs('ro');

    await choice.pick('en');
    session.current.set(null);
    jest
      .mocked(TestBed.inject(MeService).meControllerMe)
      .mockResolvedValueOnce(account({ language: 'ro' }));
    await session.load();
    await settle();
    expect(i18n.language()).toBe('ro');
    pending[0].resolve(account({ language: 'en' }));
    await settle();

    expect(session.current()?.language).toBe('en');
    expect(i18n.language()).toBe('en');
    expect(meControllerUpdate).toHaveBeenCalledTimes(1);
  });
});
