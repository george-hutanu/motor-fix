import { startTelemetry } from './start';
import { inMemory } from '../testing/in-memory';
import { addedListeners, aloneOn, type StopSignal } from '../testing/signals';

const memory = inMemory();
let started: ReturnType<typeof startTelemetry>;
const listeners = addedListeners(() => {
  started = startTelemetry(
    'worker',
    {
      APP_ENV: 'staging',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com/otlp',
    },
    memory,
  );
});
const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);

afterAll(() => {
  kill.mockRestore();
  for (const signal of ['SIGINT', 'SIGTERM'] as StopSignal[]) {
    process.removeListener(signal, listeners[signal]);
  }
});

describe('the telemetry shutdown', () => {
  it('shuts each exporter down once when the signal and a direct call both ask', async () => {
    const shutdowns = [
      jest.spyOn(memory.spanExporter, 'shutdown'),
      jest.spyOn(memory.metricReader, 'shutdown'),
      jest.spyOn(memory.logExporter, 'shutdown'),
    ];
    const restore = aloneOn('SIGTERM', listeners.SIGTERM);

    listeners.SIGTERM('SIGTERM');
    await started?.shutdown();
    restore();

    for (const shutdown of shutdowns) expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('gives every caller the same shutdown to wait on', () => {
    expect(started?.shutdown()).toBe(started?.shutdown());
  });
});
