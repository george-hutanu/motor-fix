import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  Injector,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { todayInBucharest } from '@motor-fix/contracts/garage-hours';
import {
  type CreateTimeBlockDto,
  GaragesService,
  type TimeBlockDto,
  type TimeBlockOptionsDto,
  type UpdateTimeBlockDto,
} from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  injectOverlayTask,
  type OverlayResult,
  toProblem,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput, toast } from '@motor-fix/ui-cockpit';

import type { BlockTimeData, BlockTimeResult } from './open-block-time';
import {
  bucharestInstant,
  bucharestWall,
  nextQuarter,
} from '../bucharest-time';
import { Session } from '../session';

type Field = 'mechanic' | 'lift' | 'from' | 'until' | 'note';
// A field's refusal before sending: its key and the control to focus.
interface Wrong {
  field: Field;
  focus: string;
  key: string;
}
// A block as the fields say it, none as null.
interface Asked {
  endsAt: string;
  lift: number | null;
  mechanicId: string | null;
  note: string | null;
  startsAt: string;
}

const MESSAGES = 'garage.timeBlocks';
// The server's note limit (TIME_BLOCK_NOTE_MAX), kept here because its DTO
// file carries the API's decorators, which the web bundle must not load.
const NOTE_MAX = 200;
const QUARTER = 15;
const MAX_DAYS = 14;
const MINUTE = 60_000;
const DAY_FORM = /^\d{4}-\d{2}-\d{2}$/;
const TIME_FORM = /^\d{2}:\d{2}$/;
// A refused body's field, as the dialog draws it.
const FIELD_OF: Record<string, Field> = {
  endsAt: 'until',
  lift: 'lift',
  mechanicId: 'mechanic',
  startsAt: 'from',
};
// The refusals after which the options may have changed.
const REREAD = new Set(['slot_taken', 'nothing_to_block']);
// The server's English-only field texts, said in the dialog's own words.
const OWN_TEXT: Partial<Record<Field, string>> = {
  lift: 'no_such_lift',
  mechanic: 'mechanic_gone',
};

// A wall-clock day and time some minutes later, on the same clock.
function later(day: string, time: string, minutes: number) {
  const at = new Date(
    Date.parse(`${day}T${time}:00Z`) + minutes * MINUTE,
  ).toISOString();
  return { day: at.slice(0, 10), time: at.slice(11, 16) };
}

const wallMinutes = (day: string, time: string) =>
  Date.parse(`${day}T${time}:00Z`) / MINUTE;

// "Blochează timp": a mechanic, a lift or both, held from a start to an end
// on the Bucharest clock with a note for the staff, as a confirmed booking
// would hold them. Only the fields the garage's switches allow are drawn.
// Given a block, the same dialog changes or removes it. A refusal keeps every
// choice and says what to change, under the field it concerns.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmInput, RouterLink, TranslatePipe],
  selector: 'mf-block-time-dialog',
  styleUrl: './block-time-dialog.css',
  templateUrl: './block-time-dialog.html',
})
export class BlockTimeDialog {
  private readonly garages = inject(GaragesService);
  private readonly i18n = inject(I18n);
  private readonly session = inject(Session);
  private readonly injector = inject(Injector);
  protected readonly task = injectOverlayTask<
    BlockTimeData,
    OverlayResult<BlockTimeResult>
  >();

  private readonly data = this.task.data;
  protected readonly block = this.data.block;
  protected readonly submitKey = this.block
    ? 'garage.timeBlocks.save'
    : 'garage.timeBlocks.submit';
  protected readonly noteMax = NOTE_MAX;

  protected readonly options = signal<TimeBlockOptionsDto | null>(null);
  private reads = 0;
  protected readonly loadFailed = signal(false);
  // The team was switched off under a mechanic this dialog sent.
  private readonly teamOff = signal(false);

