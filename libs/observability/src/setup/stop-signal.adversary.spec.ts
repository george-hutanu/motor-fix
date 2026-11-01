import type { MockInstance } from 'vitest';
// @traces 1000-FR-002 1000-FR-003 1000-FR-004

import type { Telemetry } from './start';
import { inMemory } from '../testing/in-memory';
import { addedListeners, type StopSignal } from '../testing/signals';

const signals: StopSignal[] = ['SIGINT', 'SIGTERM'];
const instrumented: { disable(): void }[] = [];
const added: ((signal: StopSignal) => void)[] = [];

async function start() {
  const memory = inMemory();
  let telemetry: Telemetry | undefined;
  vi.resetModules();
  const setup = await import('./start');
  const listeners = addedListeners(() => {
    telemetry = setup.startTelemetry(
      'api',
      {
        APP_ENV: 'staging',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com/otlp',
      },
      memory,
    );
    instrumented.push(...setup.startedInstrumentations());
  });
  added.push(listeners.SIGINT, listeners.SIGTERM);
  return { listeners, memory, telemetry: telemetry as unknown as Telemetry };
}

function listenersSeen(counts: Partial<Record<StopSignal, number>>) {
  const real = process.listenerCount.bind(process);
  return vi.spyOn(process, 'listenerCount').mockImplementation((event) => {
    const count = counts[event as StopSignal];
    return count === undefined ? real(event) : count;
  });
}

let kill: MockInstance;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const instrumentation of instrumented.splice(0)) {
    instrumentation.disable();
  }
  for (const listener of added.splice(0)) {
    for (const signal of signals) process.removeListener(signal, listener);
  }
});

describe('the stop signal at its edges', () => {
  it('detaches the handler at once, before the shutdown has settled', async () => {
    const { listeners } = await start();
    listenersSeen({ SIGTERM: 1 });

    listeners.SIGTERM('SIGTERM');

    expect(process.listeners('SIGTERM')).not.toContain(listeners.SIGTERM);
    expect(kill).not.toHaveBeenCalled();
  });

  it('treats a count of zero as the last listener', async () => {
    const { listeners, telemetry } = await start();
    listenersSeen({ SIGINT: 0 });

    listeners.SIGINT('SIGINT');
    await telemetry.shutdown();

    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGINT');
  });

  it('shuts down once and raises each signal once when the other stop signal arrives during the shutdown', async () => {
    const { listeners, memory, telemetry } = await start();
    const spanShutdown = vi.spyOn(memory.spanExporter, 'shutdown');
    listenersSeen({ SIGINT: 1, SIGTERM: 1 });

    listeners.SIGTERM('SIGTERM');
    listeners.SIGINT('SIGINT');
    await telemetry.shutdown();

    expect(spanShutdown).toHaveBeenCalledTimes(1);
    expect(kill.mock.calls).toEqual(
      expect.arrayContaining([
        [process.pid, 'SIGTERM'],
        [process.pid, 'SIGINT'],
      ]),
    );
    expect(kill).toHaveBeenCalledTimes(2);
  });

  it('raises the signal after the span, metric and log exporters have all failed', async () => {
    const { listeners, memory, telemetry } = await start();
    vi.spyOn(memory.spanExporter, 'shutdown').mockRejectedValue(
      new Error('spans down'),
    );
    vi.spyOn(memory.metricReader, 'shutdown').mockRejectedValue(
      new Error('metrics down'),
    );
    vi.spyOn(memory.logExporter, 'shutdown').mockRejectedValue(
      new Error('logs down'),
    );
    listenersSeen({ SIGTERM: 1 });

    listeners.SIGTERM('SIGTERM');
    await expect(telemetry.shutdown()).resolves.toBeUndefined();

    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
  });

  it('raises the signal after a flush that rejects ahead of the shutdown', async () => {
    const { listeners, memory, telemetry } = await start();
    vi.spyOn(memory.spanExporter, 'export').mockImplementation(() => {
      throw new Error('export blew up');
    });
    listenersSeen({ SIGTERM: 1 });

    listeners.SIGTERM('SIGTERM');
    await telemetry.shutdown();

    expect(kill).toHaveBeenCalledTimes(1);
  });

  it('acts on a later signal once the other listener has gone, after ignoring an earlier one', async () => {
    const { listeners, telemetry } = await start();
    const count = listenersSeen({ SIGTERM: 2 });

    listeners.SIGTERM('SIGTERM');
    const ignored = kill.mock.calls.length;
    expect(process.listeners('SIGTERM')).toContain(listeners.SIGTERM);
    count.mockRestore();
    listenersSeen({ SIGTERM: 1 });
    listeners.SIGTERM('SIGTERM');
    await telemetry.shutdown();

    expect(ignored).toBe(0);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
  });

  it('leaves a listener added during the shutdown registered', async () => {
    const { listeners, telemetry } = await start();
    const late = () => undefined;
    listenersSeen({ SIGTERM: 1 });

    listeners.SIGTERM('SIGTERM');
    process.on('SIGTERM', late);
    await telemetry.shutdown();
    const stillThere = process.listeners('SIGTERM').includes(late);
    process.removeListener('SIGTERM', late);

    expect(stillThere).toBe(true);
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it('keeps the other stop signal untouched when one is handled', async () => {
    const { listeners, telemetry } = await start();
    listenersSeen({ SIGTERM: 1 });

    listeners.SIGTERM('SIGTERM');
    await telemetry.shutdown();

    expect(process.listeners('SIGINT')).toContain(listeners.SIGINT);
    expect(kill).not.toHaveBeenCalledWith(process.pid, 'SIGINT');
  });
});
