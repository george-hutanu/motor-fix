import type { Attributes, Context } from '@opentelemetry/api';
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-node';

import { scrub, scrubDeep } from './scrub';

// Statement texts and query strings can hold any value a person typed.
const DROPPED = ['db.query.text', 'db.statement', 'url.query'];

function clean(attributes: Attributes): Attributes {
  const kept = Object.fromEntries(
    Object.entries(attributes).filter(([key]) => !DROPPED.includes(key)),
  );
  const full = kept['url.full'];
  if (typeof full === 'string') kept['url.full'] = full.split('?', 1)[0];
  return scrubDeep(kept);
}

// Masks personal values on every finished span before the next processor
// exports it, and names the database host on Prisma's query spans. The span
// is wrapped, not changed, so nothing the application holds is touched.
export class ScrubSpanProcessor implements SpanProcessor {
  constructor(
    private readonly next: SpanProcessor,
    private readonly databaseHost?: string,
  ) {}

  onStart(span: Span, parentContext: Context): void {
    this.next.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    const attributes = clean(span.attributes);
    if (this.databaseHost && span.name === 'prisma:client:db_query') {
      attributes['server.address'] = this.databaseHost;
    }
    const status = span.status.message
      ? { ...span.status, message: scrub(span.status.message) }
      : span.status;
    this.next.onEnd(
      Object.create(span, {
        attributes: { value: attributes },
        events: {
          value: span.events.map((event) => ({
            ...event,
            ...(event.attributes && { attributes: clean(event.attributes) }),
          })),
        },
        name: { value: scrub(span.name) },
        status: { value: status },
      }) as ReadableSpan,
    );
  }

  forceFlush(): Promise<void> {
    return this.next.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.next.shutdown();
  }
}
