import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Logger } from '@nestjs/common';
import {
  type Counter,
  type Histogram,
  metrics,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';

export type AuthFailure =
  | 'missing'
  | 'invalid_token'
  | 'no_account'
  | 'revoked'
  | 'suspended';
type RequestOutcome =
  | 'ok'
  | 'unauthorized'
  | 'forbidden'
  | 'method_not_allowed'
  | 'unavailable'
  | 'error';
type ToolOutcome = 'ok' | 'refused' | 'error';

interface ToolCall {
  accountId: string;
  clientId: string;
  requestId: string;
  tool: string;
}

let instruments:
  | {
      authFailures: Counter;
      duration: Histogram;
      keyFetches: Counter;
      requests: Counter;
      toolCalls: Counter;
    }
  | undefined;

function meter() {
  const mcp = metrics.getMeter('mcp');
  instruments ??= {
    authFailures: mcp.createCounter('mcp_auth_failures_total', {
      description: 'MCP calls refused before the actor exists, by reason',
    }),
    duration: mcp.createHistogram('mcp_tool_call_duration_seconds', {
      advice: { explicitBucketBoundaries: [0.05, 0.1, 0.25, 0.5, 1, 2, 5] },
      description: 'Time a tool call took, by tool',
      unit: 's',
    }),
    keyFetches: mcp.createCounter('mcp_key_fetches_total', {
      description: "Fetches of the identity server's signing keys, by outcome",
    }),
    requests: mcp.createCounter('mcp_requests_total', {
      description: 'Requests to the MCP endpoint, by outcome',
    }),
    toolCalls: mcp.createCounter('mcp_tool_calls_total', {
      description: 'Tool calls, by tool and outcome',
    }),
  };
  return instruments;
}

const OUTCOMES: Record<number, RequestOutcome> = {
  401: 'unauthorized',
  403: 'forbidden',
  405: 'method_not_allowed',
  503: 'unavailable',
};

export function recordRequest(status: number) {
  const outcome = status < 400 ? 'ok' : (OUTCOMES[status] ?? 'error');
  meter().requests.add(1, { outcome });
}

export function recordAuthFailure(reason: AuthFailure) {
  meter().authFailures.add(1, { reason });
}

export function recordKeyFetch(outcome: 'ok' | 'error') {
  meter().keyFetches.add(1, { outcome });
}

// A name the client made up never becomes a label.
export const toolLabel = (name: string, known: readonly string[]) =>
  known.includes(name) ? name : 'unknown';

// What the server could not do, as against what it refused.
const FAILURES = new Set(['internal_error', 'service_unavailable']);

function outcomeOf(result: CallToolResult): ToolOutcome {
  if (!result.isError) return 'ok';
  const code = (result.structuredContent as { code?: unknown } | undefined)
    ?.code;
  return typeof code === 'string' && FAILURES.has(code) ? 'error' : 'refused';
}

const logger = new Logger('McpToolCall');

// One span, one count, one timing and one log line per tool call. The line
// names the caller and the tool, never the arguments or the answer.
export function observeToolCall(
  call: ToolCall,
  run: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  const { duration, toolCalls } = meter();
  const started = performance.now();
  return trace.getTracer('mcp').startActiveSpan(
    `mcp.tool ${call.tool}`,
    {
      attributes: {
        'mcp.tool': call.tool,
        'motorfix.request_id': call.requestId,
      },
    },
    async (span) => {
      let outcome: ToolOutcome = 'error';
      try {
        const result = await run();
        outcome = outcomeOf(result);
        return result;
      } finally {
        const seconds = (performance.now() - started) / 1000;
        toolCalls.add(1, { outcome, tool: call.tool });
        duration.record(seconds, { tool: call.tool });
        span.setAttribute('mcp.outcome', outcome);
        if (outcome === 'error') span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
        logger.log({
          accountId: call.accountId,
          clientId: call.clientId,
          ms: Math.round(seconds * 1000),
          outcome,
          requestId: call.requestId,
          tool: call.tool,
        });
      }
    },
  );
}
