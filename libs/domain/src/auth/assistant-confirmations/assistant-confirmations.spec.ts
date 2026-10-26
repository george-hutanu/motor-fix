import { startTelemetry } from '@motor-fix/observability';
import { inMemory } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import { SpanKind, trace } from '@opentelemetry/api';
import type { DataPoint } from '@opentelemetry/sdk-metrics';

import { judge } from './assistant-confirmations';
import { recordConfirmation } from './assistant-confirmations.metrics';

const memory = inMemory();
const started = startTelemetry(
  'mcp',
  { APP_ENV: 'staging', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);

afterAll(() => started?.shutdown());
beforeEach(async () => {
  await started?.flush();
  memory.spanExporter.reset();
  jest.restoreAllMocks();
});

const NOW = new Date('2026-10-26T12:00:00.000Z');
const HASH = 'a'.repeat(64);
const asked = { argsHash: HASH, confirmed: true, grantId: 'grant-1' };
const stored = (
  shape: Partial<NonNullable<Parameters<typeof judge>[0]>> = {},
) => ({
  argsHash: HASH,
  expiresAt: new Date(NOW.getTime() + 60_000),
  grantId: 'grant-1',
  outcome: null,
  status: 'waiting' as const,
  ...shape,
});

// @traces 1253-assistant-confirm-FR-004 1253-assistant-confirm-FR-005 1253-assistant-confirm-FR-006
describe('judging a confirmation', () => {
  it('runs a timely yes with the same arguments, up to the expiry itself', () => {
    expect(judge(stored(), asked, NOW)).toEqual({ kind: 'run' });
    expect(judge(stored({ expiresAt: NOW }), asked, NOW)).toEqual({
      kind: 'run',
    });
  });

  it('answers not_found for no row or another grant’s', () => {
    expect(judge(null, asked, NOW)).toEqual({
      decision: { status: 'not_found' },
      kind: 'answer',
    });
    expect(judge(stored({ grantId: 'grant-2' }), asked, NOW)).toEqual({
      decision: { status: 'not_found' },
      kind: 'answer',
    });
  });

  it('closes a late answer as expired, before judging a no or the arguments', () => {
    const late = stored({ expiresAt: new Date(NOW.getTime() - 1) });

    for (const answer of [
      asked,
      { ...asked, confirmed: false },
      { ...asked, argsHash: 'b'.repeat(64) },
    ]) {
      expect(judge(late, answer, NOW)).toEqual({
        decision: { status: 'expired' },
        kind: 'close',
        status: 'expired',
      });
    }
  });

  it('closes a no as refused', () => {
    expect(judge(stored(), { ...asked, confirmed: false }, NOW)).toEqual({
      decision: { status: 'refused' },
      kind: 'close',
      status: 'refused',
    });
  });

  it('voids a yes whose arguments changed, marking the mismatch', () => {
    expect(
      judge(stored(), { ...asked, argsHash: 'b'.repeat(64) }, NOW),
    ).toEqual({
      decision: { mismatch: true, status: 'void' },
      kind: 'close',
      status: 'void',
    });
  });

  it('replays a done or failed row whatever is asked', () => {
    const answer = { ...asked, argsHash: 'c'.repeat(64), confirmed: false };
    const late = new Date(NOW.getTime() - 60_000);

    expect(
      judge(
        stored({
          expiresAt: late,
          outcome: { output: { status: 'declined' } },
          status: 'done',
        }),
        answer,
        NOW,
      ),
    ).toEqual({
      decision: {
        output: { status: 'declined' },
        replayed: true,
        status: 'done',
      },
      kind: 'answer',
    });
    expect(
      judge(
        stored({
          expiresAt: late,
          outcome: { code: 'already_answered' },
          status: 'failed',
        }),
        answer,
        NOW,
      ),
    ).toEqual({
      decision: { code: 'already_answered', replayed: true, status: 'failed' },
      kind: 'answer',
    });
  });

  it.each(['refused', 'expired', 'void'] as const)(
    'answers a closed %s row as it was closed',
    (status) => {
      expect(judge(stored({ status }), asked, NOW)).toEqual({
        decision: { status },
        kind: 'answer',
      });
    },
  );
});

// @traces 1253-assistant-confirm-FR-010
describe('counting the confirmations', () => {
  const who = {
    confirmationId: '0b5c1f0e-5a1b-4c6e-9f43-0d7a2b8e4c11',
    grantId: 'grant-1',
    tool: 'decline_quote_request',
  };

  async function counted() {
    const { resourceMetrics } = await memory.metricReader.collect();
    return resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .filter(
        (metric) =>
          metric.descriptor.name === 'motorfix_assistant_confirmations_total',
      )
      .flatMap((metric) => metric.dataPoints as DataPoint<number>[])
      .map((point) => ({ attributes: point.attributes, value: point.value }));
  }

  it('counts each outcome by tool and outcome, never who', async () => {
    const before = await counted();
    const of = (outcome: string, points: typeof before) =>
      points.find((p) => p.attributes['outcome'] === outcome)?.value ?? 0;

    recordConfirmation('opened', who);
    recordConfirmation('confirmed', who);
    recordConfirmation('mismatch', who);

    const after = await counted();
    expect(of('opened', after) - of('opened', before)).toBe(1);
    expect(of('confirmed', after) - of('confirmed', before)).toBe(1);
    expect(of('mismatch', after) - of('mismatch', before)).toBe(1);
    for (const point of after) {
      expect(Object.keys(point.attributes).sort()).toEqual(['outcome', 'tool']);
      expect(point.attributes['tool']).toBe('decline_quote_request');
    }
  });

  it('logs the outcome with the confirmation, tool and grant, and nothing else', () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    recordConfirmation('refused', who);

    expect(log).toHaveBeenCalledWith({ ...who, outcome: 'refused' });
  });

  it('marks the outcome on the call’s span', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();

    trace
      .getTracer('spec')
      .startActiveSpan('POST /mcp', { kind: SpanKind.SERVER }, (span) => {
        recordConfirmation('expired', who);
        span.end();
      });
    await started?.flush();

    const [span] = memory.spanExporter.getFinishedSpans();
    expect(span?.attributes['motorfix.confirmation.outcome']).toBe('expired');
  });
});
