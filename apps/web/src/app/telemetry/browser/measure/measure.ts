export type Measure = (
  type: string,
  values: Record<string, number>,
  context: Record<string, string>,
) => void;

let sink: Measure | undefined;

// Browser telemetry loads late and as its own chunk; until it starts, or on a
// page without it, a measurement goes nowhere.
export function sendMeasurementsTo(next: Measure | undefined): void {
  sink = next;
}

export function measure(...args: Parameters<Measure>): void {
  try {
    sink?.(...args);
  } catch {
    // Telemetry never breaks the page.
  }
}
