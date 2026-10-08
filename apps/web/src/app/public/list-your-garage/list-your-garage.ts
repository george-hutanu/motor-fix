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
  viewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import type { ListingDraftData } from '@motor-fix/contracts';
import type { HoursSection } from '@motor-fix/contracts/garage-hours';
import {
  detailsComplete,
  isDetailsSection,
  isMechanicsSection,
  isPricesSection,
  mechanicsComplete,
  pricesComplete,
} from '@motor-fix/contracts/listing-sections';
import {
  isValidCui,
  normaliseRarNumber,
  RAR_NUMBER_MIN,
  stripCui,
} from '@motor-fix/contracts/listing-verification';
import { I18n, LanguageSwitch, TranslatePipe } from '@motor-fix/i18n';
import { HlmButton, HlmInput, REDUCED_MOTION } from '@motor-fix/ui-cockpit';

import { SignInDialog } from '../../sign-in/sign-in-dialog';
import { brandsOf } from '../brands-section';
import { BrandsStep } from '../brands-step';
import { DetailsStep } from '../details-step/details-step';
import { DraftKeeper } from '../draft-keeper';
import { hoursOf, mergeHours } from '../hours-section';
import { HoursStep } from '../hours-step';
import { MechanicsStep } from '../mechanics-step/mechanics-step';
import { dropUntaken } from '../prices-step/prices-rows';
import { PricesStep } from '../prices-step/prices-step';
import {
  completedCount,
  cuiError,
  rarError,
  readStep6,
  type Step6Values,
} from '../step6';
import { currentStep, keepsTapped, STEPS } from '../steps';

// How long the page must be still after a tap before the scroll position
// decides the current step again: a smooth jump fires scroll events on the way.
const SETTLE_MS = 150;

// The page the owner fills in to list a garage: six steps on one long page,
// with the list of steps beside them, or in a bar on a phone.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'outside($event)' },
  imports: [
    BrandsStep,
    DetailsStep,
    HlmButton,
    HlmInput,
    HoursStep,
    LanguageSwitch,
    MechanicsStep,
    PricesStep,
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
  private settling: ReturnType<typeof setTimeout> | undefined;
  // The step last jumped to, held while the page cannot bring it to the line.
  private tapped: number | null = null;

  protected readonly keeper = inject(DraftKeeper);
  protected readonly signIn = inject(SignInDialog);
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
  protected readonly takenBrands = computed(() =>
    this.brands().brands.filter((b) => b.stance === 'works_on'),
  );
  // The steps the list ticks, judged as the owner types.
  protected readonly done = computed(() => {
    const prices = this.prices();
    return new Set([
      ...(detailsComplete(this.details()) ? [1] : []),
      ...(prices && pricesComplete(prices) ? [3] : []),
      ...(mechanicsComplete(this.mechanics()) ? [4] : []),
    ]);
  });
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
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const onScroll = () => {
        if (this.settling) this.settle();
        else this.follow();
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll, { passive: true });
      destroyRef.onDestroy(() => {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
        clearTimeout(this.settling);
      });
      this.follow();
      const link = this.route.snapshot.queryParamMap.get('draft') ?? undefined;
      void this.keeper.open(link).then((step) => this.restore(step));
    });
  }

  // The fields show what was typed until they are left; the values below
  // are the stored ones.
  protected readonly shown = signal<Step6Values>({ cui: '', rarNumber: '' });
  private readonly left = signal({ cui: false, rarNumber: false });
  private readonly stored = computed(() => readStep6(this.keeper.draft().data));
  protected readonly cuiError = computed(() =>
    cuiError(this.stored().cui, this.left().cui),
  );
  protected readonly rarError = computed(() =>
    rarError(this.stored().rarNumber, this.left().rarNumber),
  );
  protected readonly verified = computed(() => {
    const { cui, rarNumber } = this.stored();
    return completedCount([
      isValidCui(cui),
      rarNumber.length >= RAR_NUMBER_MIN,
      false,
      false,
      false,
    ]);
  });

  protected fillCui(value: string) {
    this.fill6({ ...this.stored(), cui: stripCui(value) });
  }

  protected fillRar(value: string) {
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
    this.left.update((left) => ({ ...left, [key]: true }));
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
    const stored = this.stored();
    this.shown.set(stored);
    this.left.set({
      cui: stored.cui !== '',
      rarNumber: stored.rarNumber !== '',
    });
    if (step && step > 1)
      afterNextRender(() => this.show(step), { injector: this.injector });
  }

  private show(n: number) {
    this.tapped = n;
    this.current.set(n);
    this.keeper.stepTo(n);
    this.settle();
    const heading = this.headings()[n - 1];
    heading?.scrollIntoView({
      behavior: this.reduced() ? 'auto' : 'smooth',
      block: 'start',
    });
    return heading;
  }

  private settle() {
    clearTimeout(this.settling);
    this.settling = setTimeout(() => {
      this.settling = undefined;
    }, SETTLE_MS);
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
