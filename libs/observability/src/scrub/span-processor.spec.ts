import { SpanStatusCode } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';

import { ScrubSpanProcessor } from './span-processor';

const exporter = new InMemorySpanExporter();
const tracer = new BasicTracerProvider({
  spanProcessors: [
    new ScrubSpanProcessor(new SimpleSpanProcessor(exporter), 'db.internal'),
  ],
}).getTracer('spec');

function exported() {
  const spans = exporter.getFinishedSpans();
  return spans[spans.length - 1]!;
}

afterEach(() => exporter.reset());

// @traces 876-FR-012
describe('ScrubSpanProcessor', () => {
  it('drops statement texts and query strings and cuts the full URL at the query', () => {
    const span = tracer.startSpan('GET', {
      attributes: {
        'db.query.text': 'select * from "User" where email = $1',
        'db.statement': 'get session:abc',
        'url.full': 'https://api.example.com/v3/send?key=secret',
        'url.query': 'key=secret',
      },
    });
    span.end();

    expect(exported().attributes).toEqual({
      'url.full': 'https://api.example.com/v3/send',
    });
  });

  // @traces 243-FR-015
  it("drops the client's address and browser description from spans and events", () => {
    const client = {
      'client.address': '203.0.113.7',
      'http.client_ip': '203.0.113.7',
      'http.user_agent': 'Mozilla/5.0 Chrome/126.0',
      'net.peer.ip': '203.0.113.7',
      'net.peer.port': 51234,
      'net.sock.peer.addr': '203.0.113.7',
      'net.sock.peer.port': 51234,
      'network.peer.address': '203.0.113.7',
      'network.peer.port': 51234,
      'user_agent.original': 'Mozilla/5.0 Chrome/126.0',
    };
    const span = tracer.startSpan('POST', {
      attributes: { ...client, 'http.request.method': 'POST' },
    });
    span.addEvent('received', client);
    span.end();

    expect(exported().attributes).toEqual({ 'http.request.method': 'POST' });
    expect(exported().events[0]!.attributes).toEqual({});
  });

  it('masks personal values in the name, attributes, events and status message', () => {
    const span = tracer.startSpan('notify ana@example.ro', {
      attributes: { count: 2, 'job.data': 'to 0722 123 456' },
    });
    span.recordException(new Error('no garage for B 123 ABC'));
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'bad x@y.ro' });
    span.end();

    const span2 = exported();
    expect(span2.name).toBe('notify ***');
    expect(span2.attributes).toEqual({ count: 2, 'job.data': 'to ***' });
    expect(span2.events[0]!.attributes!['exception.message']).toBe(
      'no garage for ***',
    );
    expect(span2.events[0]!.attributes!['exception.stacktrace']).toContain(
      'no garage for ***',
    );
    expect(span2.status.message).toBe('bad ***');
  });

  it("does not change the application's own error", () => {
    const error = new Error('no garage for B 123 ABC');
    const span = tracer.startSpan('job');
    span.recordException(error);
    span.end();

    expect(error.message).toBe('no garage for B 123 ABC');
    expect(error.stack).toContain('B 123 ABC');
  });

  it('names the database host on Prisma spans', () => {
    tracer.startSpan('prisma:client:db_query').end();
    expect(exported().attributes['server.address']).toBe('db.internal');

    tracer.startSpan('GET').end();
    expect(exported().attributes['server.address']).toBeUndefined();
  });
});