  protected readonly mechanic = signal(this.block?.mechanic?.id ?? '');
  protected readonly lift = signal(
    this.block?.lift ? String(this.block.lift) : '',
  );
  private readonly start = this.block
    ? bucharestWall(this.block.startsAt)
    : { day: todayInBucharest(), time: nextQuarter() };
  private readonly end = this.block
    ? bucharestWall(this.block.endsAt)
    : later(this.start.day, this.start.time, 60);
  protected readonly fromDay = signal(this.start.day);
  protected readonly fromTime = signal(this.start.time);
  protected readonly untilDay = signal(this.end.day);
  protected readonly untilTime = signal(this.end.time);
  protected readonly note = signal(this.block?.note ?? '');

  protected readonly sending = signal(false);
  protected readonly asking = signal(false);
  protected readonly problem = signal<string | null>(null);
  protected readonly fieldProblem = signal<{
    field: Field;
    text: string;
  } | null>(null);
  // Renunță tells the opener to re-read once the block ended or went.
  protected readonly closeAs = signal<'cancelled' | 'refused'>('cancelled');
  private sentMechanic = false;

  protected readonly showMechanic = computed(
    () => !!this.options() && this.data.team && !this.teamOff(),
  );
  protected readonly showLift = computed(
    () => this.data.lifts && (this.options()?.liftCount ?? 0) > 0,
  );
  protected readonly lifts = computed(() =>
    Array.from({ length: this.options()?.liftCount ?? 0 }, (_, i) => i + 1),
  );
  protected readonly noMechanics = computed(
    () => this.showMechanic() && !this.options()?.mechanics.length,
  );
  // Only who may open the team page is sent there.
  protected readonly teamLink = computed(
    () => !!this.session.shown()?.capabilities.includes('garage.team'),
  );
  protected readonly noteLeft = computed(() => NOTE_MAX - this.note().length);
  // The fields take input once the options arrived, and not while saving.
  protected readonly off = computed(() => !this.options() || this.sending());
  private readonly pickedMechanic = computed(() =>
    this.showMechanic() ? this.mechanic() : '',
  );
  private readonly pickedLift = computed(() =>
    this.showLift() ? this.lift() : '',
  );

  constructor() {
    this.load();
  }

  // One message under one field at a time.
  protected readonly messages = computed(() => {
    const said = this.fieldProblem();
    const of = (field: Field) => (said?.field === field ? said.text : '');
    return {
      from: of('from'),
      lift: of('lift'),
      mechanic: of('mechanic'),
      note: of('note'),
      until: of('until'),
    };
  });

  protected edit(field: Field, set: () => void) {
    set();
    if (this.fieldProblem()?.field === field) this.fieldProblem.set(null);
  }

  protected load(featureOff = false) {
    const read = ++this.reads;
    this.garages
      .timeBlockOptions({ garageId: this.data.garageId })
      .then((offered) => {
        // A later read answers for the options now.
        if (read !== this.reads) return;
        if (featureOff && this.sentMechanic && !offered.mechanics.length)
          this.teamOff.set(true);
        const first = !this.options();
        this.options.set(offered);
        if (this.loadFailed()) {
          this.loadFailed.set(false);
          this.problem.set(null);
        }
        if (first) this.task.focusStart();
      })
      .catch(() => {
        // A re-read that fails keeps the options already drawn.
        if (read !== this.reads || this.options()) return;
        this.loadFailed.set(true);
        this.problem.set(this.i18n.t('shell.form.problem.error'));
      });
  }

  // Renunță asks first when something was typed, as Escape does; after a
  // block ended or gone it tells the opener to re-read.
  protected cancel() {
    if (this.closeAs() === 'refused') this.task.close('refused');
    else this.task.dismiss();
  }

  protected submit(event: Event) {
    event.preventDefault();
    if (this.off()) return;
    const wrong = this.wrong();
    if (wrong) {
      this.fieldProblem.set({
        field: wrong.field,
        text: this.i18n.t(`${MESSAGES}.refusal.${wrong.key}`),
      });
      this.focus(wrong.focus);
      return;
    }
    const asked = this.asked();
    this.sentMechanic = !!asked.mechanicId;
    if (this.block) this.change(this.block, asked);
    else this.create(asked);
  }

