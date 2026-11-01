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
async function start(exporter: Exporter) {
  const memory = inMemory();
  const spanShutdown = vi.spyOn(memory.spanExporter, 'shutdown');
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
  return { listeners, spanShutdown, telemetry: telemetry! };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'Date',
      'hrtime',
      'performance',
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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
    const { telemetry } = await start('hangs');
    const first = vi.fn();
    const later = vi.fn();

    void telemetry.shutdown().then(first);
    await vi.advanceTimersByTimeAsync(3_000);
    void telemetry.shutdown().then(later);
    await vi.advanceTimersByTimeAsync(1_999);

    expect(first).not.toHaveBeenCalled();
    expect(later).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(first).toHaveBeenCalled();
    expect(later).toHaveBeenCalled();
  });

  it('settles without an error when an exporter fails to shut down', async () => {
    const { telemetry } = await start('fails');

    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });

  it('leaves no timer behind once a shutdown has settled', async () => {
    const { telemetry } = await start('answers');

    await telemetry.shutdown();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('raises the signal again after 5 s when it is the last listener and the shutdown never settles', async () => {
    const { listeners } = await start('hangs');
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const restore = aloneOn('SIGTERM', listeners.SIGTERM);

    listeners.SIGTERM('SIGTERM');
    await vi.advanceTimersByTimeAsync(4_999);
    const early = kill.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1);
    restore();

    expect(early).toBe(0);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
  });
});

describe('the stop signal at the edges of the bound', () => {
  it('raises the signal again as soon as a slow shutdown settles just before the bound', async () => {
    const { listeners } = await start('slow');
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const restore = aloneOn('SIGTERM', listeners.SIGTERM);

    listeners.SIGTERM('SIGTERM');
    await vi.advanceTimersByTimeAsync(4_899);
    const early = kill.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1);
    const atSettle = kill.mock.calls.length;
    await vi.advanceTimersByTimeAsync(200);
    restore();

    expect(early).toBe(0);
    expect(atSettle).toBe(1);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('raises the signal again when an exporter fails to shut down', async () => {
    const { listeners } = await start('fails');
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const restore = aloneOn('SIGTERM', listeners.SIGTERM);

    listeners.SIGTERM('SIGTERM');
    await vi.advanceTimersByTimeAsync(10);
    restore();

    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
  });

  it('shuts the providers down once when both stop signals arrive', async () => {
    const { listeners, spanShutdown } = await start('answers');
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const restoreTerm = aloneOn('SIGTERM', listeners.SIGTERM);
    const restoreInt = aloneOn('SIGINT', listeners.SIGINT);

    listeners.SIGTERM('SIGTERM');
    listeners.SIGINT('SIGINT');
    await vi.advanceTimersByTimeAsync(10);
    restoreTerm();
    restoreInt();

    expect(spanShutdown).toHaveBeenCalledTimes(1);
    expect(kill.mock.calls[0]).toEqual([process.pid, 'SIGTERM']);
  });

  it('still shuts down on a direct request after a signal another listener handled', async () => {
    const { listeners, telemetry, spanShutdown } = await start('answers');
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const app = () => undefined;
    process.on('SIGTERM', app);

    listeners.SIGTERM('SIGTERM');
    await vi.advanceTimersByTimeAsync(10);
    const afterSignal = spanShutdown.mock.calls.length;
    await telemetry.shutdown();
    process.removeListener('SIGTERM', app);

    expect(afterSignal).toBe(0);
    expect(spanShutdown).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalled();
  });
});
