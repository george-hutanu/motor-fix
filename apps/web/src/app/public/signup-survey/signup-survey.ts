import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  Injector,
  inject,
  input,
  linkedSignal,
  output,
  viewChild,
} from '@angular/core';
import {
  FOUND_VIA,
  LIFTS_COUNTS,
  MECHANICS_COUNTS,
  type SurveySection,
  startingFeatures,
  surveyComplete,
} from '@motor-fix/contracts/listing-survey';
import { TranslatePipe } from '@motor-fix/i18n';
import { HlmButton, Lamp } from '@motor-fix/ui-cockpit';

// How the create press went: the page saves the answers, then tells.
export type SurveyNotice = 'saved' | 'failed' | null;

type Field = keyof SurveySection;
type Answer = SurveySection[Field];
type Mockup = 'team' | 'lifts' | 'media' | 'sheets';

interface Question {
  field: Field;
  kicker: string;
  title: string;
  options: readonly { value: Answer; label: string }[];
  // The feature the answer switches, with the picture and example shown
  // above the answers; the source question sets none.
  feature?: { name: string; on: (answer: Answer) => boolean; mockup: Mockup };
  example?: string;
}

const KEY = 'public.listing.survey.';
const YES_NO = [
  { label: `${KEY}yes`, value: true },
  { label: `${KEY}notNow`, value: false },
] as const;

const QUESTIONS: readonly Question[] = [
  {
    example: `${KEY}exTeam`,
    feature: {
      mockup: 'team',
      name: `${KEY}fTeam`,
      on: (answer) => answer !== '0',
    },
    field: 'mechanicsCount',
    kicker: `${KEY}kTeam`,
    options: MECHANICS_COUNTS.map((value) => ({
      label: `${KEY}mechanics.${value}`,
      value,
    })),
    title: `${KEY}qTeam`,
  },
  {
    example: `${KEY}exLifts`,
    feature: {
      mockup: 'lifts',
      name: `${KEY}fLifts`,
      on: (answer) => answer !== '0',
    },
    field: 'liftsCount',
    kicker: `${KEY}kLifts`,
    options: LIFTS_COUNTS.map((value) => ({
      label: `${KEY}lifts.${value}`,
      value,
    })),
    title: `${KEY}qLifts`,
  },
  {
    example: `${KEY}exMedia`,
    feature: {
      mockup: 'media',
      name: `${KEY}fMedia`,
      on: (answer) => answer === true,
    },
    field: 'wantsLiveMedia',
    kicker: `${KEY}kMedia`,
    options: YES_NO,
    title: `${KEY}qMedia`,
  },
  {
    example: `${KEY}exSheets`,
    feature: {
      mockup: 'sheets',
      name: `${KEY}fSheets`,
      on: (answer) => answer === true,
    },
    field: 'wantsDaySheets',
    kicker: `${KEY}kSheets`,
    options: YES_NO,
    title: `${KEY}qSheets`,
  },
  {
    field: 'foundVia',
    kicker: `${KEY}kLast`,
    options: FOUND_VIA.map((value) => ({
      label: `${KEY}source.${value}`,
      value,
    })),
    title: `${KEY}qSource`,
  },
];
const SUMMARY = QUESTIONS.length + 1;

// The made-up garage the four pictures show; names, cars and plates stay as
// they are in either language.
const SAMPLE = {
  hours: ['08', '11', '14', '17'],
  jobs: [
    {
      car: 'Dacia Logan',
      plate: 'B 123 ABC',
      time: '08:00',
      work: `${KEY}sj1`,
    },
    { car: 'BMW 320d', plate: 'IF 45 XYZ', time: '10:30', work: `${KEY}sj2` },
    { car: 'VW Golf', plate: 'B 77 MTF', time: '13:00', work: `${KEY}sj3` },
  ],
  lifts: [
    {
      blocks: [
        { kind: 'block', plain: true, span: 3, text: 'BMW 320d' },
        { kind: 'gap', plain: true, span: 2, text: '' },
        { kind: 'block', plain: false, span: 4, text: `${KEY}block1` },
      ],
      name: 'E1',
    },
    {
      blocks: [
        { kind: 'block', plain: true, span: 2, text: 'Logan' },
        { kind: 'block', plain: true, span: 2, text: 'Clio' },
        { kind: 'slot', plain: false, span: 5, text: `${KEY}freeSlot` },
      ],
      name: 'E2',
    },
    {
      blocks: [{ kind: 'block', plain: false, span: 9, text: `${KEY}block3` }],
      name: 'E3',
    },
  ],
  pills: ['WhatsApp', 'PDF'],
  team: [
    {
      dot: 'dot green pulse',
      initials: 'CR',
      job: `${KEY}job1`,
      name: 'Costel R.',
      state: `${KEY}working`,
    },
    {
      dot: 'dot amber',
      initials: 'AP',
      job: `${KEY}job2`,
      name: 'Andrei P.',
      state: `${KEY}waitParts`,
    },
    {
      dot: 'dot grey',
      initials: 'IM',
      job: `${KEY}noJob`,
      name: 'Ionuț M.',
      state: `${KEY}free`,
    },
  ],
} as const;

