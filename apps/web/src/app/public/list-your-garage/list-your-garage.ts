import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  effect,
  Injector,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type {
  FieldProblem,
  ListingDraftData,
  VerificationStageStatus,
} from '@motor-fix/contracts';
import type { HoursSection } from '@motor-fix/contracts/garage-hours';
import {
  declarationDone,
  documentDone,
} from '@motor-fix/contracts/legal-documents';
import {
  checkListing,
  type ListingCheck,
  type ListingStep,
  refOf,
  stepOf,
} from '@motor-fix/contracts/listing-check';
import {
  isDetailsSection,
  isMechanicsSection,
  isPricesSection,
} from '@motor-fix/contracts/listing-sections';
import type { SurveySection } from '@motor-fix/contracts/listing-survey';
import {
  isValidCui,
  normaliseRarNumber,
  RAR_NUMBER_MIN,
  stripCui,
} from '@motor-fix/contracts/listing-verification';
import {
  isPlaceSection,
  type PlaceSection,
} from '@motor-fix/contracts/place-section';
import type { JobTypeDto } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmButton, HlmInput, REDUCED_MOTION } from '@motor-fix/ui-cockpit';

import { Consent } from '../../consent/consent';
import { Session } from '../../dashboard/session';
import { SignInDialog } from '../../sign-in/sign-in-dialog';
import { brandsOf, dropUnlisted, jobsOf } from '../brands-section';
import { BrandsStep } from '../brands-step/brands-step';
import { DetailsStep } from '../details-step/details-step';
import { DocumentsStep } from '../documents-step/documents-step';
import { DraftKeeper } from '../draft/draft-keeper';
import { type FieldMessage, FieldWatch, forStep } from '../field-watch';
import { GaragePreview } from '../garage-preview/garage-preview';
import { hoursOf, mergeHours } from '../hours-section';
import { HoursStep } from '../hours-step/hours-step';
import { ListingStatus, ownedGarage } from '../listing-status/listing-status';
import { MechanicsStep } from '../mechanics-step/mechanics-step';
import {
  MissingSummary,
  type SummaryState,
} from '../missing-summary/missing-summary';
import { PhotosStep } from '../photos-step/photos-step';
import { PlaceStep } from '../place-step/place-step';
import { dropUntaken } from '../prices-step/prices-rows';
import { PricesStep } from '../prices-step/prices-step';
import {
  SignupSurvey,
  type SurveyNotice,
} from '../signup-survey/signup-survey';
import { completedCount, readStep6, type Step6Values } from '../step6';
import { currentStep, jumpTarget, keepsTapped, STEPS } from '../steps';

// Where the browser never says a scroll has ended: how long the page must be
// still, after its last movement, before a jump's scroll counts as over.
const QUIET_MS = 150;
// A jump whose scroll has not started by then never will (the page could not
// move after all): it lets go, so the step list follows the owner again.
const STALL_MS = 3000;

// Each part of the page that shows field errors, and the step it sits in.
const PART_STEP = {
  brands: 2,
  details: 1,
  documents: 6,
  email: 1,
  hours: 5,
  mechanics: 4,
  photos: 5,
  place: 5,
  prices: 3,
  step6: 6,
} as const;
type Part = keyof typeof PART_STEP;

const same = (a: FieldProblem, b: FieldProblem) =>
  a.field === b.field && a.code === b.code;
// The page's own list, with what only the server knew added.
const joined = (own: FieldProblem[], server: FieldProblem[] = []) => [
  ...own,
  ...server.filter((problem) => !own.some((o) => same(o, problem))),
];

// The page the owner fills in to list a garage: six steps on one long page,
// with the list of steps beside them, or in a bar on a phone. Once sent, the
// listing's verification stages take the place of the form.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'outside($event)' },
  imports: [
    BrandsStep,
    DetailsStep,
    DocumentsStep,
    GaragePreview,
    HlmButton,
    HlmInput,
    HoursStep,
    ListingStatus,
    MechanicsStep,
    MissingSummary,
    PhotosStep,
    PlaceStep,
    PricesStep,
    RouterLink,
    SignupSurvey,
    TranslatePipe,
  ],
  providers: [DraftKeeper],
  selector: 'mf-list-your-garage',
  styleUrl: './list-your-garage.css',
  templateUrl: './list-your-garage.html',
})
export class ListYourGarage {
  private readonly i18n = inject(I18n);
  private readonly reduced = inject(REDUCED_MOTION);
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  private readonly route = inject(ActivatedRoute);
  private readonly nav = viewChild<ElementRef<HTMLElement>>('nav');
  private readonly bar = viewChild<ElementRef<HTMLElement>>('bar');
  private readonly field = viewChild<ElementRef<HTMLElement>>('email');
  private readonly summary = viewChild<unknown, ElementRef<HTMLElement>>(
    MissingSummary,
    { read: ElementRef },
  );
  // A jump's own scroll is under way: however late it starts (up to the
  // stall), none of its movement decides the current step.
  private held = false;
  private quiet: ReturnType<typeof setTimeout> | undefined;
  // The step last jumped to, held while the page cannot bring it to the line.
  private tapped: number | null = null;

