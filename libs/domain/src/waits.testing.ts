// Waits that hold on a machine slowed by other work: they wait for what a
// test asserts, never for a fixed time, and fail naming what never happened.

const EVERY_MS = 25;

// Resolves with the first value of `read` that is not undefined, null or
// false, reading again every 25 ms; rejects naming `what` after `ms`.
export async function until<T>(
  what: string,
  read: () =>
    | T
    | null
    | undefined
    | false
    | Promise<T | null | undefined | false>,
  ms = 15_000,
): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value !== undefined && value !== null && value !== false) return value;
    if (Date.now() > end)
      throw new Error(`waited ${ms} ms for ${what}, and it never happened`);
    await new Promise((resolve) => setTimeout(resolve, EVERY_MS));
  }
}

// Runs `work` and records each timer that code in `file` arms meanwhile,
// itself or through other app code, in the order armed; `log` also says when
// each fired. A timer a library arms on its own account is left out: a
// library frame between the timer and `file` means the library armed it.
// `file` may name a library ('ioredis') to record that library's own timers,
// or several files. An `AbortSignal.timeout` counts as a timer: it fires when
// the signal aborts.
// `work` is given the log, to wait for a timer it expects.
// Proves what a wall-clock bound only suggests: that nothing waited, or
// which of the code's own limits ended the wait.
export async function timersArmedBy<T>(
  file: string | string[],
  work: (log: readonly string[]) => Promise<T>,
) {
  const files = typeof file === 'string' ? [file] : file;
  const log: string[] = [];
  const arm = (ms: number) => {
    log.push(`armed ${ms}`);
    return () => {
      log.push(`fired ${ms}`);
    };
  };
  const realTimeout = globalThis.setTimeout;
  const timeouts = jest.spyOn(globalThis, 'setTimeout').mockImplementation(((
    handler: (...args: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ) => {
    if (!calledFrom(files)) return realTimeout(handler, ms, ...args);
    const fire = arm(ms ?? 0);
    return realTimeout(
      (...given: unknown[]) => {
        fire();
        handler(...given);
      },
      ms,
      ...args,
    );
  }) as typeof setTimeout);
  const realAbort = AbortSignal.timeout.bind(AbortSignal);
  const aborts = jest
    .spyOn(AbortSignal, 'timeout')
    .mockImplementation((ms: number) => {
      const signal = realAbort(ms);
      if (calledFrom(files))
        signal.addEventListener('abort', arm(ms), { once: true });
      return signal;
    });
  try {
    return { log, value: await work(log) };
  } finally {
    timeouts.mockRestore();
    aborts.mockRestore();
  }
}

function calledFrom(files: string[]): boolean {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 50;
  const frames = (new Error().stack ?? '').split('\n').slice(1);
  Error.stackTraceLimit = limit;
  // The spy's own frames come first, up to jest-mock's.
  const own = frames.findLastIndex((frame) => frame.includes('jest-mock'));
  for (const frame of frames.slice(own + 1)) {
    if (files.some((file) => frame.includes(file))) return true;
    if (frame.includes('node_modules')) return false;
  }
  return false;
}
