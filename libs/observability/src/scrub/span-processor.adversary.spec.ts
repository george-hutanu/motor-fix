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

describe('ScrubSpanProcessor client attributes', () => {
  // @traces 243-FR-015
  it.each([
    'client.address',
    'network.peer.address',
    'user_agent.original',
    'http.client_ip',
    'http.user_agent',
    'net.peer.ip',
    'net.sock.peer.addr',
    'http.request.header.user-agent',
    'http.request.header.x-forwarded-for',
    'http.request.header.forwarded',
    'http.request.header.x-real-ip',
    'http.request.header.cf-connecting-ip',
    'http.request.header.true-client-ip',
  ])('drops %s from a span', (name) => {
    const span = tracer.startSpan('GET', {
      attributes: { [name]: '203.0.113.7', kept: 'yes' },
    });
    span.end();

    expect(exported().attributes).toEqual({ kept: 'yes' });
  });

  // @traces 243-FR-015
  it('drops the attributes given at start, set later and set in bulk', () => {
    const span = tracer.startSpan('GET', {
      attributes: { 'client.address': '203.0.113.7' },
    });
    span.setAttribute('user_agent.original', 'curl/8');
    span.setAttributes({ 'network.peer.address': '::1', ok: true });
    span.end();

    expect(exported().attributes).toEqual({ ok: true });
  });

  // @traces 243-FR-015
  it('exports a span without attributes unchanged', () => {
    tracer.startSpan('bare').end();

    expect(exported().attributes).toEqual({});
    expect(exported().name).toBe('bare');
  });

  // @traces 243-FR-015
  it('drops client attributes of every event, not only the first', () => {
    const span = tracer.startSpan('GET');
    span.addEvent('a', { 'client.address': '1.2.3.4', n: 1 });
    span.addEvent('b', { m: 2, 'user_agent.original': 'x' });
    span.addEvent('c');
    span.end();

    expect(exported().events.map((e) => e.attributes)).toEqual([
      { n: 1 },
      { m: 2 },
      {},
    ]);
  });

  // @traces 243-FR-015
  it('drops client attributes of links', () => {
    const linked = tracer.startSpan('linked');
    const span = tracer.startSpan('GET', {
      links: [
        {
          attributes: { 'client.address': '1.2.3.4', k: 1 },
          context: linked.spanContext(),
        },
      ],
    });
    span.end();
    linked.end();

    const spans = exporter.getFinishedSpans();
    const got = spans.find((s) => s.name === 'GET')!;
    expect(got.links[0]!.attributes).toEqual({ k: 1 });
  });

  // @traces 243-FR-015
  it('is idempotent when the same span shape is exported twice', () => {
    for (let i = 0; i < 2; i++) {
      const span = tracer.startSpan('GET', {
        attributes: { 'client.address': '9.9.9.9', i },
      });
      span.end();
    }

    expect(exporter.getFinishedSpans().map((s) => s.attributes)).toEqual([
      { i: 0 },
      { i: 1 },
    ]);
  });

  // @traces 243-FR-015
  it('does not leak an address through the span name or a url', () => {
    const span = tracer.startSpan('GET', {
      attributes: { 'url.full': 'https://x.ro/a?ip=203.0.113.7' },
    });
    span.end();

    expect(exported().attributes).toEqual({ 'url.full': 'https://x.ro/a' });
  });

  // @traces 243-FR-015
  it('keeps attributes whose names merely contain a dropped word', () => {
    const span = tracer.startSpan('GET', {
      attributes: {
        'app.client.name': 'web',
        'http.response.status_code': 200,
        'user.agent_count': 3,
      },
    });
    span.end();

    expect(exported().attributes).toEqual({
      'app.client.name': 'web',
      'http.response.status_code': 200,
      'user.agent_count': 3,
    });
  });
});
