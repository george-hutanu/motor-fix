import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  Injector,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';
import { filter } from 'rxjs';

const HOW_IT_WORKS = 'how-it-works';

// A fixed illustration, not a garage's figure.
const RATE = 180;
const ROLL_MS = 1200;
// How long the jump follows a page still growing under it.
const FOLLOW_MS = 3000;
const TAKEN_OVER = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
const TAKEN = ['BMW', 'Mercedes-Benz', 'Volkswagen'];
const REFUSED = ['Dacia', 'Tesla'];

// Home's three promises. The hourly rate rolls up from 0 the first time the
// section comes into view; under reduced motion, on the server and where the
// browser cannot tell what is in view it shows its final figure. The site
// bar's "Cum funcționează" opens Home at this section and gives it focus.
@Component({
  imports: [TranslatePipe],
  selector: 'mf-how-it-works',
  styleUrl: './how-it-works.css',
  templateUrl: './how-it-works.html',
})
export class HowItWorks {
  private readonly i18n = inject(I18n);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly reduced = inject(REDUCED_MOTION);
  private readonly section =
    viewChild.required<ElementRef<HTMLElement>>('section');
  protected readonly taken = TAKEN;
  protected readonly refused = REFUSED;
  protected readonly figure = signal(RATE);
  protected readonly label = computed(() =>
    this.i18n.t('public.home.how.prices.label', {
      garage: this.i18n.t('public.home.how.prices.garage'),
      rate: RATE,
    }),
  );
  private frame = 0;
  private stopFollowing?: () => void;

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      this.jumpIfAsked();
      if (this.reduced() || typeof IntersectionObserver === 'undefined') return;
      this.figure.set(0);
      const observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        this.roll();
      });
      observer.observe(this.section().nativeElement);
      destroy.onDestroy(() => {
        observer.disconnect();
        cancelAnimationFrame(this.frame);
      });
    });
    destroy.onDestroy(() => this.stopFollowing?.());
    // Followed on Home itself, the link navigates to the same address again.
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        afterNextRender(() => this.jumpIfAsked(), { injector: this.injector });
      });
  }

  private jumpIfAsked() {
    if (this.router.parseUrl(this.router.url).fragment !== HOW_IT_WORKS) return;
    const section = this.section().nativeElement;
    const jump = () =>
      section.scrollIntoView({
        behavior: this.reduced() ? 'auto' : 'smooth',
        block: 'start',
      });
    jump();
    section.focus({ preventScroll: true });
    this.follow(section.ownerDocument, jump);
  }

  // Arriving from another screen, Home is still growing under the section
  // (its later parts render after the first frame), and the browser stops the
  // scroll at the page's end as it was, short of the section. Until the page
  // settles, or the person scrolls, types or taps, jump again as it grows.
  private follow(document: Document, jump: () => void) {
    this.stopFollowing?.();
    const window = document.defaultView;
    if (!window || typeof window.ResizeObserver === 'undefined') return;
    let height = document.body.getBoundingClientRect().height;
    const observer = new window.ResizeObserver((entries) => {
      const grown = entries[0]?.contentRect.height ?? 0;
      if (grown <= height) return;
      height = grown;
      jump();
    });
    const stop = () => {
      observer.disconnect();
      window.clearTimeout(timer);
      for (const type of TAKEN_OVER) window.removeEventListener(type, stop);
      this.stopFollowing = undefined;
    };
    const timer = window.setTimeout(stop, FOLLOW_MS);
    for (const type of TAKEN_OVER)
      window.addEventListener(type, stop, { passive: true });
    observer.observe(document.body);
    this.stopFollowing = stop;
  }

  private roll() {
    const start = performance.now();
    const step = () => {
      if (this.reduced()) {
        this.figure.set(RATE);
        return;
      }
      const done = Math.min(1, (performance.now() - start) / ROLL_MS);
      this.figure.set(Math.round(RATE * (1 - (1 - done) ** 3)));
      if (done < 1) this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }
}
