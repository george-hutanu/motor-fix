import {
  type API,
  EVENT_SESSION_RESUME,
  EVENT_SESSION_START,
  genShortID,
  STORAGE_KEY,
} from '@grafana/faro-web-sdk';

// A short alphanumeric id, as genShortID makes; anything else found under
// the key (the SDK's own session object, an edited value) is never sent.
const SHORT_ID = /^[A-Za-z0-9]{1,32}$/;
const SAMPLED = { isSampled: 'true' };

const read = (): string | null => {
  try {
    const id = sessionStorage.getItem(STORAGE_KEY);
    return id && SHORT_ID.test(id) ? id : null;
  } catch {
    return null;
  }
};

const write = (id: string | null) => {
  try {
    if (id) sessionStorage.setItem(STORAGE_KEY, id);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // A device that refuses storage keeps the session for this page only.
  }
};

// Monitoring never breaks the page: an SDK call that throws is dropped.
const quietly = (call: () => void) => {
  try {
    call();
  } catch {
    // The item is lost; the visit goes on.
  }
};

// The monitoring session, owned by the app because the SDK's own session
// tracking stores its session before any consent: a random id per tab, in
// session storage under the SDK's key, only while analytics consent holds.
// Given true it starts or resumes the session; given false it ends it, on
// the tab and in the live meta, so nothing sent afterwards carries it.
export function sessionSync(
  api: Pick<API, 'pushEvent' | 'setSession'>,
): (granted: boolean) => void {
  let active: string | null = null;
  return (granted) => {
    if (!granted) {
      write(null);
      if (active) quietly(() => api.setSession({ attributes: SAMPLED }));
      active = null;
      return;
    }
    if (active) return;
    const kept = read();
    active = kept ?? genShortID();
    write(active);
    const id = active;
    quietly(() => api.setSession({ attributes: SAMPLED, id }));
    quietly(() =>
      api.pushEvent(
        kept ? EVENT_SESSION_RESUME : EVENT_SESSION_START,
        {},
        undefined,
        { skipDedupe: true },
      ),
    );
  };
}
