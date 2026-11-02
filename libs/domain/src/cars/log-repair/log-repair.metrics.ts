import { metrics } from '@opentelemetry/api';

// Looked up on every count: an instrument kept from before the meter provider
// is registered would stay a no-op for the life of the process.
const meter = () => metrics.getMeter('motorfix');

export type LoggedOutcome =
  | 'saved'
  | 'check_needed'
  | 'date_before_car_year'
  | 'unknown_garage';

export type LoggedCheck =
  | 'future_date'
  | 'odometer_below_earlier'
  | 'both'
  | 'none';

// A log that reached the use case, by how it ended and, when the driver was
// asked to check, which check fired; a 400 or a 404 is read from the status
// codes.
export function recordLogged(
  outcome: LoggedOutcome,
  check: LoggedCheck = 'none',
) {
  meter()
    .createCounter('motorfix_repairs_logged_total', {
      description: 'Repairs a driver logged, by outcome and check asked',
    })
    .add(1, { check, outcome });
}