  protected readonly keeper = inject(DraftKeeper);
  private readonly consent = inject(Consent);
  // The steps ticked since the copy was restored, those it came with included.
  private ticked: Set<number> | null = null;
  protected readonly signIn = inject(SignInDialog);
  private readonly session = inject(Session);
  protected readonly steps = STEPS;
  // The draft's steps['5'], kept and restored with the rest of the form.
  protected readonly hours = computed(() => hoursOf(this.keeper.draft().data));
  // The draft's steps['2'], kept and restored with the rest of the form.
  protected readonly brands = computed(() =>
    brandsOf(this.keeper.draft().data),
  );
  // Steps 1, 3 and 4 as the draft holds them; a kept section not in its
  // shape reads as empty (step 3 as absent, so its jobs are listed again).
  private readonly kept = computed(
    () => (this.keeper.draft().data as ListingDraftData).steps ?? {},
  );
  protected readonly details = computed(() => {
    const section: unknown = this.kept()['1'];
    return isDetailsSection(section) ? section : {};
  });
  protected readonly prices = computed(() => {
    const section: unknown = this.kept()['3'];
    return isPricesSection(section) ? section : undefined;
  });
  protected readonly mechanics = computed(() => {
    const section: unknown = this.kept()['4'];
    return isMechanicsSection(section) ? section : {};
  });
  protected readonly documents = computed(
    () => (this.keeper.draft().data as ListingDraftData).documents ?? {},
  );
  protected readonly declaration = computed(() => {
    const { declaredAt, declaredByName } = this.keeper.draft()
      .data as ListingDraftData;
    return {
      ...(declaredAt !== undefined && { declaredAt }),
      ...(declaredByName !== undefined && { declaredByName }),
    };
  });
  protected readonly photos = computed(
    () => (this.keeper.draft().data as ListingDraftData).files ?? [],
  );
  // steps['5'].place, beside the hours; a place not in its shape opens empty.
  protected readonly place = computed(() => {
    const section: unknown = this.kept()['5'];
    const place =
      typeof section === 'object' && section !== null
        ? (section as Record<string, unknown>)['place']
        : undefined;
    return isPlaceSection(place) ? place : {};
  });
  // The brands in the order step 2 shows them, for the preview card.
  protected readonly brandOrder = signal<string[]>([]);
  protected readonly takenBrands = computed(() =>
    this.brands().brands.filter((b) => b.stance === 'works_on'),
  );
  // The whole listing judged as the owner types, by the rule the server uses.
  private readonly ownCheck = computed(() => {
    // An address never typed is judged as empty: it is missing, like any
    // other field.
    const { data, email } = this.keeper.draft();
    return checkListing({ data, email: email ?? '' });
  });
  // The server's last judgement, until the next change to what it judged
  // makes it stale (a step change or a save alone does not).
  private readonly serverCheck = signal<{
    of: string;
    check: ListingCheck;
  } | null>(null);
  private readonly judged = computed(() => {
    const { data, email } = this.keeper.draft();
    return JSON.stringify([data, email ?? '']);
  });
  protected readonly problems = computed<ListingCheck>(() => {
    const own = this.ownCheck();
    const server = this.serverCheck();
    if (!server || server.of !== this.judged()) return own;
    return {
      errors: joined(own.errors, server.check.errors),
      warnings: joined(own.warnings, server.check.warnings),
    };
  });
  protected readonly stepProblems = computed(() => {
    const problems = this.problems();
    return STEPS.map((step) => forStep(problems, step.n as ListingStep));
  });
  // The steps the list ticks: none of their fields is missing or wrong.
  protected readonly done = computed(
    () =>
      new Set(
        STEPS.filter(
          (step) => this.stepProblems()[step.n - 1]?.errors.length === 0,
        ).map((step) => step.n),
      ),
  );
  // Sending was asked for: every field shows what is wrong with it.
  protected readonly asked = signal(false);
  private readonly shownErrors = signal<Partial<Record<Part, boolean>>>({});
  // The steps the list marks red: asked for, or a field there shows an error.
  protected readonly dots = computed(() => {
    const shown = this.shownErrors();
    const asked = this.asked();
    return new Set(
      STEPS.filter(
        (step) =>
          !this.done().has(step.n) &&
          (asked ||
            Object.entries(shown).some(
              ([part, on]) => on && PART_STEP[part as Part] === step.n,
            )),
      ).map((step) => step.n),
    );
  });
  protected readonly inFlight = signal(false);
  // The sign-up survey shows in place of the form, once the listing is
  // complete or when the draft comes back with an answer in it.
  protected readonly surveyOpen = signal(false);
  protected readonly surveyAnswers = computed<SurveySection>(
    () => (this.keeper.draft().data as ListingDraftData).survey ?? {},
  );
  protected readonly finishing = signal(false);
  protected readonly finishNotice = signal<SurveyNotice>(null);
  private surveyTracked = false;
  // What became of the send pressed on the survey's summary, while there.
  protected readonly sendState = signal<
    'owner' | 'failed' | 'incomplete' | null
  >(null);
  // The owner's listing on its way to the map, with what the send answered
  // when it was sent from this page; the form is done with.
  protected readonly statusView = signal<{
    sent: VerificationStageStatus | null;
  } | null>(null);
  // A send in progress shows its own answer, not the one the session finds.
  private sending = false;
  private ownerShown = false;
  // One key for the page's send: a send again after a failure is the same
  // send, and answers what the first made if it did get through.
  private submitKey: string | null = null;
  private readonly outcome = signal<'complete' | 'failed' | null>(null);
  // Complete is only the server's word on the copy as it stands; once the
  // last missing thing is typed the list goes, and the button asks again.
  protected readonly summaryState = computed<SummaryState>(() => {
    const outcome = this.outcome();
    if (outcome === 'failed') return 'failed';
    if (this.problems().errors.length > 0)
      return this.asked() ? 'missing' : null;
    const fresh = this.serverCheck()?.of === this.judged();
    return outcome === 'complete' && fresh ? 'complete' : null;
  });
  protected readonly mobile = computed(
    () => this.details().businessKind === 'mobile',
  );
  // The catalogue names step 3 has looked up, for step 2's job rows.
  protected readonly knownJobs = signal<ReadonlyMap<string, JobTypeDto>>(
    new Map(),
  );
  protected readonly current = signal(1);
  protected readonly open = signal(false);
  protected readonly prefix = computed(() =>
    this.i18n.language() === 'ro' ? 'pasul-' : 'step-',
  );
  protected readonly barText = computed(() =>
    this.i18n.t('public.listing.bar', {
      label: this.i18n.t(STEPS[this.current() - 1].label),
      n: this.current(),
    }),
  );

