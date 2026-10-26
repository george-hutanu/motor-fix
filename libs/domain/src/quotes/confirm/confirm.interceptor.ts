import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { type Observable, tap } from 'rxjs';

import {
  BOOKING_CONFIRM_OUTCOMES,
  type BookingConfirmOutcome,
  recordBookingConfirm,
} from '../quotes/quotes.metrics';

// The refusals counted by their own code; any other 4xx is `refused`.
const OUTCOMES = new Set<string>(
  BOOKING_CONFIRM_OUTCOMES.filter(
    (outcome) => outcome !== 'confirmed' && outcome !== 'refused',
  ),
);

// The outcome of a refused confirm, with the reason its problem details name.
function outcomeOf(
  error: unknown,
): { outcome: BookingConfirmOutcome; reason?: string } | null {
  if (!(error instanceof HttpException)) return null;
  const { code, reason } = (error.getResponse() ?? {}) as {
    code?: string;
    reason?: unknown;
  };
  if (code && OUTCOMES.has(code)) {
    return {
      outcome: code as BookingConfirmOutcome,
      reason: typeof reason === 'string' ? reason : undefined,
    };
  }
  const status = error.getStatus();
  return status >= 400 && status < 500 ? { outcome: 'refused' } : null;
}

// Counts and logs every confirm the guards let through, the ones the pipes
// refuse (a bad id or body) included: pipes run inside an interceptor.
@Injectable()
export class ConfirmOutcomes implements NestInterceptor {
  private readonly logger = new Logger('Confirm');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const { params } = context
      .switchToHttp()
      .getRequest<{ params: { id?: string } }>();
    const booking = params.id ?? '';
    return next.handle().pipe(
      tap({
        error: (error: unknown) => {
          const refused = outcomeOf(error);
          if (!refused) return;
          const { outcome, reason } = refused;
          recordBookingConfirm(outcome, reason);
          this.logger.warn(
            `booking ${booking}: ${outcome}${reason ? ` ${reason}` : ''}`,
          );
        },
        next: () => {
          recordBookingConfirm('confirmed');
          this.logger.log(`booking ${booking}: confirmed`);
        },
      }),
    );
  }
}
