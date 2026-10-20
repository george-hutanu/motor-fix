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
// The map's two 44 px zoom buttons and their 10 px margin, as 6.5rem in the
// stylesheet: half never rests over them.
const ZOOM_CLEAR = 104;

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
  // On a marked step this sheet did not add (reached by forward or a reload):
  // a back over it goes one further, so it leaves the page as before.
  private stale = false;
  // Where that step sits in the session history, when the browser says.
  private staleAt: number | undefined;

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
    if (this.browser && history.state?.mfSheet) this.markStale();
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

  // How far the list is scrolled inside the sheet; nothing from a tablet up,
  // where the page scrolls instead.
  scrolled(): number {
    return this.body()?.nativeElement.scrollTop ?? 0;
  }

  scrollBack(top: number) {
    this.body()?.nativeElement.scrollTo({ top });
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

  // The back button from full: the step the sheet added is gone. A move off
  // a marked step it did not add goes one further, over the entry under it.
  protected popped() {
    const marked = Boolean(history.state?.mfSheet);
    if (this.stepped) {
      this.stepped = false;
      this.stale = false;
      if (marked) this.markStale();
      this.position.set('half');
      return;
    }
    if (marked) {
      this.markStale();
      return;
    }
    if (!this.stale) return;
    this.stale = false;
    // A forward off that step stays forward.
    const now = entryIndex();
    if (now !== undefined && this.staleAt !== undefined && now > this.staleAt)
      return;
    history.back();
  }

  private markStale() {
    this.stale = true;
    this.staleAt = entryIndex();
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
    const low = height - (untracked(this.top) ?? 0);
    return {
      full: 0,
      half: Math.min(Math.max(height / 2, ZOOM_CLEAR), low),
      low,
    };
  }

  private measure() {
    this.top.set(this.topBox()?.nativeElement.offsetHeight ?? null);
  }
}

// The Navigation API's place in the session history; undefined without it.
function entryIndex(): number | undefined {
  const at = (
    globalThis as { navigation?: { currentEntry?: { index?: number } | null } }
  ).navigation;
  return at?.currentEntry?.index;
}
