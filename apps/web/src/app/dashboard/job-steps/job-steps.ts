import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import type { EventKind } from '@motor-fix/contracts';
import {
  GarageJobsService,
  type JobDto,
  type JobStepDto,
} from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask, toProblem } from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';

import { liveResource } from '../live';
import { Session } from '../session';
import { Waiting } from '../waiting';

const STEP_KINDS: readonly EventKind[] = [
  'job.step_done',
  'job.step_undone',
  'job.steps_changed',
  'job.started',
  'job.paused',
  'job.resumed',
  'job.done',
  'job.reopened',
  'job.mechanic_changed',
];

const STEPS_MAX = 20;
const PROVISIONAL = 'new:';
const CLOSED = new Set<JobDto['status']>(['done', 'cancelled']);
const WRITERS = new Set(['garage', 'mechanic']);
// The refusals this panel words itself; any other is the form's.
const OWN_PROBLEMS = new Set([
  'forbidden',
  'job_closed',
  'job_not_started',
  'not_found',
  'too_many_steps',
]);
const FORM_PROBLEMS = new Set([
  'conflict',
  'internal_error',
  'maintenance',
  'network',
  'offline',
  'service_unavailable',
  'sign_in_required',
  'validation_failed',
]);

// 2 to 80 characters once trimmed, as the API checks.
const fits = (text: string) => text.length >= 2 && text.length <= 80;

const problemKey = (error: unknown) => {
  const { code } = toProblem(error);
  if (OWN_PROBLEMS.has(code)) return `garage.jobs.problem.${code}`;
  return `shell.form.problem.${FORM_PROBLEMS.has(code) ? code : 'error'}`;
};

interface Editing {
  id: string;
  text: string;
  problem: boolean;
}

// "Pașii lucrării": the job's steps, ticked by the owner or the job's
// mechanic, and written, renamed, moved and removed by them. A tick goes
// through the waiting queue, so it holds without signal; every other write
// shows at once and goes back as it was if the API refuses it.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmInput, TranslatePipe],
  selector: 'mf-job-steps',
  styleUrl: './job-steps.css',
  templateUrl: './job-steps.html',
})
export class JobSteps {
  private readonly api = inject(GarageJobsService);
  private readonly waiting = inject(Waiting);
  private readonly session = inject(Session);
  private readonly i18n = inject(I18n);
  private readonly task = injectOverlayTask<{ id: string }, void>();
  private readonly id = this.task.data.id;

  protected readonly view = liveResource(
    () => this.api.garageJobsControllerGet({ id: this.id }),
    STEP_KINDS,
    () => this.id,
  );
  protected readonly job = computed(() => this.view.value());
  // The steps as shown: the last read, with this person's writes on top.
  protected readonly steps = linkedSignal<JobStepDto[]>(
    () => this.view.value()?.steps ?? [],
  );
  // Ticks sent, by step, until a read shows them and the queue holds none.
  private readonly ticked = signal<Record<string, boolean>>({});
  protected readonly menuFor = signal<string | null>(null);
  protected readonly editing = signal<Editing | null>(null);
  protected readonly adding = signal<string | null>(null);
  protected readonly addProblem = signal(false);
  private addKey = '';
  protected readonly problem = signal<string | null>(null);
  protected readonly max = STEPS_MAX;

  protected readonly writable = computed(() => {
    const job = this.job();
    const role = this.session.current()?.role ?? '';
    return !!job && WRITERS.has(role) && !CLOSED.has(job.status);
  });
  protected readonly doneCount = computed(
    () => this.steps().filter((s) => this.isDone(s)).length,
  );
  protected readonly full = computed(() => this.steps().length >= STEPS_MAX);

  constructor() {
    void this.i18n.enter('garage');
    // A fresh read is the truth for every tick the queue no longer holds.
    effect(() => {
      this.view.value();
      untracked(() => this.settleTicks());
    });
    effect(() => {
      if (this.view.gone()) untracked(() => this.task.close());
    });
  }

  protected isDone(step: JobStepDto) {
    return this.ticked()[step.id] ?? !!step.doneAt;
  }

  // Sent and not yet answered: shown done, marked as sending.
  protected sending(step: JobStepDto) {
    const url = this.tickUrl(step.id);
    return this.waiting
      .actions()
      .some((a) => a.url === url && a.state === 'waiting');
  }

  protected names(job: JobDto) {
    const english = this.i18n.language() === 'en';
    return job.jobs.map((j) => (english ? j.nameEn : j.nameRo)).join(', ');
  }

  protected stage(job: JobDto) {
    return `garage.jobs.stage.${job.status}`;
  }

