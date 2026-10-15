import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { tap } from 'rxjs';

import { requestContext } from '../../logging';

const PUBLIC_CACHE = 'cache:public';

// Browsers keep a visitor answer a minute, shared caches five, and either may
// serve it stale for a day while it refreshes or while the API is down.
export const PUBLIC_POLICY =
  'public, max-age=60, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400';

// A visitor read whose answer depends on its path and query alone.
export const PublicCache = () => SetMetadata(PUBLIC_CACHE, true);

// On a successful read: the public policy and the served answer's tags for a
// marked route, `private, no-cache` for one answered with a session. A header
// the route set itself, a streamed answer and a problem are left as they are.
@Injectable()
export class HttpCacheInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { actor?: unknown }>();
    if (
      context.getType() !== 'http' ||
      (req.method !== 'GET' && req.method !== 'HEAD')
    ) {
      return next.handle();
    }
    const res = http.getResponse<Response>();
    const marked = this.reflector.getAllAndOverride<boolean | undefined>(
      PUBLIC_CACHE,
      [context.getHandler(), context.getClass()],
    );
    return next.handle().pipe(
      tap(() => {
        if (res.headersSent || res.getHeader('Cache-Control') !== undefined) {
          return;
        }
        if (marked) {
          res.setHeader('Cache-Control', PUBLIC_POLICY);
          const tags = requestContext.getStore()?.cacheTags;
          if (tags?.length) res.setHeader('Cache-Tag', tags.join(','));
        } else if (req.actor) {
          res.setHeader('Cache-Control', 'private, no-cache');
        }
      }),
    );
  }
}
