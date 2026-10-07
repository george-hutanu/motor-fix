import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { I18n, LanguageSwitch, TranslatePipe } from '@motor-fix/i18n';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';

import { currentStep, STEPS } from './steps';

// How long the page must be still after a tap before the scroll position
// decides the current step again: a smooth jump fires scroll events on the way.
const SETTLE_MS = 150;

// The page the owner fills in to list a garage: six steps on one long page,
// with the list of steps beside them, or in a bar on a phone.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'outside($event)' },
  imports: [LanguageSwitch, TranslatePipe],
  selector: 'mf-list-your-garage',
  styles: `
    :host { display: block; padding: var(--mf-space-4); }
    header { display: flex; justify-content: flex-end; }
    h1, h2, p { margin: 0; overflow-wrap: anywhere; }
    .label { font: var(--mf-font-label); font-size: var(--mf-size-label); letter-spacing: var(--mf-label-tracking); color: var(--mf-text-secondary); }
    .intro { margin-top: var(--mf-space-2); color: var(--mf-text-secondary); }
    .page { display: grid; gap: var(--mf-space-4); margin-top: var(--mf-space-4); }
    .sections { display: grid; gap: var(--mf-space-4); min-width: 0; }
    section { scroll-margin-top: calc(var(--mf-tap) + var(--mf-space-2)); }
    h2:focus-visible, nav button:focus-visible { outline: 2px solid var(--mf-focus); outline-offset: 2px; }
    .mark { font-weight: normal; color: var(--mf-text-secondary); }
    ol { margin: 0; padding: 0; list-style: none; }
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
      section { scroll-margin-top: var(--mf-space-4); }
    }
    @media not all and (min-width: 768px) {
      nav { position: sticky; top: 0; z-index: 1; margin: 0 calc(-1 * var(--mf-space-4)); background: var(--mf-bg); border-bottom: 1px solid var(--mf-line); }
      .bar {
        display: block; width: 100%; min-height: var(--mf-tap); padding: 0 var(--mf-space-4);
        border: 0; background: none; color: inherit; font: inherit; font-size: var(--mf-size-small);
        text-align: start; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer;
      }
      ol { display: none; max-height: calc(100dvh - 2 * var(--mf-tap)); overflow-y: auto; padding-bottom: var(--mf-space-2); }
      nav.open ol { display: block; }
    }
  `,
  template: `
    <header><mf-language-switch /></header>
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
          </section>
        }
      </div>
    </div>
  `,
})
export class ListYourGarage {
  private readonly i18n = inject(I18n);
  private readonly reduced = inject(REDUCED_MOTION);
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;
  private readonly nav = viewChild.required<ElementRef<HTMLElement>>('nav');
  private readonly bar = viewChild.required<ElementRef<HTMLElement>>('bar');
  private settling: ReturnType<typeof setTimeout> | undefined;

  protected readonly steps = STEPS;
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
    });
  }

  protected outside(event: Event) {
    if (this.open() && !this.nav().nativeElement.contains(event.target as Node))
      this.open.set(false);
  }

  protected close() {
    if (!this.open()) return;
    this.open.set(false);
    this.bar().nativeElement.focus();
  }

  protected jump(n: number) {
    this.current.set(n);
    this.open.set(false);
    this.settle();
    const heading = this.headings()[n - 1];
    heading.scrollIntoView({
      behavior: this.reduced() ? 'auto' : 'smooth',
      block: 'start',
    });
    heading.focus({ preventScroll: true });
  }

  private settle() {
    clearTimeout(this.settling);
    this.settling = setTimeout(() => {
      this.settling = undefined;
    }, SETTLE_MS);
  }

  private follow() {
    const bar = this.bar().nativeElement;
    // On a phone the headings pass under the bar; on a desktop, under the top
    // of the sticky list.
    const line =
      getComputedStyle(bar).display === 'none'
        ? this.nav().nativeElement.getBoundingClientRect().top
        : bar.getBoundingClientRect().bottom;
    const root = document.documentElement;
    // A page that does not scroll is at its top, not at its end.
    const atEnd =
      window.scrollY > 0 &&
      window.innerHeight + window.scrollY >= root.scrollHeight - 1;
    this.current.set(
      currentStep(
        this.headings().map((h) => h.getBoundingClientRect().top),
        line + 1,
        atEnd,
      ),
    );
  }

  private headings() {
    return [...this.host.querySelectorAll<HTMLElement>('section h2')];
  }
}
