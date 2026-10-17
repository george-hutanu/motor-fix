import { Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';

import type { PrismaClient } from '../../generated/prisma/client';

// Stored messages whose support e-mail is still to send: pending, or waiting
// for SUPPORT_EMAIL. One blocked by the sending switch or the allowlist is
// not counted.
export const countUnsent = (prisma: PrismaClient): Promise<number> =>
  prisma.supportMessage.count({
    where: { supportEmailStatus: { in: ['pending', 'unconfigured'] } },
  });

// Reads the count every `everyMs` and reports the last reading as
// motorfix_support_messages_unsent; a failed reading keeps the one before.
// Returns the stop function.
export function observeUnsent(
  read: () => Promise<number>,
  everyMs = 60_000,
): () => void {
  const logger = new Logger('Support');
  let value: number | undefined;
  const tick = async () => {
    try {
      value = await read();
    } catch (error) {
      logger.warn(
        `unsent support messages not read: ${(error as Error).message}`,
      );
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), everyMs);
  timer.unref();
  const gauge = metrics
    .getMeter('motorfix')
    .createObservableGauge('motorfix_support_messages_unsent', {
      description: 'Stored support messages whose support e-mail is unsent',
    });
  const report = (result: { observe: (value: number) => void }) => {
    if (value !== undefined) result.observe(value);
  };
  gauge.addCallback(report);
  return () => {
    clearInterval(timer);
    gauge.removeCallback(report);
  };
}
