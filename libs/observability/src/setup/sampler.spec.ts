import {
  type Context,
  ROOT_CONTEXT,
  SpanKind,
  TraceFlags,
  trace,
} from '@opentelemetry/api';
import { SamplingDecision } from '@opentelemetry/sdk-trace-node';

import { sampler } from './sampler';

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';

function withParent(isRemote: boolean, sampled: boolean): Context {
  return trace.setSpanContext(ROOT_CONTEXT, {
    isRemote,
    spanId: 'b7ad6b7169203331',
    traceFlags: sampled ? TraceFlags.SAMPLED : TraceFlags.NONE,
    traceId: TRACE_ID,
  });
}

function decide(ratio: number, context: Context, kind: SpanKind) {
  return sampler(ratio).shouldSample(context, TRACE_ID, 'span', kind, {}, [])
    .decision;
}

// @traces 876-FR-013
describe('sampler', () => {
  it.each([SpanKind.SERVER, SpanKind.CONSUMER, SpanKind.PRODUCER])(
    'samples a root span of kind %s by the ratio',
    (kind) => {
      expect(decide(1, ROOT_CONTEXT, kind)).toBe(
        SamplingDecision.RECORD_AND_SAMPLED,
      );
      expect(decide(0, ROOT_CONTEXT, kind)).toBe(SamplingDecision.NOT_RECORD);
    },
  );

  it.each([SpanKind.INTERNAL, SpanKind.CLIENT])(
    'drops a root span of kind %s, which no request or job started',
    (kind) => {
      expect(decide(1, ROOT_CONTEXT, kind)).toBe(SamplingDecision.NOT_RECORD);
    },
  );

  it("samples a caller's remote parent by the ratio, never by its sampled flag", () => {
    expect(decide(0, withParent(true, true), SpanKind.SERVER)).toBe(
      SamplingDecision.NOT_RECORD,
    );
    expect(decide(1, withParent(true, false), SpanKind.SERVER)).toBe(
      SamplingDecision.RECORD_AND_SAMPLED,
    );
  });

  it("samples a job's span by the ratio, never by the flag its carrier brings", () => {
    expect(decide(0, withParent(true, true), SpanKind.CONSUMER)).toBe(
      SamplingDecision.NOT_RECORD,
    );
    expect(decide(1, withParent(true, false), SpanKind.CONSUMER)).toBe(
      SamplingDecision.RECORD_AND_SAMPLED,
    );
  });

  it("follows a local parent's decision", () => {
    expect(decide(0, withParent(false, true), SpanKind.CLIENT)).toBe(
      SamplingDecision.RECORD_AND_SAMPLED,
    );
    expect(decide(1, withParent(false, false), SpanKind.INTERNAL)).toBe(
      SamplingDecision.NOT_RECORD,
    );
  });
});
