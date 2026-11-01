import { inMemory } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import type { MockInstance } from 'vitest';

import { noShowWorld } from './no-show.testing';
import { quotesApp } from '../quotes-api.testing';

const { metricReader } = inMemory();
metrics.setGlobalMeterProvider(new MeterProvider({ readers: [metricReader] }));

const app = quotesApp();
const { bearer, send, world } = app;
const { prisma } = world;
const { due } = noShowWorld(app);

const counted = async (action: string, outcome: string) => {
  const { resourceMetrics } = await metricReader.collect();
  const metric = resourceMetrics.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find((m) => m.descriptor.name === 'motorfix_no_shows_total');
  const point = (metric?.dataPoints ?? []).find(
    (p) =>
      p.attributes['action'] === action && p.attributes['outcome'] === outcome,
  );
  return Number(point?.value ?? 0);
};

const linesAbout = (spy: MockInstance, id: string) =>
  spy.mock.calls
    .map(([message]) => String(message))
    .filter((m) => m.includes(id));

let log: MockInstance;
let warn: MockInstance;
beforeEach(() => {
  log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

// @traces 1259-FR-012
describe('watching no-shows', () => {
  it('counts a recorded no-show and logs one line without the driver', async () => {
    const { booking, volt } = await due();
    const driver = await prisma.account.findUniqueOrThrow({
      where: { id: booking.driverId },
    });
    const before = await counted('recorded', 'done');

    const res = await send(
      'post',
      `/bookings/${booking.id}/no-show`,
      bearer(volt.owner, 'garage'),
    );

    expect(res.status).toBe(200);
    expect(await counted('recorded', 'done')).toBe(before + 1);
    const lines = linesAbout(log, booking.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(booking.requestId);
    expect(lines[0]).toContain(volt.garage.id);
    expect(lines[0]).toContain('garage');
    expect(lines[0]).not.toContain(driver.name);
    if (driver.phone) expect(lines[0]).not.toContain(driver.phone);
  });

  it('counts a withdrawal', async () => {
    const { booking, volt } = await due();
    const auth = bearer(volt.receptionist, 'receptionist');
    await send('post', `/bookings/${booking.id}/no-show`, auth);
    const before = await counted('withdrawn', 'done');

    const res = await send('delete', `/bookings/${booking.id}/no-show`, auth);

    expect(res.status).toBe(200);
    expect(await counted('withdrawn', 'done')).toBe(before + 1);
    expect(linesAbout(log, booking.id)).toHaveLength(2);
  });

  it('counts a refusal and warns with the booking and the code', async () => {
    const { booking, volt } = await due({ minutes: 10 });
    const before = await counted('recorded', 'refused');

    const res = await send(
      'post',
      `/bookings/${booking.id}/no-show`,
      bearer(volt.owner, 'garage'),
    );

    expect(res.status).toBe(409);
    expect(await counted('recorded', 'refused')).toBe(before + 1);
    const lines = linesAbout(warn, booking.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('invalid_transition');
  });
});
