import type { startTelemetry } from './start';
import { inMemory } from '../testing/in-memory';
import {
  addedListeners,
  aloneOn,
  type StopListener,
  type StopSignal,
} from '../testing/signals';

const added: StopListener[] = [];
// Each isolated start hooks the instrumentations into the worker's shared
// module loader again; unhooked after each test, or later suites overflow.
const instrumented: { disable(): void }[] = [];

function start(spanShutdown?: () => Promise<void>) {
  const memory = inMemory();
  const spanSpy = jest.spyOn(memory.spanExporter, 'shutdown');
  if (spanShutdown) spanSpy.mockImplementation(spanShutdown);
  let telemetry: ReturnType<typeof startTelemetry>;
  const listeners = addedListeners(() =>
    jest.isolateModules(() => {
      const setup = require('./start') as typeof import('./start');
      telemetry = setup.startTelemetry(
        'worker',
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
  return { listeners, spanSpy, telemetry: telemetry! };
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

describe('the stop signal at the edges of the bound', () => {
  it('raises the signal again as soon as a slow shutdown settles just before the bound', async () => {
    const { listeners } = start(
      () => new Promise<void>((resolve) => setTimeout(resolve, 4_900)),
    );
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
    const { listeners } = start(() => Promise.reject(new Error('refused')));
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    const restore = aloneOn('SIGTERM', listeners.SIGTERM);

    listeners.SIGTERM('SIGTERM');
    await jest.advanceTimersByTimeAsync(10);
    restore();

    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
  });

  it('shuts the providers down once when both stop signals arrive', async () => {
    const { listeners, spanSpy } = start();
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    const restoreTerm = aloneOn('SIGTERM', listeners.SIGTERM);
    const restoreInt = aloneOn('SIGINT', listeners.SIGINT);

    listeners.SIGTERM('SIGTERM');
    listeners.SIGINT('SIGINT');
    await jest.advanceTimersByTimeAsync(10);
    restoreTerm();
    restoreInt();

    expect(spanSpy).toHaveBeenCalledTimes(1);
    expect(kill.mock.calls[0]).toEqual([process.pid, 'SIGTERM']);
  });

  it('raises the signal again once when the same signal arrives twice', async () => {
    const { listeners } = start();
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    const restore = aloneOn('SIGTERM', listeners.SIGTERM);

    listeners.SIGTERM('SIGTERM');
    listeners.SIGTERM('SIGTERM');
    await jest.advanceTimersByTimeAsync(10);
    restore();

    expect(kill).toHaveBeenCalledTimes(1);
  });

  it('still shuts down on a direct request after a signal another listener handled', async () => {
    const { listeners, telemetry, spanSpy } = start();
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    const app = () => undefined;
    process.on('SIGTERM', app);

    listeners.SIGTERM('SIGTERM');
    await jest.advanceTimersByTimeAsync(10);
    const afterSignal = spanSpy.mock.calls.length;
    await telemetry.shutdown();
    process.removeListener('SIGTERM', app);

    expect(afterSignal).toBe(0);
    expect(spanSpy).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalled();
  });
});
