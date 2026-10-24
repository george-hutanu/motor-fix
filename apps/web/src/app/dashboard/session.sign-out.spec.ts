import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { MeDto } from '@motor-fix/data-access';

import { Session } from './session';
import { setup } from './signed-in.testing';

const ME = {
  capabilities: [],
  email: 'andrei@example.ro',
  garageAccess: [],
  garageId: null,
  id: 'account-1',
  landing: '/app/driver',
  language: 'ro',
  name: 'Andrei',
  role: 'driver',
  roles: ['driver'],
} as unknown as MeDto;

// The browser's tabs, as far as BroadcastChannel goes: a message reaches
// every other channel of the same name, never its sender.
class Tabs {
  static open: Tabs[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(readonly name: string) {
    Tabs.open.push(this);
  }
  postMessage(data: unknown) {
    for (const tab of Tabs.open) {
      if (tab !== this && tab.name === this.name) {
        tab.onmessage?.({ data } as MessageEvent);
      }
    }
  }
  close() {
    Tabs.open = Tabs.open.filter((tab) => tab !== this);
  }
}

const offline = () =>
  Promise.reject(new HttpErrorResponse({ status: 0, statusText: 'Unknown' }));
const answered = (status: number) =>
  Promise.reject(new HttpErrorResponse({ status }));

function tabsSetup({ tabs = 1 } = {}) {
  const { auth, session } = setup({
    auth: {
      authControllerSignIn: jest.fn(() =>
        Promise.resolve({ accessToken: 'signed-in' }),
      ),
      authControllerSignOutEverywhere: jest.fn(() => Promise.resolve()),
      authControllerSignUp: jest.fn(() =>
        Promise.resolve({ accessToken: 'signed-up' }),
      ),
    },
    me: { meControllerMe: jest.fn(() => Promise.resolve(ME)) },
  });
  // A second tab of the same browser: its own Session, the same cookie.
  const other =
    tabs > 1 ? TestBed.runInInjectionContext(() => new Session()) : session;
  return { api: auth, other, session };
}

const flush = () => new Promise((resolve) => setTimeout(resolve));
const PENDING = 'mf-sign-out-pending';

beforeEach(() => {
  localStorage.clear();
  Tabs.open = [];
  (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = Tabs;
});

afterEach(() => {
  delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
});

describe('signing out on all devices', () => {
  it('forgets the session and asks the server to end every session', async () => {
    const { api, session } = tabsSetup();
    await session.load();

    await session.signOutEverywhere();

    expect(api.authControllerSignOutEverywhere).toHaveBeenCalledTimes(1);
    expect(api.authControllerSignOut).not.toHaveBeenCalled();
    expect(session.token()).toBeNull();
    expect(session.current()).toBeNull();
  });

  it('forgets the session even when the call fails', async () => {
    const { api, session } = tabsSetup();
    await session.load();
    api.authControllerSignOutEverywhere.mockImplementationOnce(() =>
      answered(500),
    );

    await session.signOutEverywhere();

    expect(session.token()).toBeNull();
    expect(session.current()).toBeNull();
  });
});

describe('the other tabs of this browser', () => {
  it.each([
    ['on this device', 'signOut'],
    ['on all devices', 'signOutEverywhere'],
  ] as const)('sign out when one tab signs out %s', async (_, how) => {
    const { other, session } = tabsSetup({ tabs: 2 });
    await session.load();
    await other.load();
    const ended = jest.fn();
    other.ended.subscribe(ended);

    await session[how]();

    expect(other.token()).toBeNull();
    expect(other.current()).toBeNull();
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('are not told when a tab forgets a session the server already revoked', async () => {
    const { api, other, session } = tabsSetup({ tabs: 2 });
    await session.load();
    await other.load();
    const ended = jest.fn();
    other.ended.subscribe(ended);

    session.revoked();
    await flush();

    expect(session.token()).toBeNull();
    expect(session.current()).toBeNull();
    expect(other.token()).not.toBeNull();
    expect(ended).not.toHaveBeenCalled();
    expect(api.authControllerSignOut).not.toHaveBeenCalled();
    expect(api.authControllerSignOutEverywhere).not.toHaveBeenCalled();
  });

  it('do not ask the server again: the tab that signed out did', async () => {
    const { api, other, session } = tabsSetup({ tabs: 2 });
    await session.load();
    await other.load();

    await session.signOut();
    await flush();

    expect(api.authControllerSignOut).toHaveBeenCalledTimes(1);
  });

  it('does not tell the tab that signed out that it ended', async () => {
    const { session } = tabsSetup();
    await session.load();
    const ended = jest.fn();
    session.ended.subscribe(ended);

    await session.signOut();

    expect(ended).not.toHaveBeenCalled();
  });

  it('let a renewal answered after the other tab signed out restore nothing', async () => {
    const { api, other, session } = tabsSetup({ tabs: 2 });
    let answerLate: (value: { accessToken: string }) => void = () => undefined;
    api.authControllerRefresh.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerLate = resolve;
        }),
    );
    const renewing = other.renew();

    await session.signOut();
    answerLate({ accessToken: 'late' });

    expect(await renewing).toBe(false);
    expect(other.token()).toBeNull();
  });

  it('works without BroadcastChannel, signing only this tab out', async () => {
    delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
    const { other, session } = tabsSetup({ tabs: 2 });
    await session.load();
    await other.load();

    await session.signOut();

    expect(session.current()).toBeNull();
    expect(other.current()).not.toBeNull();
  });
});

describe('a sign-out that gets no answer', () => {
  it.each([
    ['offline', offline],
    ['a 503', () => answered(503)],
  ])('is kept pending when %s', async (_, failure) => {
    const { api, session } = tabsSetup();
    await session.load();
    api.authControllerSignOut.mockImplementationOnce(failure);

    await session.signOut();

    expect(localStorage.getItem(PENDING)).toBe('device');
  });

  it.each([
    ['204', () => Promise.resolve()],
    ['401', () => answered(401)],
  ])('is not kept after a %s answer', async (_, answer) => {
    const { api, session } = tabsSetup();
    await session.load();
    api.authControllerSignOutEverywhere.mockImplementationOnce(answer);

    await session.signOutEverywhere();

    expect(localStorage.getItem(PENDING)).toBeNull();
  });

  it('is sent again when the connection returns, then dropped', async () => {
    const { api, session } = tabsSetup();
    await session.load();
    api.authControllerSignOutEverywhere.mockImplementationOnce(offline);
    await session.signOutEverywhere();
    expect(localStorage.getItem(PENDING)).toBe('everywhere');

    window.dispatchEvent(new Event('online'));
    await flush();

    expect(api.authControllerSignOutEverywhere).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(PENDING)).toBeNull();
  });

  it('stays pending when the retry gets no answer either', async () => {
    const { api, session } = tabsSetup();
    await session.load();
    api.authControllerSignOut
      .mockImplementationOnce(offline)
      .mockImplementationOnce(offline);
    await session.signOut();

    window.dispatchEvent(new Event('online'));
    await flush();

    expect(localStorage.getItem(PENDING)).toBe('device');
  });

  it('is sent before the next session renews from the cookie', async () => {
    localStorage.setItem(PENDING, 'device');
    const { api, session } = tabsSetup();
    const order: string[] = [];
    api.authControllerSignOut.mockImplementationOnce(async () => {
      order.push('sign-out');
    });
    api.authControllerRefresh.mockImplementationOnce(async () => {
      order.push('refresh');
      return { accessToken: 'renewed' };
    });

    await session.load();

    expect(order).toEqual(['sign-out', 'refresh']);
    expect(localStorage.getItem(PENDING)).toBeNull();
  });

  it.each([
    ['sign-in', (s: Session) => s.signIn('andrei@example.ro', 'parola', true)],
    [
      'sign-up',
      (s: Session) =>
        s.signUp('Andrei', 'andrei@example.ro', 'parola-lunga', 'ro'),
    ],
  ])(
    'is sent before a %s, so it never ends the new session',
    async (_, start) => {
      localStorage.setItem(PENDING, 'everywhere');
      const { api, session } = tabsSetup();
      const order: string[] = [];
      api.authControllerSignOutEverywhere.mockImplementationOnce(async () => {
        order.push('sign-out-everywhere');
      });
      api.authControllerSignIn.mockImplementationOnce(async () => {
        order.push('start');
        return { accessToken: 'signed-in' };
      });
      api.authControllerSignUp.mockImplementationOnce(async () => {
        order.push('start');
        return { accessToken: 'signed-up' };
      });

      await start(session);

      expect(order).toEqual(['sign-out-everywhere', 'start']);
      expect(localStorage.getItem(PENDING)).toBeNull();
    },
  );

  it.each([
    ['sign-in', (s: Session) => s.signIn('andrei@example.ro', 'parola', true)],
    [
      'sign-up',
      (s: Session) =>
        s.signUp('Andrei', 'andrei@example.ro', 'parola-lunga', 'ro'),
    ],
  ])(
    'is dropped once a %s succeeds, even when its retry got no answer, so it never ends the new session',
    async (_, start) => {
      localStorage.setItem(PENDING, 'everywhere');
      const { api, session } = tabsSetup();
      api.authControllerSignOutEverywhere.mockImplementationOnce(() =>
        answered(503),
      );

      await start(session);
      await session.load();

      expect(api.authControllerSignOutEverywhere).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem(PENDING)).toBeNull();
      expect(session.token()).not.toBeNull();
    },
  );

