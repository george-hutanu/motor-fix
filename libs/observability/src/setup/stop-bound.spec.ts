import type { startTelemetry } from './start';
import { inMemory } from '../testing/in-memory';
import {
  addedListeners,
  aloneOn,
  type StopListener,
  type StopSignal,
} from '../testing/signals';

type Exporter = 'hangs' | 'fails' | 'answers';

const added: StopListener[] = [];
// Each isolated start hooks the instrumentations into the worker's shared
// module loader again; unhooked after each test, or later suites overflow.
const instrumented: { disable(): void }[] = [];

// A fresh module per test, so each one starts its own telemetry and its own
// shutdown clock.
function start(exporter: Exporter) {
  const memory = inMemory();
  if (exporter === 'hangs') {
    jest
      .spyOn(memory.spanExporter, 'shutdown')
      .mockReturnValue(new Promise(() => undefined));
  }
  if (exporter === 'fails') {
    jest
      .spyOn(memory.spanExporter, 'shutdown')
      .mockRejectedValue(new Error('collector unreachable'));
  }
  let telemetry: ReturnType<typeof startTelemetry>;
  const listeners = addedListeners(() =>
    jest.isolateModules(() => {
      const setup = require('./start') as typeof import('./start');
      telemetry = setup.startTelemetry(
        'api',
        {
          APP_ENV: 'staging',
          OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com/otlp',
        },
        memory,
      );
      instrumented.push(...setup.startedInstrumentations());
    }),
  );
  added.push(listeners.SIGINT, listeners.SIGTERM);
  return { listeners, telemetry: telemetry! };
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  for (const instrumentation of instrumented.splice(0)) {
    instrumentation.disable();
  }
  for (const listener of added.splice(0)) {
    for (const signal of ['SIGINT', 'SIGTERM'] as StopSignal[]) {
      process.removeListener(signal, listener);
    }
  }
});

describe('the telemetry shutdown against a dead collector', () => {
  it('ends after 5 s, not before, and a later request waits on the same clock', async () => {
    const { telemetry } = start('hangs');
    const first = jest.fn();
    const later = jest.fn();

    void telemetry.shutdown().then(first);
    await jest.advanceTimersByTimeAsync(3_000);
    void telemetry.shutdown().then(later);
    await jest.advanceTimersByTimeAsync(1_999);

    expect(first).not.toHaveBeenCalled();
    expect(later).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);

    expect(first).toHaveBeenCalled();
    expect(later).toHaveBeenCalled();
  });

  it('settles without an error when an exporter fails to shut down', async () => {
    const { telemetry } = start('fails');

    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });

  it('leaves no timer behind once a shutdown has settled', async () => {
    const { telemetry } = start('answers');

    await telemetry.shutdown();

    expect(jest.getTimerCount()).toBe(0);
  });

  it('raises the signal again after 5 s when it is the last listener and the shutdown never settles', async () => {
    const { listeners } = start('hangs');
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    const restore = aloneOn('SIGTERM', listeners.SIGTERM);

    listeners.SIGTERM('SIGTERM');
    await jest.advanceTimersByTimeAsync(4_999);
    const early = kill.mock.calls.length;
    await jest.advanceTimersByTimeAsync(1);
    restore();

    expect(early).toBe(0);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
  });
});
