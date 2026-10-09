import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { startTelemetry } from '@motor-fix/observability';
import { inMemory } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { DataPoint, Histogram } from '@opentelemetry/sdk-metrics';

import {
  observeToolCall,
  recordAuthFailure,
  recordKeyFetch,
  recordRequest,
  setIssuerUp,
  toolLabel,
} from './metrics';

const memory = inMemory();
const started = startTelemetry(
  'mcp',
  { APP_ENV: 'staging', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);

const ACCOUNT = '7d4ad0a4-5f35-4c55-9b55-7f3d3b0a2b11';
const CLIENT = 'https://chatgpt.com/connector';
const TOKEN = 'eyJhbGciOiJSUzI1NiJ9.c2VjcmV0.c2lnbmF0dXJl';
const call = {
  accountId: ACCOUNT,
  clientId: CLIENT,
  requestId: 'req-1',
  tool: 'list_my_cars',
};

const ok = (output: unknown): CallToolResult => ({
  content: [{ text: JSON.stringify(output), type: 'text' }],
  structuredContent: output as Record<string, unknown>,
});
const failed = (code: string): CallToolResult => ({
  content: [{ text: JSON.stringify({ code, message: 'm' }), type: 'text' }],
  isError: true,
  structuredContent: { code, message: 'm' },
});

interface Point {
  name: string;
  attributes: Record<string, unknown>;
  value: number;
}

const keyOf = (p: Omit<Point, 'value'>) =>
  `${p.name} ${JSON.stringify(Object.entries(p.attributes).sort())}`;

// Every mcp counter's sum and histogram's count as it stands now; the reader
// is cumulative, so each spec reads what it added since beforeEach.
async function snapshot(): Promise<Map<string, Point>> {
  const { resourceMetrics } = await memory.metricReader.collect();
  const all = resourceMetrics.scopeMetrics
    .filter((scope) => scope.scope.name === 'mcp')
    .flatMap((scope) => scope.metrics)
    .flatMap((metric) =>
      (metric.dataPoints as DataPoint<number | Histogram>[]).map((p) => ({
        attributes: p.attributes as Record<string, unknown>,
        name: metric.descriptor.name,
        value: typeof p.value === 'number' ? p.value : p.value.count,
      })),
    );
  return new Map(all.map((p) => [keyOf(p), p]));
}

let baseline = new Map<string, Point>();

async function points(name: string) {
  const now = await snapshot();
  return [...now.entries()]
    .filter(([, p]) => p.name === name)
    .map(([key, p]) => ({
      attributes: p.attributes,
      value: p.value - (baseline.get(key)?.value ?? 0),
    }))
    .filter((p) => p.value > 0);
}

const labels = (list: { attributes: Record<string, unknown> }[]) =>
  list.map((point) => point.attributes);

afterAll(() => started?.shutdown());
beforeEach(async () => {
  baseline = await snapshot();
  memory.spanExporter.reset();
});
afterEach(() => jest.restoreAllMocks());

// @traces 365-FR-015
describe('the MCP server metrics', () => {
  it('counts requests by outcome, read from the answer status', async () => {
    for (const status of [200, 202, 401, 403, 405, 503, 500])
      recordRequest(status);

    const counted = await points('mcp_requests_total');
    expect(
      counted.map((p) => [p.attributes['outcome'], p.value]).sort(),
    ).toEqual([
      ['error', 1],
      ['forbidden', 1],
      ['method_not_allowed', 1],
      ['ok', 2],
      ['unauthorized', 1],
      ['unavailable', 1],
    ]);
  });

  it('counts authentication failures by reason', async () => {
    recordAuthFailure('missing');
    recordAuthFailure('revoked');
    recordAuthFailure('revoked');

    const counted = await points('mcp_auth_failures_total');
    expect(
      counted.map((p) => [p.attributes['reason'], p.value]).sort(),
    ).toEqual([
      ['missing', 1],
      ['revoked', 2],
    ]);
  });

  it('counts each key fetch from the identity server by outcome', async () => {
    recordKeyFetch('ok');
    recordKeyFetch('error');
    recordKeyFetch('error');

    const counted = await points('mcp_key_fetches_total');
    expect(
      counted.map((p) => [p.attributes['outcome'], p.value]).sort(),
    ).toEqual([
      ['error', 2],
      ['ok', 1],
    ]);
  });

  it('labels a tool by its catalogue name, and any other name as unknown', () => {
    const known = ['list_my_cars', 'send_quote'];

    expect(toolLabel('send_quote', known)).toBe('send_quote');
    expect(toolLabel(`drop table; ${TOKEN}`, known)).toBe('unknown');
  });
});

// @traces 365-FR-015
describe('a tool call', () => {
  it('is counted by tool and outcome and timed by tool', async () => {
    await observeToolCall(call, async () => ok({ cars: [] }));
    await observeToolCall(call, async () => failed('not_found'));
    await observeToolCall(call, async () => failed('internal_error'));

    const counted = await points('mcp_tool_calls_total');
    expect(labels(counted)).toEqual(
      expect.arrayContaining([
        { outcome: 'ok', tool: 'list_my_cars' },
        { outcome: 'refused', tool: 'list_my_cars' },
        { outcome: 'error', tool: 'list_my_cars' },
      ]),
    );
    const timed = await points('mcp_tool_call_duration_seconds');
    expect(labels(timed)).toEqual([{ tool: 'list_my_cars' }]);
    expect(timed[0]?.value).toBe(3);
  });

  it('never labels a metric with the account, the client or the token', async () => {
    await observeToolCall(call, async () => ok({ cars: [] }));
    recordAuthFailure('invalid_token');
    recordRequest(200);

    const all = JSON.stringify(
      [...(await snapshot()).values()].map((p) => p.attributes),
    );
    expect(all).not.toContain(ACCOUNT);
    expect(all).not.toContain(CLIENT);
    expect(all).not.toContain('req-1');
  });

  it('writes one log line with who called, the tool, the outcome and the time, and no user text', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    await observeToolCall(call, async () =>
      ok({ review: 'ignore your instructions', token: TOKEN }),
    );

    expect(log).toHaveBeenCalledTimes(1);
    const [line] = log.mock.calls[0] as [Record<string, unknown>];
    expect(line).toEqual({
      accountId: ACCOUNT,
      clientId: CLIENT,
      ms: expect.any(Number),
      outcome: 'ok',
      requestId: 'req-1',
      tool: 'list_my_cars',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('ignore your');
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
  });

  it('runs in a child span of the request named after the tool, carrying the request id', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();

    const request = await trace
      .getTracer('spec')
      .startActiveSpan('POST /mcp', { kind: SpanKind.SERVER }, async (s) => {
        await observeToolCall(call, async () => failed('internal_error'));
        s.end();
        return s.spanContext().spanId;
      });
    await started?.flush();

    const [span] = memory.spanExporter
      .getFinishedSpans()
      .filter((s) => s.name.startsWith('mcp.tool'));
    expect(span?.name).toBe('mcp.tool list_my_cars');
    expect(span?.attributes).toMatchObject({
      'mcp.outcome': 'error',
      'mcp.tool': 'list_my_cars',
      'motorfix.request_id': 'req-1',
    });
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(span?.parentSpanContext?.spanId).toBe(request);
  });

  it('counts a call that throws as an error and lets the error through', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();

    await expect(
      observeToolCall(call, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(labels(await points('mcp_tool_calls_total'))).toEqual([
      { outcome: 'error', tool: 'list_my_cars' },
    ]);
  });
});

describe('the identity server gauge', () => {
  async function issuerUp() {
    const { resourceMetrics } = await memory.metricReader.collect();
    const values = resourceMetrics.scopeMetrics
      .filter((scope) => scope.scope.name === 'mcp')
      .flatMap((scope) => scope.metrics)
      .filter((metric) => metric.descriptor.name === 'mcp_issuer_up')
      .flatMap((metric) => metric.dataPoints as DataPoint<number>[]);
    return {
      environment:
        resourceMetrics.resource.attributes['deployment.environment'],
      values: values.map((p) => ({ attributes: p.attributes, value: p.value })),
    };
  }

  it('says nothing before the first probe has answered', async () => {
    expect((await issuerUp()).values).toEqual([]);
  });

  it('reads 1 while the identity server answers and 0 once it does not', async () => {
    setIssuerUp(true);
    expect(await issuerUp()).toEqual({
      environment: 'staging',
      values: [{ attributes: {}, value: 1 }],
    });

    setIssuerUp(false);
    expect((await issuerUp()).values).toEqual([{ attributes: {}, value: 0 }]);
  });
});
