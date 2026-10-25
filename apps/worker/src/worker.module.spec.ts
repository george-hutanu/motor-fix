import {
  BOOKING_TIMERS_CONSUMER,
  OutboxRelayModule,
  QUOTE_ACCEPTED_CONSUMER,
  QUOTE_LOST_CONSUMER,
  QUOTE_RECEIVED_CONSUMER,
  REQUEST_RECEIVED_CONSUMER,
  REQUEST_TIMERS_CONSUMER,
} from '@motor-fix/domain';

import { workerModule } from './worker.module';

type Consumer = { kinds: readonly string[]; queue: string };

// The consumers the worker hands the outbox relay, read without starting it.
function consumers(): Consumer[] {
  const register = jest.spyOn(OutboxRelayModule, 'register');
  workerModule({
    APP_ENV: 'test',
    DATABASE_URL: 'postgresql://motorfix@127.0.0.1:9/motorfix',
    REDIS_URL: 'redis://127.0.0.1:9',
  } as Parameters<typeof workerModule>[0]);
  const [options] = register.mock.calls[0] as unknown as [
    { consumers: Consumer[] },
  ];
  register.mockRestore();
  return options.consumers;
}

// @traces 223-FR-007
describe('the outbox consumers of the worker', () => {
  // The request timers (ST-1257) follow each of them too; they send nothing.
  it.each([
    ['request.created', [REQUEST_RECEIVED_CONSUMER, REQUEST_TIMERS_CONSUMER]],
    ['quote.sent', [QUOTE_RECEIVED_CONSUMER, REQUEST_TIMERS_CONSUMER]],
    [
      'quote.accepted',
      [
        BOOKING_TIMERS_CONSUMER,
        QUOTE_ACCEPTED_CONSUMER,
        REQUEST_TIMERS_CONSUMER,
      ],
    ],
    ['quote.closed', [QUOTE_LOST_CONSUMER, REQUEST_TIMERS_CONSUMER]],
  ])('hands %s to one notifications fan-out', (kind, expected) => {
    const taking = consumers().filter((c) => c.kinds.includes(kind));
    expect(taking.map((c) => c.queue).sort()).toEqual(
      expected.map((c: Consumer) => c.queue).sort(),
    );
  });
});
