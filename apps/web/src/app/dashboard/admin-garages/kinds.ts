import type { EventKind } from '@motor-fix/contracts';

// What moves the counts line and the suspended garages: a garage suspended or
// put back, and every step of a verification file (a new file is the one a
// suspended garage's row opens).
export const GARAGES_KINDS: readonly EventKind[] = [
  'garage.suspended',
  'garage.restored',
  'verification.submitted',
  'verification.opened',
  'verification.check_recorded',
  'verification.decided',
  'verification.reopened',
];
