import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { unproject } from '@motor-fix/contracts/map-view';
import { startTelemetry } from '@motor-fix/observability';
import { inMemory } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import { SpanKind, trace } from '@opentelemetry/api';
import type { DataPoint, Histogram } from '@opentelemetry/sdk-metrics';

import { recordRender } from './static-map.metrics';
import { StaticMapRenderer } from './static-map.renderer';

const memory = inMemory();
const started = startTelemetry(
  'api',
  { APP_ENV: 'staging', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);

const FIXTURE = readFileSync(join(__dirname, 'fixture-tile.pbf'));
const TILEJSON = 'https://tiles.test/planet';
const centre = unproject({ x: 9380.5 * 512, y: 6022.5 * 512 }, 14);
const VIEW = { ...centre, h: 480, theme: 'light' as const, w: 640, z: 14 };

const fetchWith = (tile: () => Promise<Response>) =>
  jest.fn(async (input: string | URL | Request) =>
    String(input) === TILEJSON
      ? Response.json({ tiles: ['https://tiles.test/{z}/{x}/{y}.pbf'] })
      : tile(),
  ) as unknown as typeof fetch;

// The render runs inside the request's span; the sampler drops a span
// nothing started.
const inRequest = <T>(work: () => Promise<T>) =>
  trace
    .getTracer('spec')
    .startActiveSpan(
      'GET /api/v1/maps/static',
      { kind: SpanKind.SERVER },
      (span) => work().finally(() => span.end()),
    );

async function points(name: string) {
  const { resourceMetrics } = await memory.metricReader.collect();
  return resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .filter((metric) => metric.descriptor.name === name)
    .flatMap((metric) => metric.dataPoints as DataPoint<unknown>[]);
}

afterAll(() => started?.shutdown());
beforeEach(async () => {
  await started?.flush();
  memory.spanExporter.reset();
  jest.restoreAllMocks();
});

// @traces 1196-FR-009 1196-FR-020
describe('counting the static map renders', () => {
  it('counts each answer by outcome and times the renders', async () => {
    recordRender('ok', 0.4);
    recordRender('ok', 0.8);
    recordRender('tiles_failed', 2.1);
    recordRender('invalid');

    const counted = Object.fromEntries(
      (await points('motorfix_static_map_renders_total')).map((point) => [
        point.attributes['outcome'],
        point.value,
      ]),
    );
    expect(counted).toEqual({ invalid: 1, ok: 2, tiles_failed: 1 });
    const [timed] = await points('motorfix_static_map_render_duration_seconds');
    const histogram = timed.value as Histogram;
    expect(histogram.count).toBe(3);
    expect(histogram.buckets.boundaries).toEqual([0.25, 0.5, 1, 2, 3, 5]);
  });

  it('spans the render with one child per tile fetched', async () => {
    const renderer = new StaticMapRenderer(TILEJSON, {
      fetch: fetchWith(async () => new Response(FIXTURE)),
    });

    await inRequest(() => renderer.render(VIEW));
    await started?.flush();

    const spans = memory.spanExporter.getFinishedSpans();
    const render = spans.find((span) => span.name === 'static-map.render');
    const tiles = spans.filter((span) => span.name === 'static-map.tile');
    expect(render?.attributes).toMatchObject({
      'map.height': 480,
      'map.theme': 'light',
      'map.tiles': 3,
      'map.width': 640,
      'map.zoom': 14,
    });
    expect(tiles).toHaveLength(3);
    for (const tile of tiles) {
      expect(tile.parentSpanContext?.spanId).toBe(render?.spanContext().spanId);
    }
    expect(JSON.stringify(spans.map((span) => span.attributes))).not.toContain(
      String(centre.lat).slice(0, 6),
    );
  });

  it('logs one warning per failed render with its zoom, theme and outcome, never where', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const renderer = new StaticMapRenderer(TILEJSON, {
      fetch: fetchWith(async () => new Response('busy', { status: 503 })),
    });

    await expect(inRequest(() => renderer.render(VIEW))).rejects.toThrow();

    expect(warn).toHaveBeenCalledTimes(1);
    expect((warn.mock.contexts[0] as { context?: string }).context).toBe(
      'StaticMapRender',
    );
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain('zoom=14');
    expect(line).toContain('theme=light');
    expect(line).toContain('outcome=tiles_failed');
    expect(line).not.toContain(String(centre.lat).slice(0, 6));
    expect(line).not.toContain(String(centre.lng).slice(0, 6));
  });
});
