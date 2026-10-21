import type {
  ActiveRequestStage,
  ActiveRequestStepDto,
} from '@motor-fix/contracts';

type JobStatus = 'to_do' | 'in_work' | 'paused' | 'done' | 'cancelled';
type BookingStatus =
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'lapsed'
  | 'cancelled'
  | 'no_show'
  | 'completed';
type QuoteStatus =
  | 'waiting'
  | 'accepted'
  | 'withdrawn'
  | 'expired'
  | 'lost'
  | 'declined_by_driver';
type RequestStatus =
  | 'sent'
  | 'quoted'
  | 'booked'
  | 'in_work'
  | 'done'
  | 'closed';

interface Named {
  name: string;
}

interface JobRow {
  status: JobStatus;
  startedAt: Date | null;
  pausedAt: Date | null;
  finishedAt: Date | null;
  handedOverAt: Date | null;
  etaAt: Date | null;
  mechanic: Named | null;
}

interface BookingRow {
  status: BookingStatus;
  createdAt: Date;
  confirmedAt: Date | null;
  durationMinutes: number;
  mechanic: Named | null;
  quote: { fromBani: number; toBani: number } | null;
  job: JobRow | null;
}

interface RequestRow {
  id: string;
  status: RequestStatus;
  createdAt: Date;
  quotes: {
    fromBani: number;
    toBani: number;
    status: QuoteStatus;
    sentAt: Date;
  }[];
  // Newest first; the read keeps only the live ones.
  bookings: BookingRow[];
}

export const LIVE_BOOKINGS = [
  'awaiting_confirmation',
  'confirmed',
  'completed',
] as const satisfies readonly BookingStatus[];

const OPEN_QUOTES = new Set<QuoteStatus>(['waiting']);
const WAITING = new Set<RequestStatus>(['sent', 'quoted']);
const FIVE_MINUTES = 5 * 60_000;

type LiveStatus = (typeof LIVE_BOOKINGS)[number];

const isLive = <B extends { status: string }>(
  b: B,
): b is B & { status: LiveStatus } =>
  (LIVE_BOOKINGS as readonly string[]).includes(b.status);

export const liveBooking = <B extends BookingRow>(row: { bookings: B[] }) =>
  row.bookings.find(isLive);

type LiveJobStatus = Exclude<JobStatus, 'cancelled'>;

const isLiveJob = <J extends JobRow>(
  job: J | null | undefined,
): job is J & { status: LiveJobStatus } => !!job && job.status !== 'cancelled';

// A cancelled job is no job.
export const jobOf = <J extends JobRow>(
  booking: { job: J | null } | undefined,
): (J & { status: LiveJobStatus }) | null => {
  const job = booking?.job;
  return isLiveJob(job) ? job : null;
};

// The stage comes from the newest live booking and its job; the request's own
// status only tells a quoted request from a sent one.
export function stageOf(row: RequestRow): ActiveRequestStage {
  const booking = liveBooking(row);
  if (booking) {
    const job = jobOf(booking);
    if (job?.status === 'done') return 'done';
    if (job?.status === 'in_work' || job?.status === 'paused') return 'in_work';
    return 'booked';
  }
  return row.status === 'sent' ? 'sent' : 'quoted';
}

// Waiting for quotes, or booked with a live booking whose car is not yet
// handed over.
export function isOpen(row: RequestRow): boolean {
  if (row.status === 'closed') return false;
  const booking = liveBooking(row);
  if (booking) return !booking.job?.handedOverAt;
  return WAITING.has(row.status);
}

const RANK: Record<ActiveRequestStage, number> = {
  booked: 1,
  done: 3,
  in_work: 0,
  quoted: 2,
  sent: 2,
};

function lastChangeOf(row: RequestRow): number {
  const times: (Date | null)[] = [row.createdAt];
  for (const quote of row.quotes) times.push(quote.sentAt);
  for (const booking of row.bookings) {
    times.push(booking.createdAt, booking.confirmedAt);
    const job = booking.job;
    if (job) times.push(job.startedAt, job.pausedAt, job.finishedAt);
  }
  return Math.max(...times.map((t) => t?.getTime() ?? 0));
}

// In work, booked, waiting for quotes, done; then the latest change; then the
// newest id.
export function byClosest(a: RequestRow, b: RequestRow): number {
  return (
    RANK[stageOf(a)] - RANK[stageOf(b)] ||
    lastChangeOf(b) - lastChangeOf(a) ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  );
}

// The accepted quote's range once booked; else across the open quotes.
export function rangeOf(
  row: RequestRow,
): { fromBani: number; toBani: number } | null {
  const booking = liveBooking(row);
  if (booking?.quote) {
    return { fromBani: booking.quote.fromBani, toBani: booking.quote.toBani };
  }
  const open = row.quotes.filter((q) => OPEN_QUOTES.has(q.status));
  if (open.length === 0) return null;
  return {
    fromBani: Math.min(...open.map((q) => q.fromBani)),
    toBani: Math.max(...open.map((q) => q.toBani)),
  };
}

// The job's mechanic, else the confirmed booking's; none while the garage has
// not confirmed or when it works without a team.
export function mechanicOf(
  booking: BookingRow | undefined,
  teamOn: boolean,
): string | null {
  if (!booking || !teamOn) return null;
  const fromJob = jobOf(booking)?.mechanic?.name;
  if (fromJob) return fromJob;
  if (booking.status === 'awaiting_confirmation') return null;
  return booking.mechanic?.name ?? null;
}

// The garage's estimate, else the start plus the booking's duration, up to the
// next 5-minute mark; none before the start or once done.
export function etaOf(job: JobRow, durationMinutes: number): Date | null {
  if (!job.startedAt || job.status === 'done' || job.status === 'cancelled') {
    return null;
  }
  const raw =
    job.etaAt?.getTime() ?? job.startedAt.getTime() + durationMinutes * 60_000;
  return new Date(Math.ceil(raw / FIVE_MINUTES) * FIVE_MINUTES);
}

interface StepRow {
  id: string;
  position: number;
  label: string;
  customerLabel: string | null;
  doneAt: Date | null;
}

// In position order, in the driver's words; the first open step is the one
// under way while the job is in work.
export function stepsOf(
  steps: StepRow[],
  jobStatus: JobStatus,
): ActiveRequestStepDto[] {
  let nowGiven = jobStatus !== 'in_work';
  return steps
    .toSorted((a, b) => a.position - b.position)
    .map((step) => {
      let state: ActiveRequestStepDto['state'] = 'todo';
      if (step.doneAt) state = 'done';
      else if (!nowGiven) {
        state = 'now';
        nowGiven = true;
      }
      return { id: step.id, state, text: step.customerLabel ?? step.label };
    });
}
