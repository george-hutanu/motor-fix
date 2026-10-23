// What a suspension and its lift may hold, read by the API's checks and the
// web's restore dialog alike.
export const SUSPENSION_CAUSES = [
  'recheck_failed',
  'documents_overdue',
  'admin',
  'report_confirmed',
] as const;
export type SuspensionCause = (typeof SUSPENSION_CAUSES)[number];

export const SUSPENSION_REASON_MAX = 200;
export const SUSPENSION_LIFT_NOTE_MAX = 1000;
