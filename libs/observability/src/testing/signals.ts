export type StopSignal = 'SIGINT' | 'SIGTERM';
export type StopListener = (signal: StopSignal) => void;

// The SIGTERM and SIGINT listeners `start` added, found by comparing each
// signal's listeners before and after it ran.
export function addedListeners(
  start: () => void,
): Record<StopSignal, StopListener> {
  const before = {
    SIGINT: process.listeners('SIGINT'),
    SIGTERM: process.listeners('SIGTERM'),
  };
  start();
  const added = (signal: StopSignal) =>
    process
      .listeners(signal)
      .find((listener) => !before[signal].includes(listener)) as StopListener;
  return { SIGINT: added('SIGINT'), SIGTERM: added('SIGTERM') };
}

// Detaches every other listener of the signal, as in a process whose only
// stop handling is telemetry's (mcp, or api after Nest's own listener has
// gone); returns the undo.
export function aloneOn(signal: StopSignal, listener: StopListener) {
  const others = process
    .listeners(signal)
    .filter((other) => other !== listener) as StopListener[];
  for (const other of others) process.removeListener(signal, other);
  return () => {
    for (const other of others) process.on(signal, other);
  };
}