  protected tick(step: JobStepDto) {
    if (this.job()?.status === 'to_do') {
      this.problem.set('garage.jobs.problem.job_not_started');
      return;
    }
    this.problem.set(null);
    const done = !this.isDone(step);
    this.ticked.update((t) => ({ ...t, [step.id]: done }));
    void this.waiting.add('job.step', {
      body: { done },
      method: 'PUT',
      url: this.tickUrl(step.id),
    });
  }

  protected toggleMenu(id: string) {
    this.menuFor.update((open) => (open === id ? null : id));
  }

  protected startRename(step: JobStepDto) {
    this.menuFor.set(null);
    this.editing.set({ id: step.id, problem: false, text: step.label });
  }

  protected typeRename(event: Event) {
    const text = (event.target as HTMLInputElement).value;
    this.editing.update((e) => e && { ...e, problem: false, text });
  }

  protected async saveRename() {
    const editing = this.editing();
    if (!editing) return;
    const text = editing.text.trim();
    if (!fits(text)) {
      this.editing.set({ ...editing, problem: true });
      return;
    }
    this.editing.set(null);
    await this.write(
      (steps) =>
        steps.map((s) =>
          s.id === editing.id ? { ...s, customerLabel: text, label: text } : s,
        ),
      async () => {
        const saved = await this.api.jobStepsControllerRename({
          body: { text },
          id: this.id,
          stepId: editing.id,
        });
        this.steps.update((steps) =>
          steps.map((s) => (s.id === saved.id ? saved : s)),
        );
      },
    );
  }

  protected move(step: JobStepDto, by: -1 | 1) {
    this.menuFor.set(null);
    const steps = [...this.steps()];
    const from = steps.findIndex((s) => s.id === step.id);
    const [moved] = steps.splice(from, 1);
    steps.splice(from + by, 0, moved);
    void this.write(
      () => steps,
      () =>
        this.api.jobStepsControllerReorder({
          body: { stepIds: steps.map((s) => s.id) },
          id: this.id,
        }),
    );
  }

  protected remove(step: JobStepDto) {
    this.menuFor.set(null);
    void this.write(
      (steps) => steps.filter((s) => s.id !== step.id),
      () => this.api.jobStepsControllerRemove({ id: this.id, stepId: step.id }),
    );
  }

  // A new key once the last add was answered; after a failed one the same
  // key goes again, so an add whose answer was lost is never made twice.
  protected startAdd() {
    this.addKey ||= crypto.randomUUID();
    this.addProblem.set(false);
    this.adding.set('');
  }

  protected typeAdd(event: Event) {
    this.addProblem.set(false);
    this.adding.set((event.target as HTMLInputElement).value);
  }

  protected cancelAdd() {
    this.adding.set(null);
    this.addProblem.set(false);
  }

  protected async add() {
    const text = (this.adding() ?? '').trim();
    if (!fits(text)) {
      this.addProblem.set(true);
      return;
    }
    const key = this.addKey;
    const provisional: JobStepDto = {
      customerLabel: text,
      doneAt: null,
      doneBy: null,
      id: `${PROVISIONAL}${key}`,
      label: text,
      position: this.steps().length + 1,
    };
    this.adding.set(null);
    await this.write(
      (steps) => [...steps, provisional],
      async () => {
        const step = await this.api.jobStepsControllerAdd({
          body: { text },
          'Idempotency-Key': key,
          id: this.id,
        });
        this.steps.update((steps) => [
          ...steps.filter((s) => s.id !== step.id && s.id !== provisional.id),
          step,
        ]);
        this.addKey = '';
      },
    );
  }

  // A step shown before the API has answered for it: nothing to tick or move.
  protected provisional(step: JobStepDto) {
    return step.id.startsWith(PROVISIONAL);
  }

  // Shows the change at once and puts the steps back if it is refused.
  private async write(
    change: (steps: JobStepDto[]) => JobStepDto[],
    send: () => Promise<unknown>,
  ) {
    const before = this.steps();
    const changed = change(before);
    this.problem.set(null);
    this.steps.set(changed);
    try {
      await send();
    } catch (error) {
      // A re-read meanwhile already shows the steps as they are.
      if (this.steps() === changed) this.steps.set(before);
      this.problem.set(problemKey(error));
    }
  }

  private settleTicks() {
    const held = new Set(this.waiting.actions().map((a) => a.url));
    this.ticked.update((t) =>
      Object.fromEntries(
        Object.entries(t).filter(([id]) => held.has(this.tickUrl(id))),
      ),
    );
  }

  private tickUrl(stepId: string) {
    return `/api/v1/garage/jobs/${this.id}/steps/${stepId}/done`;
  }
}
