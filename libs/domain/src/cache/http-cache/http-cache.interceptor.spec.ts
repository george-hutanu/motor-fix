import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';

import {
  HttpCacheInterceptor,
  PUBLIC_POLICY,
  PublicCache,
} from './http-cache.interceptor';
import { requestContext } from '../../logging';

class Routes {
  @PublicCache()
  marked() {}

  unmarked() {}
}

function call(
  handler: keyof Routes,
  {
    actor,
    headers = {},
    method = 'GET',
    sent = false,
    fails = false,
  }: {
    actor?: object;
    headers?: Record<string, string>;
    method?: string;
    sent?: boolean;
    fails?: boolean;
  } = {},
) {
  const set: Record<string, string> = { ...headers };
  const res = {
    getHeader: (name: string) => set[name.toLowerCase()],
    headersSent: sent,
    setHeader: (name: string, value: string) => {
      set[name.toLowerCase()] = value;
    },
  };
  const context = {
    getClass: () => Routes,
    getHandler: () => Routes.prototype[handler],
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ actor, method }),
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
  const next: CallHandler = {
    handle: () => (fails ? throwError(() => new Error('refused')) : of('body')),
  };
  const run = lastValueFrom(
    new HttpCacheInterceptor(new Reflector()).intercept(context, next),
  ).catch(() => 'failed');
  return run.then(() => set);
}

// @traces 1182-FR-009 1182-FR-010
describe('the HTTP cache policy', () => {
  it('gives a marked visitor read the public policy', async () => {
    expect(await call('marked')).toEqual({ 'cache-control': PUBLIC_POLICY });
    expect(PUBLIC_POLICY).toBe(
      'public, max-age=60, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400',
    );
  });

  it('names the tags of the cached answer it served', async () => {
    const headers = await requestContext.run(
      { cacheTags: ['garage:a', 'search'] },
      () => call('marked'),
    );

    expect(headers['cache-tag']).toBe('garage:a,search');
  });

  it('gives a read answered with a session private, no-cache', async () => {
    expect(await call('unmarked', { actor: { id: 'a' } })).toEqual({
      'cache-control': 'private, no-cache',
    });
    expect(
      await call('unmarked', { actor: { id: 'a' }, method: 'HEAD' }),
    ).toEqual({
      'cache-control': 'private, no-cache',
    });
  });

  it('leaves an unmarked visitor route, a write, a failure and a set header alone', async () => {
    expect(await call('unmarked')).toEqual({});
    expect(await call('marked', { method: 'POST' })).toEqual({});
    expect(await call('unmarked', { actor: {}, method: 'PATCH' })).toEqual({});
    expect(await call('marked', { fails: true })).toEqual({});
    expect(
      await call('unmarked', {
        actor: {},
        headers: { 'cache-control': 'no-store' },
      }),
    ).toEqual({ 'cache-control': 'no-store' });
    expect(await call('marked', { sent: true })).toEqual({});
  });
});
