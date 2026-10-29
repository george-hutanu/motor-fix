import { startTelemetry } from '@motor-fix/observability';
import { inMemory } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import { SpanKind, trace } from '@opentelemetry/api';
import type { DataPoint } from '@opentelemetry/sdk-metrics';

import {
  AssistantApprovals,
  expireAssistantApprovals,
} from './assistant-approvals';
import { recordApproval } from './assistant-approvals.metrics';

const memory = inMemory();
const started = startTelemetry(
  'api',
  { APP_ENV: 'staging', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);

afterAll(() => started?.shutdown());
beforeEach(async () => {
  await started?.flush();
  memory.spanExporter.reset();
  jest.restoreAllMocks();
});

const approval = {
  accountId: '6c0c6f5e-1d2b-4b8e-9a0f-3f1e2d4c5b6a',
  grantId: 'grant-1',
  id: '0b5c1f0e-5a1b-4c6e-9f43-0d7a2b8e4c11',
  kind: 'book' as const,
  tool: 'book_fixture',
};
// What a locked row also carries, none of which may reach a log line.
const locked = {
  ...approval,
  arguments: { phone: '+40722123456', plate: 'B 123 ABC' },
  editable: ['shareHistory'],
  expiresAt: new Date('2026-10-29T18:30:00.000Z'),
  summary: 'Programare la Service Ion, B 123 ABC, 0722 123 456',
};

async function counted() {
  const { resourceMetrics } = await memory.metricReader.collect();
  return resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .filter(
      (metric) =>
        metric.descriptor.name === 'motorfix_assistant_approvals_total',
    )
    .flatMap((metric) => metric.dataPoints as DataPoint<number>[])
    .map((point) => ({ attributes: point.attributes, value: point.value }));
}

async function countOf(attributes: Record<string, string>) {
  const points = await counted();
  const key = JSON.stringify(Object.entries(attributes).sort());
  return (
    points.find(
      (p) => JSON.stringify(Object.entries(p.attributes).sort()) === key,
    )?.value ?? 0
  );
}

async function delta(
  attributes: Record<string, string>,
  act: () => unknown,
): Promise<number> {
  const before = await countOf(attributes);
  await act();
  return (await countOf(attributes)) - before;
}

// @traces 1254-FR-011
describe('counting the approvals', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  it('counts each outcome by kind and outcome, never who', async () => {
    for (const outcome of [
      'requested',
      'approved',
      'refused',
      'expired',
      'failed',
    ] as const)
      expect(
        await delta({ kind: 'book', outcome }, () =>
          recordApproval(outcome, approval),
        ),
      ).toBe(1);
    for (const point of await counted())
      for (const key of Object.keys(point.attributes))
        expect(['kind', 'outcome', 'sweep']).toContain(key);
  });

  it('marks an approval the sweep expired, the lost-timer signal', async () => {
    expect(
      await delta({ kind: 'book', outcome: 'expired', sweep: 'true' }, () =>
        recordApproval('expired', approval, true),
      ),
    ).toBe(1);
  });

  it('logs the outcome with the approval, tool, grant and account, never the summary or the arguments', () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    recordApproval('failed', locked);

    expect(log).toHaveBeenCalledWith({
      accountId: approval.accountId,
      approvalId: approval.id,
      grantId: approval.grantId,
      kind: 'book',
      outcome: 'failed',
      tool: 'book_fixture',
    });
    const line = JSON.stringify(log.mock.calls);
    for (const secret of ['Service Ion', 'B 123 ABC', '+40722123456', '0722'])
      expect(line).not.toContain(secret);
  });

  it('marks the outcome on the call’s span', async () => {
    trace
      .getTracer('spec')
      .startActiveSpan('POST /approve', { kind: SpanKind.SERVER }, (span) => {
        recordApproval('approved', approval);
        span.end();
      });
    await started?.flush();

    const [span] = memory.spanExporter.getFinishedSpans();
    expect(span?.attributes['motorfix.approval.outcome']).toBe('approved');
  });
});

// @traces 1254-FR-011
describe('every outcome of the store is counted', () => {
  const events = { record: jest.fn(async () => undefined) };
  const audit = { record: jest.fn(async () => undefined) };
  const store = (prisma: unknown = {}) =>
    new AssistantApprovals(prisma as never, audit as never, events as never);

  it('counts the request when the yes opens one', async () => {
    const tx = {
      assistantApproval: {
        create: jest.fn(async () => ({
          expiresAt: new Date(),
          id: approval.id,
        })),
      },
    };
    expect(
      await delta({ kind: 'book', outcome: 'requested' }, () =>
        store().open(tx as never, {
          accountId: approval.accountId,
          args: locked.arguments,
          editable: [],
          grantId: approval.grantId,
          kind: 'book',
          summary: locked.summary,
          tool: approval.tool,
        }),
      ),
    ).toBe(1);
  });

  it('counts a decision only when its write decided the approval', async () => {
    const tx = (count: number) => ({
      assistantApproval: { updateMany: jest.fn(async () => ({ count })) },
    });
    for (const status of ['approved', 'failed', 'refused', 'expired'] as const)
      expect(
        await delta({ kind: 'book', outcome: status }, () =>
          store().close(tx(1) as never, locked, status, null),
        ),
      ).toBe(1);
    expect(
      await delta({ kind: 'book', outcome: 'approved' }, () =>
        store().close(tx(0) as never, locked, 'approved', null),
      ),
    ).toBe(0);
  });

  it('counts the timer’s expiry, and the sweep’s apart', async () => {
    const prisma = (rows: unknown[]) => ({
      $transaction: (fn: (tx: unknown) => unknown) =>
        fn({
          assistantApproval: { updateManyAndReturn: jest.fn(async () => rows) },
        }),
    });
    expect(
      await delta({ kind: 'book', outcome: 'expired' }, () =>
        store(prisma([approval])).expireOverdue(approval.id),
      ),
    ).toBe(1);
    expect(
      await delta({ kind: 'book', outcome: 'expired', sweep: 'true' }, () =>
        store(prisma([approval])).expireOverdue(approval.id, new Date(), true),
      ),
    ).toBe(1);
    expect(
      await delta({ kind: 'book', outcome: 'expired' }, () =>
        store(prisma([])).expireOverdue(approval.id),
      ),
    ).toBe(0);
  });

  it('counts each approval a revoke or the switch turned off expires', async () => {
    const tx = {
      assistantApproval: {
        updateManyAndReturn: jest.fn(async () => [
          approval,
          { ...approval, id: 'other', kind: 'move' },
        ]),
      },
    };
    const book = { kind: 'book', outcome: 'expired' };
    const move = { kind: 'move', outcome: 'expired' };
    const before = [await countOf(book), await countOf(move)];
    await expireAssistantApprovals(
      tx as never,
      { grantIds: [approval.grantId] },
      events as never,
    );
    expect([await countOf(book), await countOf(move)]).toEqual([
      before[0] + 1,
      before[1] + 1,
    ]);
  });
});