  protected remove() {
    if (!this.block || this.sending()) return;
    this.send(
      this.garages.deleteTimeBlock({
        blockId: this.block.id,
        garageId: this.data.garageId,
      }),
      'removed',
      'removed',
    );
  }

  // What the fields say, a selector not drawn as none.
  private asked(): Asked {
    const lift = this.pickedLift();
    return {
      endsAt: bucharestInstant(this.untilDay(), this.untilTime()),
      lift: lift ? Number(lift) : null,
      mechanicId: this.pickedMechanic() || null,
      note: this.note().trim() || null,
      startsAt: bucharestInstant(this.fromDay(), this.fromTime()),
    };
  }

  // A new block names only what was picked.
  private create(asked: Asked) {
    const { lift, mechanicId, note, ...when } = asked;
    const body: CreateTimeBlockDto = {
      ...when,
      ...(lift !== null && { lift }),
      ...(mechanicId !== null && { mechanicId }),
      ...(note !== null && { note }),
    };
    this.send(
      this.garages.createTimeBlock({ body, garageId: this.data.garageId }),
      'blocked',
      'done',
    );
  }

  // A change sends only what differs from the block; a selector set back to
  // none is null, one not drawn is left as it is. Nothing changed: closed.
  private change(was: TimeBlockDto, asked: Asked) {
    const before: Asked = {
      endsAt: bucharestInstant(this.end.day, this.end.time),
      lift: was.lift ?? null,
      mechanicId: was.mechanic?.id ?? null,
      note: was.note ?? null,
      startsAt: bucharestInstant(this.start.day, this.start.time),
    };
    const hidden = new Set<string>([
      ...(this.showLift() ? [] : ['lift']),
      ...(this.showMechanic() ? [] : ['mechanicId']),
    ]);
    const body: UpdateTimeBlockDto = Object.fromEntries(
      Object.entries(asked).filter(
        ([key, value]) =>
          !hidden.has(key) && value !== before[key as keyof Asked],
      ),
    );
    if (!Object.keys(body).length) {
      this.task.markUnchanged();
      this.task.close('cancelled');
      return;
    }
    this.send(
      this.garages.updateTimeBlock({
        blockId: was.id,
        body,
        garageId: this.data.garageId,
      }),
      'changed',
      'changed',
    );
  }

  // The first thing to change, in the order the fields are drawn.
  private wrong(): Wrong | null {
    return (
      this.nothingPicked() ??
      this.timeWrong('from', this.fromDay(), this.fromTime()) ??
      this.timeWrong('until', this.untilDay(), this.untilTime()) ??
      this.rangeWrong() ??
      this.noteWrong()
    );
  }

  // The textarea's maxlength holds what is typed; a pasted or filled value
  // past it is said too.
  private noteWrong(): Wrong | null {
    return this.note().trim().length > NOTE_MAX
      ? { field: 'note', focus: 'note', key: 'note_long' }
      : null;
  }

  private nothingPicked(): Wrong | null {
    if (this.pickedMechanic() || this.pickedLift()) return null;
    if (this.showMechanic()) {
      const key = this.showLift() ? 'pick_one' : 'pick_mechanic';
      return { field: 'mechanic', focus: 'mechanic', key };
    }
    return this.showLift()
      ? { field: 'lift', focus: 'lift', key: 'pick_lift' }
      : null;
  }

  private timeWrong(field: 'from' | 'until', day: string, time: string) {
    if (!DAY_FORM.test(day))
      return { field, focus: `${field}-day`, key: 'bad_time' };
    if (!TIME_FORM.test(time))
      return { field, focus: `${field}-time`, key: 'bad_time' };
    return Number(time.slice(3)) % QUARTER
      ? { field, focus: `${field}-time`, key: 'off_quarter' }
      : null;
  }

