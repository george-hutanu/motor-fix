import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  Injector,
  inject,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask } from '@motor-fix/overlays';
import { HlmButton, HlmSwitch } from '@motor-fix/ui-cockpit';

export interface PanelRow {
  key: string;
  // The row's place in the list, from 1.
  position: number;
  name: string;
  description: string;
  shown: boolean;
  // The switch's name when it differs from the section's ("Hide: …").
  label?: string;
}

export interface SectionsPanelData {
  // The prefix of the panel's texts: `.line`, `.done` and `.saveFailed`.
  messages: string;
  // Read live, so an open panel follows a change made elsewhere.
  rows: () => readonly PanelRow[];
  // Applies and saves one switch; false when the save failed and the rows
  // show the previous state again.
  toggle: (key: string, shown: boolean) => Promise<boolean>;
  // Given only by a dashboard whose sections can be reordered and reset
  // (`.moveUp`, `.moveDown` and `.reset` texts): each applies at once and
  // resolves false when the save failed and the rows are back as saved.
  move?: (key: string, direction: 'up' | 'down') => Promise<boolean>;
  reset?: () => Promise<boolean>;
}

// "Alege ce vezi pe panou" for any dashboard: one switch per section, and
// arrows and a reset when the dashboard offers them, each saved at once, so
// closing never asks about changes.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmSwitch, TranslatePipe],
  selector: 'mf-dashboard-sections-panel',
  styleUrl: './dashboard-sections-panel.css',
  templateUrl: './dashboard-sections-panel.html',
})
export class DashboardSectionsPanel {
  protected readonly task = injectOverlayTask<SectionsPanelData, 'done'>();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly text = {
    done: `${this.task.data.messages}.done`,
    line: `${this.task.data.messages}.line`,
    moveDown: `${this.task.data.messages}.moveDown`,
    moveUp: `${this.task.data.messages}.moveUp`,
    reset: `${this.task.data.messages}.reset`,
    saveFailed: `${this.task.data.messages}.saveFailed`,
  };
  protected readonly moves = this.task.data.move !== undefined;
  protected readonly rows = computed(() => this.task.data.rows());
  protected readonly pending = signal<ReadonlySet<string>>(new Set());
  protected readonly failed = signal(false);

  protected async flip(key: string, shown: boolean, control: HlmSwitch) {
    this.pending.update((keys) => new Set(keys).add(key));
    const saved = await this.task.data.toggle(key, shown);
    this.pending.update((keys) => {
      const left = new Set(keys);
      left.delete(key);
      return left;
    });
    this.failed.set(!saved);
    // The switch flipped itself; a failed save left the row as it was.
    const row = this.rows().find((each) => each.key === key);
    if (row) control.checked.set(row.shown);
  }

  protected async shift(key: string, direction: 'up' | 'down') {
    const move = this.task.data.move;
    if (!move) return;
    const saved = move(key, direction);
    this.refocus(key, direction);
    this.failed.set(!(await saved));
    this.refocus(key, direction);
  }

  protected async reset() {
    const reset = this.task.data.reset;
    if (reset) this.failed.set(!(await reset()));
  }

  // The row's buttons move with it in the page, which drops their focus:
  // it goes back to the pressed arrow, or the other one at an end.
  private refocus(key: string, direction: 'up' | 'down') {
    afterNextRender(
      () => {
        const row = [
          ...this.host.nativeElement.querySelectorAll('[data-row]'),
        ].find((each) => each.getAttribute('data-key') === key);
        const arrows = [
          ...(row?.querySelectorAll<HTMLButtonElement>('[data-move]') ?? []),
        ];
        const pressed = arrows.find(
          (each) => each.dataset['move'] === direction,
        );
        (pressed?.disabled
          ? arrows.find((each) => !each.disabled)
          : pressed
        )?.focus();
      },
      { injector: this.injector },
    );
  }
}