  constructor() {
    // A brand step 2 no longer takes keeps no price range in step 3.
    effect(() => {
      const prices = this.prices();
      if (!prices) return;
      const kept = dropUntaken(
        prices,
        this.takenBrands().map((b) => b.brandId),
      );
      if (kept !== prices) this.keeper.section('3', kept);
    });
    // A job step 3 no longer lists keeps no unticked record in step 2.
    effect(() => {
      const section = this.brands();
      const brands = dropUnlisted(
        section.brands,
        jobsOf(this.prices()?.jobs ?? []).map(refOf),
      );
      if (brands !== section.brands)
        this.keeper.section('2', { ...section, brands });
    });
    effect(() => {
      const done = this.done();
      if (!this.ticked) return;
      for (const step of done) {
        if (this.ticked.has(step)) continue;
        this.ticked.add(step);
        untracked(() => this.consent.track('listing_step_completed', { step }));
      }
    });
    // The e-mail, CUI and RAR fields this page holds mark their steps too.
    effect(() => {
      const { cui, email, rarNumber } = this.fieldErrors();
      const shows = (message: FieldMessage | null) =>
        !!message && !message.warning;
      this.mark('email', shows(email));
      this.mark('step6', shows(cui) || shows(rarNumber));
    });
    // An account that already owns a garage has nothing to fill in here.
    effect(() => {
      const me = this.session.current();
      if (!ownedGarage(me) || this.sending || this.ownerShown) return;
      this.ownerShown = true;
      untracked(() => void this.showOwned(me?.role));
    });
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const onScroll = () => {
        if (!this.held) this.follow();
        else if (!('onscrollend' in window)) this.restartQuiet();
        // The jump has started: its scroll end lets go, not the stall.
        else clearTimeout(this.quiet);
      };
      // A resize is no movement of the jump's: it never restarts the quiet time.
      const onResize = () => {
        if (!this.held) this.follow();
      };
      const onScrollEnd = () => this.release();
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onResize, { passive: true });
      window.addEventListener('scrollend', onScrollEnd, { passive: true });
      destroyRef.onDestroy(() => {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onResize);
        window.removeEventListener('scrollend', onScrollEnd);
        clearTimeout(this.quiet);
      });
      this.follow();
      const link = this.route.snapshot.queryParamMap.get('draft') ?? undefined;
      void this.keeper.open(link).then((step) => this.restore(step));
      void this.session.load({ keepLanguage: true });
    });
  }

  private async showOwned(role: string | undefined) {
    if (role !== 'garage')
      await this.session.switchRole('garage').catch(() => undefined);
    this.statusView.set({ sent: null });
  }

  // The fields show what was typed until they are left; the values below
  // are the stored ones.
  protected readonly shown = signal<Step6Values>({ cui: '', rarNumber: '' });
  private readonly watch = new FieldWatch();
  private readonly stored = computed(() => readStep6(this.keeper.draft().data));
  // The e-mail, CUI and RAR number fields the page holds itself.
  protected readonly fieldErrors = computed(() => {
    const check = this.problems();
    const all = this.asked();
    const { cui, rarNumber } = this.stored();
    const message = (field: string, filled: boolean) =>
      this.watch.message(check, field, { all, filled });
    const saving = this.keeper.emailError();
    return {
      cui: message('steps.6.cui', cui !== ''),
      email: saving
        ? { key: `public.listing.${saving}`, warning: false }
        : message('email', !!this.keeper.draft().email?.trim()),
      rarNumber: message('steps.6.rarNumber', rarNumber !== ''),
    };
  });
  protected readonly verified = computed(() => {
    const { cui, rarNumber } = this.stored();
    const data = this.keeper.draft().data as ListingDraftData;
    return completedCount([
      isValidCui(cui),
      rarNumber.length >= RAR_NUMBER_MIN,
      documentDone(data, 'onrc_certificate'),
      documentDone(data, 'rar_authorisation'),
      declarationDone(data),
    ]);
  });

  protected fillCui(value: string) {
    this.watch.type('steps.6.cui');
    this.fill6({ ...this.stored(), cui: stripCui(value) });
  }

  protected fillRar(value: string) {
    this.watch.type('steps.6.rarNumber');
    this.fill6({ ...this.stored(), rarNumber: normaliseRarNumber(value) });
  }

  // An emptied field leaves no key behind in the draft.
  private fill6({ cui, rarNumber }: Step6Values) {
    this.keeper.section('6', {
      ...(cui && { cui }),
      ...(rarNumber && { rarNumber }),
    });
  }

  protected leave(input: HTMLInputElement, key: keyof Step6Values) {
    const value = this.stored()[key];
    input.value = value;
    this.shown.update((shown) => ({ ...shown, [key]: value }));
    this.watch.leave(`steps.6.${key}`);
  }

  protected typeEmail(value: string) {
    this.watch.type('email');
    this.keeper.type(value);
  }

  protected leaveEmail() {
    this.watch.leave('email');
    this.keeper.leaveEmail();
  }

  // A part of the page tells whether a field of its shows an error.
  protected mark(part: Part, on: boolean) {
    if (!!this.shownErrors()[part] !== on)
      this.shownErrors.update((shown) => ({ ...shown, [part]: on }));
  }

  // The button: what is missing at once when the page knows it, else the
  // server's judgement of the copy it holds once everything typed is on it.
  // Focus stays on the button unless something is missing.
  protected async send() {
    if (this.inFlight()) return;
    this.outcome.set(null);
    if (this.ownCheck().errors.length > 0) {
      this.asked.set(true);
      this.toSummary();
      return;
    }
    // What the server judges is the copy as it stood at the press; a change
    // typed while it answers makes the answer stale.
    const of = this.judged();
    this.inFlight.set(true);
    // The keeper answers a failed call as `failed`; it never rejects.
    let result: Awaited<ReturnType<DraftKeeper['check']>>;
    try {
      result = await this.keeper.check();
    } finally {
      this.inFlight.set(false);
    }
    if (result.kind === 'failed') {
      this.outcome.set('failed');
      return;
    }
    const errors = result.kind === 'incomplete' ? result.errors : [];
    this.serverCheck.set({ check: { errors, warnings: result.warnings }, of });
    this.asked.set(errors.length > 0);
    if (errors.length === 0) {
      this.outcome.set('complete');
      this.consent.track('listing_submitted');
      this.focusAfterRender('mf-missing-summary .complete');
    } else this.toSummary();
  }

  protected openSurvey() {
    this.outcome.set(null);
    this.surveyOpen.set(true);
    this.focusAfterRender('mf-signup-survey h1');
  }

  protected closeSurvey() {
    this.surveyOpen.set(false);
    this.focusAfterRender('.actions .send');
  }

  protected answerSurvey(section: SurveySection) {
    this.finishNotice.set(null);
    this.keeper.survey(section);
  }

  // The create press: the answers go onto the server copy, the account is
  // made or signed in to, and the listing is sent under it.
  protected async finish() {
    if (this.finishing()) return;
    this.finishing.set(true);
    this.finishNotice.set(null);
    this.sendState.set(null);
    let saved = false;
    try {
      saved = await this.keeper.flush();
    } finally {
      this.finishing.set(false);
    }
    this.finishNotice.set(saved ? 'saved' : 'failed');
    if (!saved) return;
    if (!this.surveyTracked) {
      this.surveyTracked = true;
      this.consent.track('survey_completed');
    }
    this.sending = true;
    if (await this.signedIn()) await this.submit();
    else this.sending = false;
  }

  // A session, from before or from the sign-up dialog with the step 1
  // address; a closed dialog leaves the owner on the summary.
  private async signedIn(): Promise<boolean> {
    if (await this.session.load({ keepLanguage: true })) return true;
    const { data, email } = this.keeper.draft();
    const joined = await this.signIn.join({
      email: email ?? '',
      name: (data as ListingDraftData).declaredByName ?? '',
    });
    return joined !== null;
  }

  protected async submit() {
    if (this.finishing()) return;
    this.finishing.set(true);
    this.sendState.set(null);
    this.submitKey ??= crypto.randomUUID();
    let outcome: Awaited<ReturnType<DraftKeeper['submit']>>;
    try {
      outcome = await this.keeper.submit(this.submitKey);
    } finally {
      this.finishing.set(false);
    }
    if (outcome.kind === 'sent') await this.sent(outcome.result.status);
    else if (outcome.kind === 'incomplete') this.refusedSend(outcome);
    else this.sendState.set(outcome.kind);
  }

  // The listing is sent whatever the switch does; the next sign-in in the
  // garage role finds it either way.
  private async sent(status: VerificationStageStatus) {
    await this.session.switchRole('garage').catch(() => undefined);
    this.statusView.set({ sent: status });
    this.focusAfterRender('.status-view h1');
  }

  // What the server found missing: a field of the form takes the owner back
  // to it with the list; an answer of the survey keeps them on it.
  private refusedSend(found: {
    errors: FieldProblem[];
    warnings: FieldProblem[];
  }) {
    if (!found.errors.some((problem) => stepOf(problem.field))) {
      this.sendState.set('incomplete');
      return;
    }
    this.serverCheck.set({ check: found, of: this.judged() });
    this.asked.set(true);
    this.outcome.set(null);
    this.surveyOpen.set(false);
    this.toSummary();
  }

  private focusAfterRender(selector: string) {
    afterNextRender(
      () => this.host.querySelector<HTMLElement>(selector)?.focus(),
      { injector: this.injector },
    );
  }

  // The page jumps to the first step with an error, and focus goes to the
  // summary without scrolling the page again.
  private toSummary() {
    const first = this.stepProblems().findIndex((p) => p.errors.length > 0);
    if (first >= 0) this.show(first + 1);
    afterNextRender(
      () =>
        this.summary()
          ?.nativeElement.querySelector<HTMLElement>('[tabindex="-1"]')
          ?.focus({ preventScroll: true }),
      { injector: this.injector },
    );
  }

  // A summary item: its step marked current, any closed part around the
  // field opened, and the field focused in view.
  protected goTo(field: string) {
    const step = stepOf(field);
    if (!step) return;
    const target = [
      ...this.host.querySelectorAll<HTMLElement>('[data-field]'),
    ].find((element) => element.dataset['field'] === field);
    if (!target) {
      this.jump(step);
      return;
    }
    for (
      let details = target.closest('details');
      details;
      details = details.parentElement?.closest('details') ?? null
    )
      details.open = true;
    this.open.set(false);
    this.tapped = step;
    this.current.set(step);
    this.keeper.stepTo(step);
    target.focus({ preventScroll: true });
    target.scrollIntoView({
      behavior: this.reduced() ? 'auto' : 'smooth',
      block: 'center',
    });
  }

  protected readonly noteText = computed(() => {
    const note = this.keeper.note();
    return note ? this.i18n.t(`public.listing.${note.key}`, note.params) : '';
  });

  // Step 5 shares its section with other stories' keys, which stay.
  protected keepHours(value: HoursSection) {
    const data = this.keeper.draft().data as ListingDraftData;
    this.keeper.section('5', mergeHours(data.steps?.['5'], value));
  }

  protected keepPlace(place: PlaceSection) {
    const data = this.keeper.draft().data as ListingDraftData;
    this.keeper.section('5', { ...data.steps?.['5'], place });
  }

  protected save() {
    if (this.keeper.pressSave()) this.field()?.nativeElement.focus();
  }

  protected startAgain() {
    this.restore(this.keeper.startAgain());
  }

  protected outside(event: Event) {
    const nav = this.nav()?.nativeElement;
    if (this.open() && nav && !nav.contains(event.target as Node))
      this.open.set(false);
  }

  protected close() {
    if (!this.open()) return;
    this.open.set(false);
    this.bar()?.nativeElement.focus();
  }

  protected jump(n: number) {
    this.open.set(false);
    this.show(n)?.focus({ preventScroll: true });
  }

  // Back at the step the draft was left on, once the form is on the page.
  private restore(step: number | null) {
    this.ticked = new Set(this.done());
    this.shown.set(this.stored());
    const answers = Object.values(this.surveyAnswers());
    this.surveyOpen.set(answers.some((answer) => answer !== undefined));
    if (this.surveyOpen()) return;
    if (step && step > 1)
      afterNextRender(() => this.show(step), { injector: this.injector });
  }

  private show(n: number) {
    this.tapped = n;
    this.current.set(n);
    this.keeper.stepTo(n);
    const heading = this.headings()[n - 1];
    if (!heading) return heading;
    clearTimeout(this.quiet);
    // A jump that will not move the page fires no scroll, so it holds nothing.
    const target = jumpTarget(
      heading.getBoundingClientRect().top,
      Number.parseFloat(getComputedStyle(heading).scrollMarginTop) || 0,
      window.scrollY,
      document.documentElement.scrollHeight,
      window.innerHeight,
    );
    this.held = Math.abs(target - window.scrollY) >= 1;
    if (this.held) this.quiet = setTimeout(() => this.release(), STALL_MS);
    heading.scrollIntoView({
      behavior: this.reduced() ? 'auto' : 'smooth',
      block: 'start',
    });
    return heading;
  }

  // The end of a scroll only lets go: the step jumped to stays marked, so the
  // next scroll is judged by whether its heading is still on screen.
  private release() {
    clearTimeout(this.quiet);
    this.held = false;
  }

  private restartQuiet() {
    clearTimeout(this.quiet);
    this.quiet = setTimeout(() => this.release(), QUIET_MS);
  }

  private follow() {
    const bar = this.bar()?.nativeElement;
    const nav = this.nav()?.nativeElement;
    if (!bar || !nav) return;
    // On a phone the headings pass under the bar; on a desktop, under the top
    // of the sticky list.
    const line =
      getComputedStyle(bar).display === 'none'
        ? nav.getBoundingClientRect().top
        : bar.getBoundingClientRect().bottom;
    const root = document.documentElement;
    // A page that does not scroll is at its top, not at its end.
    const atEnd =
      window.scrollY > 0 &&
      window.innerHeight + window.scrollY >= root.scrollHeight - 1;
    const tops = this.headings().map((h) => h.getBoundingClientRect().top);
    let step = currentStep(tops, line + 1, atEnd);
    const tapped = this.tapped;
    if (tapped && keepsTapped(step, tapped, tops[tapped - 1], innerHeight))
      step = tapped;
    else this.tapped = null;
    this.current.set(step);
    this.keeper.stepTo(step);
  }

  private headings() {
    return [...this.host.querySelectorAll<HTMLElement>('section h2')];
  }
}