  it('is not kept by a retry that was on its way while a sign-in started a new session', async () => {
    const { api, session } = tabsSetup();
    let answerSignIn: (value: { accessToken: string }) => void = () =>
      undefined;
    api.authControllerSignIn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerSignIn = resolve;
        }),
    );
    let failRetry: () => void = () => undefined;
    api.authControllerSignOutEverywhere.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          failRetry = () => reject(new HttpErrorResponse({ status: 503 }));
        }),
    );
    const signingIn = session.signIn('andrei@example.ro', 'parola', true);
    await flush();
    localStorage.setItem(PENDING, 'everywhere');
    window.dispatchEvent(new Event('online'));
    await flush();

    answerSignIn({ accessToken: 'signed-in' });
    await flush();
    failRetry();
    await signingIn;
    await session.load();

    expect(api.authControllerSignOutEverywhere).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(PENDING)).toBeNull();
  });
});

// @traces 532-FR-003
// @traces 532-FR-004
describe('the account a sign-out ends', () => {
  const watch = (session: Session) => {
    const ended: string[] = [];
    session.signedOut.subscribe((id) => ended.push(id));
    return ended;
  };

  it('is told when this tab signs out', async () => {
    const { session } = tabsSetup();
    await session.load();
    const ended = watch(session);

    await session.signOut();

    expect(ended).toEqual(['account-1']);
  });

  it('is told when the server revoked the session', async () => {
    const { session } = tabsSetup();
    await session.load();
    const ended = watch(session);

    session.revoked();
    await flush();

    expect(ended).toEqual(['account-1']);
  });

  it('is told in the other tab when one tab signs out', async () => {
    const { other, session } = tabsSetup({ tabs: 2 });
    await session.load();
    await other.load();
    const ended = watch(other);

    await session.signOut();

    expect(ended).toEqual(['account-1']);
  });

  it('is not told when a renewal is refused', async () => {
    const { api, session } = tabsSetup();
    await session.load();
    const ended = watch(session);
    api.authControllerRefresh.mockRejectedValueOnce(new Error('expired'));

    await session.renew();
    await flush();

    expect(session.current()).toBeNull();
    expect(ended).toEqual([]);
  });

  it('is told when the account signs out after its renewal was refused', async () => {
    const { api, session } = tabsSetup();
    await session.load();
    const ended = watch(session);
    api.authControllerRefresh.mockRejectedValueOnce(new Error('expired'));
    await session.renew();

    await session.signOut();

    expect(ended).toEqual(['account-1']);
  });
});
