import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { catchError, throwError } from 'rxjs';

// One structured line per failed request to the admin's accounts routes:
// the route pattern and the status, never the cursor or an account's name.
@Injectable()
export class FailureLog implements NestInterceptor {
  private readonly logger = new Logger('AdminAccounts');

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<Request>();
    const route = `${request.method} ${request.route?.path ?? request.path}`;
    return next.handle().pipe(
      catchError((error: unknown) => {
        const status = error instanceof HttpException ? error.getStatus() : 500;
        this.logger.warn({
          message: 'admin accounts request failed',
          route,
          status,
        });
        return throwError(() => error);
      }),
    );
  }
}
