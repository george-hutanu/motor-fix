import { type Context, SpanKind, TraceFlags, trace } from '@opentelemetry/api';
import type { Sampler } from '@opentelemetry/sdk-trace-node';

// A trace starts only where work starts: a request (server), a job
// (consumer) or a queued message (producer), sampled by the ratio. Spans no
// request or job started (queue polling, background queries) are dropped.
// A caller's trace context is continued but sampled by our own ratio; a job
// carries its request's decision through our queue; child spans follow
// their parent.
export function sampler(ratio: number): Sampler {
  const { SamplingDecision, TraceIdRatioBasedSampler } =
    require('@opentelemetry/sdk-trace-node') as typeof import('@opentelemetry/sdk-trace-node');
  const byRatio = new TraceIdRatioBasedSampler(ratio);
  const decided = (sampled: boolean) => ({
    decision: sampled
      ? SamplingDecision.RECORD_AND_SAMPLED
      : SamplingDecision.NOT_RECORD,
  });
  return {
    shouldSample(
      context: Context,
      traceId: string,
      _name: string,
      kind: SpanKind,
    ) {
      const parent = trace.getSpanContext(context);
      const sampledParent =
        parent !== undefined &&
        (parent.traceFlags & TraceFlags.SAMPLED) === TraceFlags.SAMPLED;
      if (parent && (!parent.isRemote || kind === SpanKind.CONSUMER)) {
        return decided(sampledParent);
      }
      if (!parent && (kind === SpanKind.INTERNAL || kind === SpanKind.CLIENT)) {
        return decided(false);
      }
      return byRatio.shouldSample(context, traceId);
    },
    toString: () => `MotorFixSampler{${ratio}}`,
  };
}
