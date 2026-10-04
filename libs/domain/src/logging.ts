import { AsyncLocalStorage } from 'node:async_hooks';

import { ConsoleLogger, LogLevel } from '@nestjs/common';

export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

export class JsonLogger extends ConsoleLogger {
  constructor() {
    super({ json: true });
  }

  protected override getJsonLogObject(
    message: unknown,
    options: { context: string; logLevel: LogLevel; errorStack?: unknown },
  ) {
    const requestId = requestContext.getStore()?.requestId;
    return {
      ...super.getJsonLogObject(message, options),
      ...(requestId && { requestId }),
    };
  }
}
