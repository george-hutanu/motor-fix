import { isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  effect,
  inject,
  input,
  PLATFORM_ID,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@motor-fix/i18n';
import { Layout } from '@motor-fix/ui-cockpit';

import { takesText } from '../../tab-bar/tab-bar';

type SheetPosition = 'low' | 'half' | 'full';

const NEXT: Record<SheetPosition, SheetPosition> = {
  full: 'low',
  half: 'full',
  low: 'half',
};

// The list over the map on a phone, resting low, half or full. From a tablet
// up it draws nothing of its own and its content sits in the page.
@Component({
  host: {
    '(document:focusin)': 'typing.set(takesText($event.target))',
    '(document:focusout)': 'typing.set(false)',
    '(window:popstate)': 'popped()',
    '[attr.data-position]': 'position()',
    '[class.typing]': 'typing()',
    '[style.--sheet-top.px]': 'top()',
    '[style.--sheet-y.px]': 'dragY()',
  },
  imports: [TranslatePipe],
  selector: 'mf-results-sheet',
  styleUrl: './results-sheet.css',
  templateUrl: './results-sheet.html',
})
export class ResultsSheet {
  // The map failed: the list takes the screen, with no history step.
  readonly forcedFull = input(false);

  private readonly layout = inject(Layout);
  protected readonly phone = computed(() => this.layout.current() === 'phone');
  protected readonly position = signal<SheetPosition>('half');
  protected readonly typing = signal(false);
  protected readonly takesText = takesText;
  protected readonly dragY = signal<number | null>(null);
  protected readonly top = signal<number | null>(null);

  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly host =
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly topBox = viewChild<ElementRef<HTMLElement>>('top');
  private readonly body = viewChild<ElementRef<HTMLElement>>('body');
  private grabbed: { pointer: number; from: number; y: number } | null = null;
  private dragged = false;
  // The history entry this sheet added when the visitor took it full.
  private stepped = false;

  constructor() {
    effect(() => {
      if (this.forcedFull()) untracked(() => this.position.set('full'));
    });
    // Across 768 px the sheet starts again at half.
    let wasPhone: boolean | undefined;
    effect(() => {
      const phone = this.phone();
      if (wasPhone !== undefined && phone !== wasPhone)
        untracked(() => {
          // A forced full is the page's, so it adds no step.
          if (this.forcedFull()) this.position.set('full');
          else this.rest('half');
        });
      wasPhone = phone;
    });
    afterNextRender(() => this.measure());
  }

  raise() {
    if (untracked(this.position) === 'low') this.position.set('half');
  }

  toTop(smooth: boolean) {
    this.body()?.nativeElement.scrollTo({
      behavior: smooth ? 'smooth' : 'auto',
      top: 0,
    });
  }

  // A pointer-led click follows a drag on the handle; only a press moves it.
  protected press(event: MouseEvent) {
    if (event.detail > 0 && this.dragged) return;
    this.rest(NEXT[untracked(this.position)]);
  }

  // On a phone the handle and the header's own space drag; a control in it
  // never does.
  protected grab(event: PointerEvent) {
    const target = event.target as HTMLElement;
    const handle = target.closest('button.handle');
    const own =
      handle ||
      !target.closest('button, a, input, mf-brand-chips, mf-brand-search');
    if (event.button !== 0 || this.grabbed || !own || !untracked(this.phone))
      return;
    // The click after a held pointer goes to the holder: the handle holds its
    // own, so a press still reaches it.
    (handle ?? (event.currentTarget as HTMLElement)).setPointerCapture(
      event.pointerId,
    );
    this.measure();
    this.dragged = false;
    this.grabbed = {
      from: this.offsets()[untracked(this.position)],
      pointer: event.pointerId,
      y: event.clientY,
    };
  }

  protected pull(event: PointerEvent) {
    const grabbed = this.grabbed;
    if (event.pointerId !== grabbed?.pointer) return;
    const { low } = this.offsets();
    this.dragY.set(
      Math.min(low, Math.max(0, grabbed.from + event.clientY - grabbed.y)),
    );
  }

  // Under a tenth of the screen the sheet goes back; otherwise it rests at
  // the position nearest to where it was let go.
  protected release(event: PointerEvent) {
    const grabbed = this.grabbed;
    if (event.pointerId !== grabbed?.pointer) return;
    this.grabbed = null;
    const travel = event.clientY - grabbed.y;
    this.dragY.set(null);
    // A finger's few pixels of slop are still a press.
    this.dragged = Math.abs(travel) > 8;
    if (Math.abs(travel) < window.innerHeight / 10) return;
    const at = grabbed.from + travel;
    const offsets = this.offsets();
    const nearest = (Object.keys(offsets) as SheetPosition[]).reduce((a, b) =>
      Math.abs(offsets[b] - at) < Math.abs(offsets[a] - at) ? b : a,
    );
    this.rest(nearest);
  }

  protected letGo(event: PointerEvent) {
    if (event.pointerId !== this.grabbed?.pointer) return;
    this.grabbed = null;
    this.dragY.set(null);
  }

  // The back button from full: the step the sheet added is gone.
  protected popped() {
    if (!this.stepped) return;
    this.stepped = false;
    this.position.set('half');
  }

  // The visitor's own move: full adds one history step at this address,
  // and leaving full goes back over it.
  private rest(next: SheetPosition) {
    const was = untracked(this.position);
    this.position.set(next);
    if (!this.browser || next === was) return;
    this.measure();
    if (next === 'full') {
      history.pushState({ ...history.state, mfSheet: true }, '');
      this.stepped = true;
    } else if (this.stepped) {
      this.stepped = false;
      // An address the page pushed since sits on top of the step: leave it.
      if (history.state?.mfSheet) history.back();
    }
  }

  private offsets(): Record<SheetPosition, number> {
    const height = this.host.offsetHeight;
    return {
      full: 0,
      half: height / 2,
      low: height - (untracked(this.top) ?? 0),
    };
  }

  private measure() {
    this.top.set(this.topBox()?.nativeElement.offsetHeight ?? null);
  }
}
