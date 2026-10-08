import type { startTelemetry } from './start';
import { inMemory } from '../testing/in-memory';
import {
  addedListeners,
  aloneOn,
  type StopListener,
  type StopSignal,
} from '../testing/signals';

type Exporter = 'hangs' | 'slow' | 'fails' | 'answers';

const added: StopListener[] = [];
// Each isolated start hooks the instrumentations into the worker's shared
// module loader again; unhooked after each test, or later suites overflow.
const instrumented: { disable(): void }[] = [];

// A fresh module per test, so each one starts its own telemetry and its own
// shutdown clock.
function start(exporter: Exporter) {
  const memory = inMemory();
  const spanShutdown = jest.spyOn(memory.spanExporter, 'shutdown');
  if (exporter === 'hangs') {
    spanShutdown.mockReturnValue(new Promise(() => undefined));
  }
  if (exporter === 'slow') {
    spanShutdown.mockImplementation(
      () => new Promise<void>((resolve) => setTimeout(resolve, 4_900)),
    );
  }
  if (exporter === 'fails') {
    spanShutdown.mockRejectedValue(new Error('collector unreachable'));
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
  return { listeners, spanShutdown, telemetry: telemetry! };
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

describe('the stop signal at the edges of the bound', () => {
  it('raises the signal again as soon as a slow shutdown settles just before the bound', async () => {
    const { listeners } = start('slow');
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    const restore = aloneOn('SIGTERM', listeners.SIGTERM);

    listeners.SIGTERM('SIGTERM');
    await jest.advanceTimersByTimeAsync(4_899);
    const early = kill.mock.calls.length;
    await jest.advanceTimersByTimeAsync(1);
    const atSettle = kill.mock.calls.length;
    await jest.advanceTimersByTimeAsync(200);
    restore();

    expect(early).toBe(0);
    expect(atSettle).toBe(1);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('raises the signal again when an exporter fails to shut down', async () => {
    const { listeners } = start('fails');
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    const restore = aloneOn('SIGTERM', listeners.SIGTERM);

    listeners.SIGTERM('SIGTERM');
    await jest.advanceTimersByTimeAsync(10);
    restore();

    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
  });

  it('shuts the providers down once when both stop signals arrive', async () => {
    const { listeners, spanShutdown } = start('answers');
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    const restoreTerm = aloneOn('SIGTERM', listeners.SIGTERM);
    const restoreInt = aloneOn('SIGINT', listeners.SIGINT);

    listeners.SIGTERM('SIGTERM');
    listeners.SIGINT('SIGINT');
    await jest.advanceTimersByTimeAsync(10);
    restoreTerm();
    restoreInt();

    expect(spanShutdown).toHaveBeenCalledTimes(1);
    expect(kill.mock.calls[0]).toEqual([process.pid, 'SIGTERM']);
  });

  it('still shuts down on a direct request after a signal another listener handled', async () => {
    const { listeners, telemetry, spanShutdown } = start('answers');
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    const app = () => undefined;
    process.on('SIGTERM', app);

    listeners.SIGTERM('SIGTERM');
    await jest.advanceTimersByTimeAsync(10);
    const afterSignal = spanShutdown.mock.calls.length;
    await telemetry.shutdown();
    process.removeListener('SIGTERM', app);

    expect(afterSignal).toBe(0);
    expect(spanShutdown).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalled();
  });
});
