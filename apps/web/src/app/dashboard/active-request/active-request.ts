import { _IdGenerator } from '@angular/cdk/a11y';
import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  output,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ActiveRequestAnswerDto } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmButton, Panel } from '@motor-fix/ui-cockpit';

import {
  factsOf,
  lineOf,
  moreOf,
  STAGES,
  stageStates,
  stepsSummary,
  titleOf,
  whoOf,
} from './active-request.rules';

const STAGE_LABELS = {
  booked: 'driver.active.stage.booked',
  done: 'driver.active.stage.done',
  in_work: 'driver.active.stage.in_work',
  quoted: 'driver.active.stage.quoted',
  sent: 'driver.active.stage.sent',
} as const;

const STEP_MARKS = {
  done: 'driver.active.step.done',
  now: 'driver.active.step.now',
  todo: null,
} as const;

// How often the panel reads the clock again, so "încă 18 h" counts down.
const TICK_MS = 60_000;

// "Cererea activă": the driver's open request closest to the workshop on its
// five stages, with what the stage has to say; or its loading, failed or
// empty state. It draws the read it is given and asks for another on retry.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, Panel, RouterLink, TranslatePipe],
  selector: 'mf-active-request',
  styleUrl: './active-request.css',
  templateUrl: './active-request.html',
})
export class ActiveRequest {
  // undefined while reading.
  readonly answer = input<ActiveRequestAnswerDto | 'failed' | undefined>();
  // Link the other open requests to Cererile mele (not on that view).
  readonly more = input(false);
  // The live stream is down past its grace: say so under the stages.
  readonly reconnecting = input(false);
  readonly retry = output<void>();

  private readonly i18n = inject(I18n);
  protected readonly language = this.i18n.language;
  protected readonly headingId = inject(_IdGenerator).getId('mf-active-');
  private readonly now = signal(new Date());

  protected readonly view = computed(() => {
    const answer = this.answer();
    if (answer === undefined || answer === 'failed') return undefined;
    const request = answer.request;
    if (!request) return null;
    const language = this.language();
    const now = this.now();
    const states = stageStates(request.stage);
    return {
      facts: factsOf(request, language, now),
      line: lineOf(request, language, now),
      more: this.more() ? moreOf(answer.openCount) : 0,
      stages: STAGES.map((stage, i) => ({
        label: STAGE_LABELS[stage],
        stage,
        state: states[i],
      })),
      steps: (request.job?.steps ?? []).map((step) => ({
        ...step,
        mark: STEP_MARKS[step.state],
      })),
      summary: stepsSummary(request),
      title: titleOf(request, language),
      who: whoOf(request),
    };
  });

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const tick = setInterval(() => this.now.set(new Date()), TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
  }
}
