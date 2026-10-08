import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

// One structured line per failed request to the admin's accounts routes:
// the route and the status, never the cursor or an account's name. A
// middleware rather than an interceptor, so a refusal the guard answers
// before the route runs (401, 403, 404) is logged too. Neither route has a
// path parameter, so the path without its query is the route.
@Injectable()
export class FailureLog implements NestMiddleware {
  private readonly logger = new Logger('AdminAccounts');

  use(req: Request, res: Response, next: NextFunction) {
    res.on('finish', () => {
      if (res.statusCode < 400) return;
      this.logger.warn({
        message: 'admin accounts request failed',
        route: `${req.method} ${req.originalUrl.split('?')[0]}`,
        status: res.statusCode,
      });
    });
    next();
  }
}