const ARROWS: Record<string, number> = {
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -1,
};

// Where a returning owner picks up: the first question left unanswered.
function resumeAt(value: SurveySection): number {
  if (Object.values(value).every((answer) => answer === undefined)) return 0;
  const open = QUESTIONS.findIndex(
    (question) => value[question.field] === undefined,
  );
  return open === -1 ? SUMMARY : open + 1;
}

// The five questions before a new garage's account, one screen each, between
// an intro and a summary of the features they switch on.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, Lamp, TranslatePipe],
  selector: 'mf-signup-survey',
  styleUrl: './signup-survey.css',
  templateUrl: './signup-survey.html',
})
export class SignupSurvey {
  private readonly injector = inject(Injector);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly group = viewChild<ElementRef<HTMLElement>>('group');

  readonly value = input<SurveySection>({});
  readonly busy = input(false);
  readonly notice = input<SurveyNotice>(null);
  readonly valueChange = output<SurveySection>();
  readonly back = output<void>();
  readonly finish = output<void>();

  protected readonly sample = SAMPLE;
  protected readonly summaryScreen = SUMMARY;
  // Read from the answers once, then moved only by the owner's presses.
  protected readonly screen = linkedSignal<SurveySection, number>({
    computation: (value, previous) => previous?.value ?? resumeAt(value),
    source: this.value,
  });
  protected readonly question = computed(
    () => QUESTIONS[this.screen() - 1] ?? null,
  );
  protected readonly answer = computed(() => {
    const question = this.question();
    return question ? this.value()[question.field] : undefined;
  });
  protected readonly segments = computed(() =>
    QUESTIONS.map((question) => this.value()[question.field] !== undefined),
  );
  protected readonly forwardLabel = computed(() => {
    const screen = this.screen();
    if (screen === 0) return `${KEY}start`;
    if (screen === SUMMARY) return `${KEY}createAccount`;
    return screen === QUESTIONS.length ? `${KEY}seeSummary` : `${KEY}cont`;
  });
  protected readonly blocked = computed(
    () =>
      this.busy() ||
      (this.question() !== null && this.answer() === undefined) ||
      (this.screen() === SUMMARY && !surveyComplete(this.value())),
  );
  protected readonly features = computed(() => {
    const value = this.value();
    if (!surveyComplete(value)) return [];
    const on = startingFeatures(value);
    return [
      { name: `${KEY}fTeam`, on: on.team_mechanics },
      { name: `${KEY}fLifts`, on: on.lift_schedule },
      { name: `${KEY}fMedia`, on: on.live_media },
      { name: `${KEY}fSheets`, on: on.day_sheets },
      { name: 'WhatsApp', on: on.whatsapp, plain: true },
    ];
  });

  protected tabStop(index: number): number {
    const options = this.question()?.options ?? [];
    const picked = options.findIndex((o) => o.value === this.answer());
    return index === (picked === -1 ? 0 : picked) ? 0 : -1;
  }

  protected pick(value: Answer) {
    const question = this.question();
    if (!question) return;
    this.valueChange.emit({ ...this.value(), [question.field]: value });
  }

  protected move(event: KeyboardEvent, index: number) {
    const step = ARROWS[event.key];
    const options = this.question()?.options;
    if (step === undefined || !options) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    this.pick(options[next]?.value);
    afterNextRender(
      () =>
        this.group()
          ?.nativeElement.querySelectorAll<HTMLElement>('[role="radio"]')
          [next]?.focus(),
      { injector: this.injector },
    );
  }

  protected forward() {
    if (this.blocked()) return;
    if (this.screen() === SUMMARY) {
      this.finish.emit();
      return;
    }
    this.go(this.screen() + 1);
  }

  protected backward() {
    if (this.screen() === 0) {
      this.back.emit();
      return;
    }
    this.go(this.screen() - 1);
  }

  private go(screen: number) {
    this.screen.set(screen);
    afterNextRender(() => this.heading()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }
}
