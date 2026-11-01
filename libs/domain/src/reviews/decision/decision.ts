interface ReportState {
  createdAt: Date;
  id: string;
  status: 'pending' | 'decided' | 'closed';
}

type DecisionRefused<R> =
  | { code: 'not_found' }
  | { code: 'no_pending_report' }
  | { code: 'already_decided'; report: R };

// Why a decision found no pending report to decide, read after the guarded
// write moved nothing: null is a review that does not exist. Only the latest
// report counts: decided names who got there first, anything else means the
// review is not waiting on an admin.
export function refusalOf<R extends ReportState>(
  reports: readonly R[] | null,
): DecisionRefused<R> {
  if (reports === null) return { code: 'not_found' };
  const latest = reports.reduce<R | null>(
    (last, report) =>
      !last || report.createdAt > last.createdAt ? report : last,
    null,
  );
  return latest?.status === 'decided'
    ? { code: 'already_decided', report: latest }
    : { code: 'no_pending_report' };
}
