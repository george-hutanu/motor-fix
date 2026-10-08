import { context } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { RPCType, setRPCMetadata } from '@opentelemetry/core';

import { routeLabel, setRoute } from './route-label';

beforeAll(() => {
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
});

afterAll(() => context.disable());

function inHttp<T>(fn: (rpc: { type: RPCType; route?: string }) => T): T {
  const rpc = { type: RPCType.HTTP } as { type: RPCType; route?: string };
  return context.with(setRPCMetadata(context.active(), rpc as never), () =>
    fn(rpc),
  );
}

describe('setRoute outside and inside a request', () => {
  it('does nothing when no request is active', () => {
    expect(() => setRoute('/garages/:id')).not.toThrow();
  });

  it('sets the template on the active HTTP request', () => {
    inHttp((rpc) => {
      setRoute('/garages/:id');
      expect(rpc.route).toBe('/garages/:id');
    });
  });

  it('keeps the last template when called twice', () => {
    inHttp((rpc) => {
      setRoute('/a');
      setRoute('/b');
      expect(rpc.route).toBe('/b');
    });
  });

  it('stores an empty template as given without crashing', () => {
    inHttp((rpc) => {
      setRoute('');
      expect(rpc.route).toBe('');
    });
  });

  it('does not touch a non-HTTP rpc', () => {
    const rpc = { type: RPCType.HTTP + 99 } as unknown as {
      type: RPCType;
      route?: string;
    };
    context.with(setRPCMetadata(context.active(), rpc as never), () => {
      setRoute('/x');
    });
    expect(rpc.route).toBeUndefined();
  });
});

describe('routeLabel middleware', () => {
  it('calls next even when no request is active', () => {
    const next = jest.fn();
    routeLabel()({}, { once: jest.fn() }, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('ignores a non-string route path', () => {
    inHttp((rpc) => {
      let finish = () => {};
      routeLabel()(
        { route: { path: /re/ } },
        { once: (_e, l) => (finish = l) },
        () => {},
      );
      finish();
      expect(rpc.route).toBeUndefined();
    });
  });

  it('joins base url and path on finish', () => {
    inHttp((rpc) => {
      let finish = () => {};
      routeLabel()(
        { baseUrl: '/api', route: { path: '/g/:id' } },
        { once: (_e, l) => (finish = l) },
        () => {},
      );
      expect(rpc.route).toBeUndefined();
      finish();
      expect(rpc.route).toBe('/api/g/:id');
    });
  });
});
