import { observeDataStores } from '@motor-fix/observability';

import { DataStoreMetricsModule } from './data-store-metrics.module';

jest.mock('@motor-fix/observability', () => ({
  observeDataStores: jest.fn(() => () => undefined),
  telemetryStarted: jest.fn(() => true),
}));
jest.mock('../store/store', () => ({
  borrowStore: jest.fn(() => ({ info: jest.fn() })),
  returnStore: jest.fn(async () => undefined),
}));
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    end: jest.fn(async () => undefined),
    on: jest.fn(),
    query: jest.fn(),
  })),
}));

const observe = jest.mocked(observeDataStores);
const URL = 'http://keycloak.railway.internal:9000/metrics';

type Stores = Parameters<typeof observeDataStores>[0];

// Builds the module as Nest would from register() and starts it, returning
// the stores it handed to the readings.
function started(keycloakMetricsUrl?: string): Stores {
  const dynamic = DataStoreMetricsModule.register({
    databaseUrl: 'postgres://app@db/motorfix',
    redisUrl: 'redis://store:6379',
    ...(keycloakMetricsUrl !== undefined && { keycloakMetricsUrl }),
  });
  const [clients, interval] = (dynamic.providers ?? []) as {
    useFactory?: () => unknown;
    useValue?: unknown;
  }[];
  const module = new DataStoreMetricsModule(
    clients?.useFactory?.() as never,
    interval?.useValue as never,
  );
  module.onModuleInit();
  return observe.mock.calls.at(-1)?.[0] as Stores;
}

// An answer streaming the body; cancel watches the body being let go.
const answer = (status: number, body = '') => {
  const stream = new Blob([body]).stream();
  const cancel = jest.spyOn(stream, 'cancel');
  const response = {
    body: stream,
    headers: new Headers(),
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
  return { cancel, response };
};

let fetch: jest.SpyInstance;
beforeEach(() => {
  observe.mockClear();
  fetch = jest.spyOn(globalThis, 'fetch');
});
afterEach(() => jest.restoreAllMocks());

// @traces 1178-FR-005
// @traces 1178-FR-007
describe('the Keycloak reading in the data-store readings', () => {
  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])(
    'is off, and nothing is fetched, with KEYCLOAK_METRICS_URL %s',
    (_, url) => {
      const stores = started(url);

      expect(stores).toBeDefined();
      expect(stores.keycloak).toBeUndefined();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('fetches the address once a reading, asking for text within 5 s, and returns the body', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    fetch.mockResolvedValue(answer(200, 'jvm_memory_used_bytes 1').response);
    const stores = started(URL);

    expect(fetch).not.toHaveBeenCalled();
    await expect(stores.keycloak?.metrics()).resolves.toBe(
      'jvm_memory_used_bytes 1',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(URL);
    expect(timeout).toHaveBeenCalledWith(5_000);
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBe(timeout.mock.results[0]?.value);
    expect(new Headers(init.headers).get('accept')).toBe('text/plain');
  });

  it('fails an answer that is not 2xx with its status only, and lets its body go', async () => {
    const { cancel, response } = answer(503, '<html>down</html>');
    fetch.mockResolvedValue(response);
    const stores = started(URL);

    await expect(stores.keycloak?.metrics()).rejects.toThrow(
      new Error('HTTP 503'),
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('fails an address that does not answer with the error code only, never the address', async () => {
    fetch.mockRejectedValue(
      Object.assign(new TypeError(`fetch failed for ${URL}`), {
        cause: Object.assign(new Error(`connect ECONNREFUSED ${URL}`), {
          code: 'ECONNREFUSED',
        }),
      }),
    );
    const stores = started(URL);

    const error = await stores.keycloak?.metrics().catch((e: Error) => e);
    expect(error).toEqual(new Error('ECONNREFUSED'));
    expect((error as Error).message).not.toContain('railway');
  });

  it('fails a reading cut off by its limit with the error name only', async () => {
    fetch.mockRejectedValue(
      Object.assign(new Error(`aborted ${URL}`), { name: 'TimeoutError' }),
    );
    const stores = started(URL);

    await expect(stores.keycloak?.metrics()).rejects.toThrow(
      new Error('TimeoutError'),
    );
  });

  it('fails the boot on a malformed address, before any reading', () => {
    expect(() => started('not a url')).toThrow('Invalid URL');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('cuts off a body past 8 MiB that declares no length', async () => {
    const { response } = answer(200, 'x'.repeat(8 * 1024 * 1024 + 1));
    fetch.mockResolvedValue(response);
    const stores = started(URL);

    await expect(stores.keycloak?.metrics()).rejects.toThrow(
      new Error('metrics body too large'),
    );
  });

  it('reads a body of exactly 8 MiB', async () => {
    const body = 'x'.repeat(8 * 1024 * 1024);
    fetch.mockResolvedValue(answer(200, body).response);

    await expect(started(URL).keycloak?.metrics()).resolves.toBe(body);
  });

  it.each(['redis://keycloak:6379', 'ftp://keycloak/metrics'])(
    'fails the boot on the non-HTTP address %s',
    (url) => {
      expect(() => started(url)).toThrow(
        'KEYCLOAK_METRICS_URL is not an http(s) address',
      );
    },
  );
});