  private rangeWrong(): Wrong | null {
    const starts = Date.parse(
      bucharestInstant(this.fromDay(), this.fromTime()),
    );
    const ends = Date.parse(
      bucharestInstant(this.untilDay(), this.untilTime()),
    );
    // Calendar days, as the server counts them: a clock change does not
    // shorten the fourteenth.
    const wallSpan =
      wallMinutes(this.untilDay(), this.untilTime()) -
      wallMinutes(this.fromDay(), this.fromTime());
    const key =
      ends <= starts
        ? 'end_before_start'
        : wallSpan > MAX_DAYS * 24 * 60
          ? 'too_long'
          : ends <= Date.now()
            ? 'already_ended'
            : null;
    return key ? { field: 'until', focus: 'until-day', key } : null;
  }

  private send(
    call: Promise<unknown>,
    result: BlockTimeResult,
    said: 'done' | 'changed' | 'removed',
  ) {
    this.sending.set(true);
    this.task.hold(true);
    this.problem.set(null);
    this.fieldProblem.set(null);
    call
      .then(() => {
        this.task.markUnchanged();
        toast(this.i18n.t(`${MESSAGES}.${said}`));
        this.task.close(result);
      })
      .catch((failure: unknown) => {
        this.asking.set(false);
        this.refused(failure);
      })
      .finally(() => {
        this.sending.set(false);
        this.task.hold(false);
      });
  }

  private refused(failure: unknown) {
    const problem = toProblem(failure);
    // Nothing reached the server, or it failed: the choices stay for another
    // press; nothing is queued.
    if (
      problem.code === 'offline' ||
      problem.status === 0 ||
      problem.status >= 500
    ) {
      toast(
        this.i18n.t(
          problem.code === 'offline'
            ? 'shell.form.problem.offline'
            : 'shell.form.problem.error',
        ),
      );
      return;
    }
    const field = FIELD_OF[problem.errors?.[0]?.field ?? ''];
    if (field) this.fieldRefused(field, problem.code, failure);
    else this.problem.set(this.topText(problem.code, problem.status, failure));
  }

  // Under the field the refusal names, which takes the focus; a card gone or
  // a lift that does not exist re-reads the options.
  private fieldRefused(field: Field, code: string, failure: unknown) {
    const own = code === 'validation_failed' ? OWN_TEXT[field] : undefined;
    this.fieldProblem.set({
      field,
      text: own
        ? this.i18n.t(`${MESSAGES}.problem.${own}`)
        : (this.serverText(failure) ?? this.sharedText(code)),
    });
    const focus =
      field === 'from' || field === 'until' ? `${field}-day` : field;
    this.focus(focus);
    if (own) this.load();
  }

  // Above the fields; a refusal that changes what may be offered re-reads
  // the options, and a block ended or gone closes as refused.
  private topText(code: string, status: number, failure: unknown) {
    if (code === 'feature_off') {
      this.load(true);
      return this.i18n.t(`${MESSAGES}.problem.feature_off`);
    }
    if (REREAD.has(code)) this.load();
    const gone = !!this.block && (code === 'block_past' || status === 404);
    if (gone) this.closeAs.set('refused');
    if (gone && status === 404)
      return this.i18n.t('shell.form.problem.not_found');
    return this.serverText(failure) ?? this.sharedText(code);
  }

  // Once drawn: a control a save in flight disabled takes no focus.
  private focus(id: string) {
    afterNextRender(() => document.getElementById(`mf-block-${id}`)?.focus(), {
      injector: this.injector,
    });
  }

  // The refusal's own message, in the person's language where the server
  // has one.
  private serverText(failure: unknown) {
    const body =
      failure instanceof HttpErrorResponse
        ? (failure.error as { message?: unknown } | null)
        : null;
    return typeof body?.message === 'string' && body.message
      ? body.message
      : null;
  }

  private sharedText(code: string) {
    for (const key of [
      `${MESSAGES}.problem.${code}`,
      `shell.form.problem.${code}`,
    ]) {
      const said = this.i18n.t(key);
      if (said !== key && typeof said === 'string') return said;
    }
    return this.i18n.t('shell.form.problem.error');
  }
}
