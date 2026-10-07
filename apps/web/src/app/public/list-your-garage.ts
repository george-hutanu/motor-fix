import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  Injector,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  isValidCui,
  normaliseRarNumber,
  RAR_NUMBER_MIN,
  stripCui,
} from '@motor-fix/contracts/listing-verification';
import { I18n, LanguageSwitch, TranslatePipe } from '@motor-fix/i18n';
import { HlmButton, HlmInput, REDUCED_MOTION } from '@motor-fix/ui-cockpit';

import { brandsOf } from './brands-section';
import { BrandsStep } from './brands-step';
import { DraftKeeper } from './draft-keeper';
import {
  completedCount,
  cuiError,
  rarError,
  readStep6,
  type Step6Values,
} from './step6';
import { currentStep, STEPS } from './steps';
import { SignInDialog } from '../sign-in/sign-in-dialog';

// How long the page must be still after a tap before the scroll position
// decides the current step again: a smooth jump fires scroll events on the way.
const SETTLE_MS = 150;

// The page the owner fills in to list a garage: six steps on one long page,
// with the list of steps beside them, or in a bar on a phone.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'outside($event)' },
  imports: [BrandsStep, HlmButton, HlmInput, LanguageSwitch, TranslatePipe],
  providers: [DraftKeeper],
  selector: 'mf-list-your-garage',
  styles: `
    :host { display: block; padding: var(--mf-space-4); }
    header { display: flex; justify-content: flex-end; }
    h1, h2, p { margin: 0; overflow-wrap: anywhere; }
    .label { font: var(--mf-font-label); font-size: var(--mf-size-label); letter-spacing: var(--mf-label-tracking); color: var(--mf-text-secondary); }
    .intro { margin-top: var(--mf-space-2); color: var(--mf-text-secondary); }
    .page { display: grid; gap: var(--mf-space-4); margin-top: var(--mf-space-4); }
    .sections { display: grid; gap: var(--mf-space-4); min-width: 0; }
    /* A jump, to a heading or a fragment's section, rests it on the line the scroll spy reads: the bottom of the phone bar. */
    section, h2 { scroll-margin-top: var(--mf-tap); }
    h2:focus-visible, nav button:focus-visible { outline: 2px solid var(--mf-focus); outline-offset: 2px; }
    .mark { font-weight: normal; color: var(--mf-text-secondary); }
    ol { margin: 0; padding: 0; list-style: none; }
    .field { display: grid; gap: var(--mf-space-1); margin-top: var(--mf-space-3); max-width: 28rem; }
    .hint, .note { font-size: var(--mf-size-small); color: var(--mf-text-secondary); }
    .error { font-size: var(--mf-size-small); color: var(--mf-red-ink); }
    .error:empty { display: none; }
    section > .note { margin-top: var(--mf-space-3); }
    .actions { display: flex; flex-wrap: wrap; gap: var(--mf-space-2); }
    .actions button, .ended button { min-height: var(--mf-tap); }
    .ended { display: grid; gap: var(--mf-space-3); justify-items: start; margin-top: var(--mf-space-4); }
    ol button {
      display: flex; align-items: center; gap: var(--mf-space-2); width: 100%; min-height: var(--mf-tap);
      padding: 0 var(--mf-space-3); border: 0; border-radius: var(--mf-radius-control);
      background: none; color: inherit; font: inherit; text-align: start; cursor: pointer;
    }
    ol button[aria-current='step'] { background: var(--mf-amber-tint); color: var(--mf-amber-ink); font-weight: 600; }
    ol button[aria-current='step']::before { content: '▸' / ''; }
    @media (min-width: 768px) {
      .page { grid-template-columns: minmax(12rem, 16rem) 1fr; align-items: start; }
      nav { position: sticky; top: var(--mf-space-4); }
      .bar { display: none; }
      section, h2 { scroll-margin-top: var(--mf-space-4); }
    }
    @media not all and (min-width: 768px) {
      nav { position: sticky; top: 0; z-index: 1; margin: 0 calc(-1 * var(--mf-space-4)); background: var(--mf-bg); border-bottom: 1px solid var(--mf-line); }
      .bar {
        display: block; width: 100%; min-height: var(--mf-tap); padding: 0 var(--mf-space-4);
        border: 0; background: none; color: inherit; font: inherit; font-size: var(--mf-size-small);
        text-align: start; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer;
      }
      /* Over the page, not in it: an open list that took room would push the page down under the reader. */
      ol {
        display: none; position: absolute; top: 100%; left: 0; right: 0;
        max-height: calc(100dvh - 2 * var(--mf-tap)); overflow-y: auto; padding-bottom: var(--mf-space-2);
        background: var(--mf-bg); border-bottom: 1px solid var(--mf-line);
      }
      nav.open ol { display: block; }
    }
  `,
  template: `
    <header><mf-language-switch /></header>
    @switch (keeper.view()) {
      @case ('loading') {
        <p class="intro" role="status">{{ 'public.listing.loading' | t }}</p>
      }
      @case ('invalid') {
        <div class="ended">
          <h1>{{ 'public.listing.invalidTitle' | t }}</h1>
          <p>{{ 'public.listing.invalidLine' | t }}</p>
          <button hlmBtn type="button" (click)="startAgain()">{{ 'public.listing.startAgain' | t }}</button>
        </div>
      }
      @case ('sent') {
        <div class="ended">
          <h1>{{ 'public.listing.sentTitle' | t }}</h1>
          <p>{{ 'public.listing.sentLine' | t }}</p>
          <button hlmBtn type="button" (click)="signIn.start()">{{ 'public.listing.signIn' | t }}</button>
        </div>
      }
      @default {
        <p class="label">{{ 'public.listing.label' | t }}</p>
        <h1>{{ 'public.listing.heading' | t }}</h1>
        <p class="intro">{{ 'public.listing.intro' | t }}</p>
        <div class="page">
          <nav
            #nav
            [attr.aria-label]="'public.listing.steps' | t"
            [class.open]="open()"
            (keydown.escape)="close()"
          >
            <button #bar type="button" class="bar" [attr.aria-expanded]="open()" (click)="open.set(!open())">
              {{ barText() }}
            </button>
            <ol>
              @for (step of steps; track step.n) {
                <li>
                  <button
                    type="button"
                    [attr.aria-current]="current() === step.n ? 'step' : null"
                    (click)="jump(step.n)"
                  >
                    {{ step.n }} {{ step.label | t }}@if (step.mark) {<span class="mark"> · {{ step.mark | t }}</span>}
                  </button>
                </li>
              }
            </ol>
          </nav>
          <div class="sections">
            @for (step of steps; track step.n) {
              <section [id]="prefix() + step.n">
                <h2 tabindex="-1">{{ step.n }} {{ step.label | t }}@if (step.mark) {<span class="mark"> · {{ step.mark | t }}</span>}</h2>
                @if (step.n === 1) {
                  <div class="field">
                    <label for="listing-email">{{ 'public.listing.email' | t }}</label>
                    <input
                      #email
                      hlmInput
                      id="listing-email"
                      type="email"
                      autocomplete="email"
                      [value]="keeper.draft().email ?? ''"
                      [aria-describedby]="keeper.emailError() ? 'listing-email-error' : 'listing-email-hint'"
                      [attr.aria-invalid]="keeper.emailError() ? 'true' : null"
                      (input)="keeper.type(email.value)"
                      (blur)="keeper.leaveEmail()"
                    />
                    <p id="listing-email-hint" class="hint">{{ 'public.listing.emailHint' | t }}</p>
                    @if (keeper.emailError() === 'emailNeeded') {
                      <p id="listing-email-error" class="error">{{ 'public.listing.emailNeeded' | t }}</p>
                    } @else if (keeper.emailError()) {
                      <p id="listing-email-error" class="error">{{ 'public.listing.emailInvalid' | t }}</p>
                    }
                  </div>
                } @else if (step.n === 6) {
                  <p class="note">{{ 'public.listing.verifyIntro' | t }}</p>
                  <div class="field">
                    <!-- maxlength 40 mirrors the draft section's cap in listing-verification -->
                    <label for="listing-cui">{{ 'public.listing.cui' | t }}</label>
                    <input
                      #cui
                      hlmInput
                      id="listing-cui"
                      type="text"
                      inputmode="numeric"
                      autocomplete="off"
                      maxlength="40"
                      [value]="shown().cui"
                      [aria-describedby]="cuiError() ? 'listing-cui-error' : null"
                      [attr.aria-invalid]="cuiError() ? 'true' : null"
                      (input)="fillCui(cui.value)"
                      (blur)="leave(cui, 'cui')"
                    />
                    <p id="listing-cui-error" class="error" role="status" aria-live="polite">{{ cuiError() ? ('public.listing.cuiInvalid' | t) : '' }}</p>
                  </div>
                  <div class="field">
                    <label for="listing-rar">{{ 'public.listing.rarNumber' | t }}</label>
                    <input
                      #rar
                      hlmInput
                      id="listing-rar"
                      type="text"
                      autocomplete="off"
                      maxlength="40"
                      [value]="shown().rarNumber"
                      [aria-describedby]="rarError() ? 'listing-rar-error' : 'listing-rar-hint'"
                      [attr.aria-invalid]="rarError() ? 'true' : null"
                      (input)="fillRar(rar.value)"
                      (blur)="leave(rar, 'rarNumber')"
                    />
                    <p id="listing-rar-hint" class="hint">{{ 'public.listing.rarHint' | t }}</p>
                    <p id="listing-rar-error" class="error" role="status" aria-live="polite">{{ rarError() ? ('public.listing.rarShort' | t) : '' }}</p>
                  </div>
                  <p class="note count" role="status" aria-live="polite">{{ 'public.listing.verifyCount' | t: { n: verified() } }}</p>
                  <p class="note">{{ 'public.listing.verifyNote' | t }}</p>
                }
                @if (step.n === 2) {
                  <mf-brands-step [value]="brands()" (valueChange)="keeper.section('2', $event)" />
                }
              </section>
            }
            <div class="actions">
              <button hlmBtn variant="secondary" type="button" (click)="save()">{{ 'public.listing.save' | t }}</button>
            </div>
            <p class="note" role="status" aria-live="polite">{{ noteText() }}</p>
          </div>
        </div>
      }
    }
  `,
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

  protected readonly keeper = inject(DraftKeeper);
  protected readonly signIn = inject(SignInDialog);
  protected readonly steps = STEPS;
  // The draft's steps['2'], kept and restored with the rest of the form.
  protected readonly brands = computed(() =>
    brandsOf(this.keeper.draft().data),
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
    const step = currentStep(
      this.headings().map((h) => h.getBoundingClientRect().top),
      line + 1,
      atEnd,
    );
    this.current.set(step);
    this.keeper.stepTo(step);
  }

  private headings() {
    return [...this.host.querySelectorAll<HTMLElement>('section h2')];
  }
}
