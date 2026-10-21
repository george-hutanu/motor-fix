import type { ActiveRequestDto } from '@motor-fix/data-access';
import {
  formatAround,
  formatLei,
  formatLeiRange,
  formatSlot,
  type Language,
  timeLeft,
} from '@motor-fix/i18n';

type Stage = ActiveRequestDto['stage'];
type StageState = 'done' | 'current' | 'later';

export const STAGES: readonly Stage[] = [
  'sent',
  'quoted',
  'booked',
  'in_work',
  'done',
];

// Every stage before the request's is done, its own is current.
export function stageStates(stage: Stage): StageState[] {
  const at = STAGES.indexOf(stage);
  return STAGES.map((_, i) =>
    i < at ? 'done' : i === at ? 'current' : 'later',
  );
}

const firstLine = (text: string | null) =>
  (text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

// The jobs, else the description's first line, then the car.
export function titleOf(request: ActiveRequestDto, language: Language): string {
  const car = `${request.car.brand} ${request.car.model}`;
  const jobs = request.jobs
    .toSorted((a, b) => a.position - b.position)
    .map((job) => (language === 'en' ? job.nameEn : job.nameRo));
  const what = jobs.length ? jobs.join(', ') : firstLine(request.description);
  return what ? `${what} · ${car}` : car;
}

export function whoOf(
  request: ActiveRequestDto,
): { garage: string; mechanic: string | null } | null {
  if (!request.booking) return null;
  return {
    garage: request.booking.garage.name,
    mechanic: request.mechanicName,
  };
}

export interface Fact {
  label: string;
  value: string;
}

// What the stage has to say: the range (and the final price), the booking
// once confirmed, the start and the estimate.
export function factsOf(
  request: ActiveRequestDto,
  language: Language,
  now: Date,
): Fact[] {
  const facts: Fact[] = [];
  const { booking, job, range } = request;
  if (range) {
    facts.push({
      label: 'driver.active.fact.quote',
      value: formatLeiRange(range.fromBani, range.toBani, language),
    });
  }
  if (job?.finalPriceBani != null) {
    facts.push({
      label: 'driver.active.fact.finalPrice',
      value: formatLei(job.finalPriceBani, language),
    });
  }
  if (request.stage === 'booked' && booking?.status === 'confirmed') {
    facts.push({
      label: 'driver.active.fact.booked',
      value: formatSlot(booking.startsAt, language, now),
    });
  }
  if (job?.startedAt) {
    facts.push({
      label: 'driver.active.fact.started',
      value: formatSlot(job.startedAt, language, now),
    });
  }
  if (job?.etaAt && request.stage !== 'done') {
    facts.push({
      label: 'driver.active.fact.eta',
      value: formatAround(job.etaAt, language, now),
    });
  }
  return facts;
}

export interface Line {
  key: string;
  params?: Record<string, string>;
}

// The one sentence under the facts: the garage has yet to confirm, the job is
// paused, or the car is ready.
export function lineOf(
  request: ActiveRequestDto,
  language: Language,
  now: Date,
): Line | null {
  const { booking, job, stage } = request;
  if (stage === 'booked' && booking?.status === 'awaiting_confirmation') {
    return {
      key: 'driver.active.awaiting',
      params: { left: timeLeft(booking.confirmBy, language, now) },
    };
  }
  if (stage === 'in_work' && job?.status === 'paused') {
    return { key: 'driver.active.paused' };
  }
  if (stage === 'done') return { key: 'driver.active.ready' };
  return null;
}

export function stepsSummary(
  request: ActiveRequestDto,
): { done: number; total: number } | null {
  const steps = request.job?.steps ?? [];
  if (!steps.length) return null;
  return {
    done: steps.filter((s) => s.state === 'done').length,
    total: steps.length,
  };
}

// The open requests beside the one shown.
export const moreOf = (openCount: number) => Math.max(0, openCount - 1);
