import { startTelemetry } from '@motor-fix/observability';
import { counterTotal, inMemory } from '@motor-fix/observability/testing';

import {
  ACCEPT_OUTCOMES,
  recordAccept,
  recordExpiries,
  recordSend,
  recordWhatsApp,
} from './transfers.metrics';

const memory = inMemory();
const started = startTelemetry(
  'api',
  { APP_ENV: 'test', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);
afterAll(() => started?.shutdown());

const total = (name: string, labels?: Record<string, string>) =>
  counterTotal(memory.metricReader, name, labels);

// @traces 415-FR-020
describe('the car transfer counters', () => {
  it.each(['sent', 'open_request'] as const)(
    'counts a send that %s',
    async (outcome) => {
      const name = 'motorfix_car_transfer_sends_total';
      const before = await total(name, { outcome });

      recordSend(outcome);

      expect(await total(name, { outcome })).toBe(before + 1);
    },
  );

  it('counts a link that left on WhatsApp under the kind none', async () => {
    const name = 'motorfix_car_transfer_whatsapp_total';
    const labels = { kind: 'none', outcome: 'sent' };
    const before = await total(name, labels);

    recordWhatsApp(null);

    expect(await total(name, labels)).toBe(before + 1);
  });

  it('counts a link that did not leave under why it failed', async () => {
    const name = 'motorfix_car_transfer_whatsapp_total';
    const labels = { kind: 'timeout', outcome: 'failed' };
    const before = await total(name, labels);

    recordWhatsApp('timeout');

    expect(await total(name, labels)).toBe(before + 1);
  });

  it('adds the day’s expiries, and nothing for a day with none', async () => {
    const name = 'motorfix_car_transfer_expiries_total';
    const before = await total(name);

    recordExpiries(0);
    recordExpiries(3);

    expect(await total(name)).toBe(before + 3);
  });
});

// @traces 1265-FR-015
describe('the car transfer accept counter', () => {
  it('names every outcome: the accept and each refusal', () => {
    expect([...ACCEPT_OUTCOMES].sort()).toEqual(
      [
        'accepted',
        'car_limit',
        'not_found',
        'open_request',
        'own_transfer',
        'transfer_accepted',
        'transfer_cancelled',
        'transfer_expired',
      ].sort(),
    );
  });

  it.each([...ACCEPT_OUTCOMES])(
    'counts an accept answered %s',
    async (outcome) => {
      const name = 'motorfix_car_transfer_accepts_total';
      const before = await total(name, { outcome });

      recordAccept(outcome);

      expect(await total(name, { outcome })).toBe(before + 1);
    },
  );
});
