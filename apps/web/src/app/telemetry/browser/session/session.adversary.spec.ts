import { EVENT_SESSION_START, STORAGE_KEY } from '@grafana/faro-web-sdk';

import { sessionSync } from './session';

let api: { pushEvent: jest.Mock; setSession: jest.Mock };

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  api = { pushEvent: jest.fn(), setSession: jest.fn() };
});

afterEach(() => jest.restoreAllMocks());

const stored = () => sessionStorage.getItem(STORAGE_KEY);
const ID = /^[A-Za-z0-9]{1,32}$/;

describe('sessionSync under hostile stored values', () => {
  // @traces 947-FR-008
  it('keeps an id of exactly 32 alphanumeric characters', () => {
    const id = 'a1'.repeat(16);
    sessionStorage.setItem(STORAGE_KEY, id);

    sessionSync(api)(true);

    expect(stored()).toBe(id);
  });

  // @traces 947-FR-008
  it.each([
    ['padded with a space', ' Ab12Cd34Ef'],
    ['with a newline', 'Ab12Cd34\nEf'],
    ['with a hyphen', 'Ab12-Cd34'],
    ['with unicode letters', 'Ab12Cd34é'],
    ['with a script tag', '<script>1</script>'],
    ['a url', 'https://x.example/a'],
    ['a phone number', '0722123456 '],
  ])('replaces a stored value %s and never sends it', (_, value) => {
    sessionStorage.setItem(STORAGE_KEY, value);

    sessionSync(api)(true);

    expect(stored()).toMatch(ID);
    expect(stored()).not.toBe(value);
    expect(JSON.stringify(api.setSession.mock.calls)).not.toContain(value);
    expect(api.pushEvent.mock.calls[0]?.[0]).toBe(EVENT_SESSION_START);
  });
});

describe('sessionSync over many toggles', () => {
  // @traces 947-FR-003
  it('never reuses a session id across fifty grant and withdraw cycles', () => {
    const sync = sessionSync(api);
    const seen = new Set<string>();

    for (let i = 0; i < 50; i++) {
      sync(true);
      seen.add(stored() ?? 'none');
      sync(false);
      expect(stored()).toBeNull();
    }

    expect(seen.size).toBe(50);
    expect(seen.has('none')).toBe(false);
  });

  // @traces 947-FR-003
  it('withdrawing twice clears the live session once', () => {
    const sync = sessionSync(api);
    sync(true);
    api.setSession.mockClear();

    sync(false);
    sync(false);

    expect(api.setSession).toHaveBeenCalledTimes(1);
  });

  // @traces 947-FR-001
  it('never writes the session id to local storage', () => {
    const sync = sessionSync(api);
    sync(true);
    sync(false);
    sync(true);

    expect(localStorage.length).toBe(0);
  });

  // @traces 947-FR-003
  it('a second instance told of withdrawal clears what the first wrote', () => {
    sessionSync(api)(true);
    expect(stored()).toMatch(ID);

    sessionSync(api)(false);

    expect(stored()).toBeNull();
  });
});

describe('sessionSync when the SDK fails', () => {
  // @traces 947-FR-012
  it('does not throw when setSession throws on consent', () => {
    api.setSession.mockImplementation(() => {
      throw new Error('sdk down');
    });

    expect(() => sessionSync(api)(true)).not.toThrow();
  });

  // @traces 947-FR-012
  it('does not throw when pushEvent throws on consent', () => {
    api.pushEvent.mockImplementation(() => {
      throw new Error('sdk down');
    });

    expect(() => sessionSync(api)(true)).not.toThrow();
  });

  // @traces 947-FR-012
  // @traces 947-FR-003
  it('still clears the stored session on withdrawal when setSession throws', () => {
    const sync = sessionSync(api);
    sync(true);
    api.setSession.mockImplementation(() => {
      throw new Error('sdk down');
    });

    try {
      sync(false);
    } catch {
      // the stored id must be gone either way
    }

    expect(stored()).toBeNull();
  });
});
