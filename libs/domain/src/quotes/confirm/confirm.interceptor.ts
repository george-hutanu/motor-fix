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

function outcomeOf(error: unknown): BookingConfirmOutcome | null {
  if (!(error instanceof HttpException)) return null;
  const { code } = (error.getResponse() ?? {}) as { code?: string };
  if (code && OUTCOMES.has(code)) return code as BookingConfirmOutcome;
  const status = error.getStatus();
  return status >= 400 && status < 500 ? 'refused' : null;
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
          const outcome = outcomeOf(error);
          if (!outcome) return;
          recordBookingConfirm(outcome);
          this.logger.warn(`booking ${booking}: ${outcome}`);
        },
        next: () => {
          recordBookingConfirm('confirmed');
          this.logger.log(`booking ${booking}: confirmed`);
        },
      }),
    );
  }
}
