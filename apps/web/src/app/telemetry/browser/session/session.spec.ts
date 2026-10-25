import {
  EVENT_SESSION_RESUME,
  EVENT_SESSION_START,
  STORAGE_KEY,
} from '@grafana/faro-web-sdk';

import { sessionSync } from './session';

const ID = /^[A-Za-z0-9]{10}$/;
const SAMPLED = { attributes: { isSampled: 'true' } };

let api: { pushEvent: jest.Mock; setSession: jest.Mock };

beforeEach(() => {
  sessionStorage.clear();
  api = { pushEvent: jest.fn(), setSession: jest.fn() };
});

afterEach(() => jest.restoreAllMocks());

const stored = () => sessionStorage.getItem(STORAGE_KEY);
const sessionIds = () =>
  api.setSession.mock.calls.map(([session]) => session.id);

describe('sessionSync', () => {
  // @traces 947-FR-002
  // @traces 947-FR-008
  it('starts a new short random session on consent and keeps it for the tab', () => {
    sessionSync(api)(true);

    const id = stored();
    expect(id).toMatch(ID);
    expect(api.setSession).toHaveBeenCalledWith({ ...SAMPLED, id });
    expect(api.pushEvent).toHaveBeenCalledWith(
      EVENT_SESSION_START,
      {},
      undefined,
      { skipDedupe: true },
    );
  });

  // @traces 947-FR-002
  it('resumes the session this tab already kept', () => {
    sessionStorage.setItem(STORAGE_KEY, 'Ab12Cd34Ef');

    sessionSync(api)(true);

    expect(api.setSession).toHaveBeenCalledWith({
      ...SAMPLED,
      id: 'Ab12Cd34Ef',
    });
    expect(api.pushEvent).toHaveBeenCalledWith(
      EVENT_SESSION_RESUME,
      {},
      undefined,
      { skipDedupe: true },
    );
    expect(stored()).toBe('Ab12Cd34Ef');
  });

  // @traces 947-FR-008
  it.each([
    ['an e-mail', 'ana@example.com'],
    ['the SDK session object', '{"sessionId":"Ab12"}'],
    ['too long an id', 'a'.repeat(33)],
    ['an empty value', ''],
  ])('replaces %s found under the key, never sending it', (_, value) => {
    sessionStorage.setItem(STORAGE_KEY, value);

    sessionSync(api)(true);

    expect(stored()).toMatch(ID);
    expect(JSON.stringify(api.setSession.mock.calls)).not.toContain(
      value || '""',
    );
    expect(api.pushEvent).toHaveBeenCalledWith(
      EVENT_SESSION_START,
      {},
      undefined,
      { skipDedupe: true },
    );
  });

  it('does nothing more when consent is reported again', () => {
    const sync = sessionSync(api);

    sync(true);
    sync(true);

    expect(api.setSession).toHaveBeenCalledTimes(1);
    expect(api.pushEvent).toHaveBeenCalledTimes(1);
  });

  // @traces 947-FR-001
  it('keeps and sends nothing without consent', () => {
    sessionSync(api)(false);

    expect(stored()).toBeNull();
    expect(api.pushEvent).not.toHaveBeenCalled();
    expect(sessionIds().filter(Boolean)).toEqual([]);
  });

  // @traces 947-FR-001
  it('removes a session left on the tab when there is no consent', () => {
    sessionStorage.setItem(STORAGE_KEY, 'Ab12Cd34Ef');

    sessionSync(api)(false);

    expect(stored()).toBeNull();
  });

  // @traces 947-FR-003
  it('ends the session on withdrawal: removed from the tab and from the live meta', () => {
    const sync = sessionSync(api);
    sync(true);
    api.setSession.mockClear();

    sync(false);

    expect(stored()).toBeNull();
    expect(api.setSession).toHaveBeenCalledWith(SAMPLED);
  });

  // @traces 947-FR-003
  it('starts a new session, never the old one, when consent is given again', () => {
    const sync = sessionSync(api);
    sync(true);
    const first = stored();

    sync(false);
    sync(true);

    expect(stored()).toMatch(ID);
    expect(stored()).not.toBe(first);
    expect(api.pushEvent).toHaveBeenLastCalledWith(
      EVENT_SESSION_START,
      {},
      undefined,
      { skipDedupe: true },
    );
  });

  // @traces 947-FR-012
  it('keeps the session in memory when the device refuses storage, and never throws', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const sync = sessionSync(api);

    expect(() => sync(true)).not.toThrow();
    expect(sessionIds()[0]).toMatch(ID);
    expect(() => sync(false)).not.toThrow();
    expect(api.setSession).toHaveBeenLastCalledWith(SAMPLED);
  });
});
