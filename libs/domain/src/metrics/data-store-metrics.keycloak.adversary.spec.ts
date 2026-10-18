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
const URL = 'http://user:hunter2@keycloak.railway.internal:9000/metrics';
type Stores = Parameters<typeof observeDataStores>[0];

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
// An answer whose body streams the text, or fails midway with the error.
const response = (status: number, body: string | Error) =>
  ({
    body:
      typeof body === 'string'
        ? new Blob([body]).stream()
        : new ReadableStream({ start: (stream) => stream.error(body) }),
    headers: new Headers(),
    ok: status >= 200 && status < 300,
    status,
  }) as unknown as Response;

let fetch: jest.SpyInstance;
beforeEach(() => {
  observe.mockClear();
  fetch = jest.spyOn(globalThis, 'fetch');
});
afterEach(() => jest.restoreAllMocks());

// @traces 1178-FR-007
describe('the Keycloak fetch under hostile answers', () => {
  it.each([199, 300, 301, 404, 500])(
    'rejects HTTP %s with its status only',
    async (status) => {
      fetch.mockResolvedValue(response(status, 'body'));
      await expect(started(URL).keycloak?.metrics()).rejects.toThrow(
        new Error(`HTTP ${status}`),
      );
    },
  );

  it('accepts a 204 and hands the empty body on', async () => {
    fetch.mockResolvedValue(response(204, ''));
    await expect(started(URL).keycloak?.metrics()).resolves.toBe('');
  });

  it('does not carry the address when the body stream fails midway', async () => {
    fetch.mockResolvedValue(
      response(200, new Error(`terminated reading ${URL}`)),
    );
    const error = await started(URL)
      .keycloak?.metrics()
      .catch((e: Error) => e);
    expect(error).toEqual(new Error('Error'));
  });

  it('fails with a non-empty reason when fetch rejects with a non-Error', async () => {
    fetch.mockRejectedValue('boom');
    const error = await started(URL)
      .keycloak?.metrics()
      .catch((e: Error) => e);
    expect(error).toEqual(new Error('fetch failed'));
  });

  it('fails with a non-empty reason when fetch rejects with null', async () => {
    fetch.mockRejectedValue(null);
    const error = await started(URL)
      .keycloak?.metrics()
      .catch((e: Error) => e);
    expect(error).toEqual(new Error('fetch failed'));
  });

  it('sends no credentials header of its own', async () => {
    fetch.mockResolvedValue(response(200, 'x'));
    await started(URL).keycloak?.metrics();
    const headers = new Headers(
      (fetch.mock.calls[0]?.[1] as RequestInit | undefined)?.headers,
    );
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('cookie')).toBeNull();
  });
});
