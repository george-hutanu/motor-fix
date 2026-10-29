import {
  ChangeDetectionStrategy,
  Component,
  computed,
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
}

export interface SectionsPanelData {
  // The prefix of the panel's texts: `.line`, `.done` and `.saveFailed`.
  messages: string;
  // Read live, so an open panel follows a change made elsewhere.
  rows: () => readonly PanelRow[];
  // Applies and saves one switch; false when the save failed and the rows
  // show the previous state again.
  toggle: (key: string, shown: boolean) => Promise<boolean>;
}

// "Alege ce vezi pe panou" for any dashboard: one switch per section, each
// saved at once, so closing never asks about changes.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmSwitch, TranslatePipe],
  selector: 'mf-dashboard-sections-panel',
  styleUrl: './dashboard-sections-panel.css',
  templateUrl: './dashboard-sections-panel.html',
})
export class DashboardSectionsPanel {
  protected readonly task = injectOverlayTask<SectionsPanelData, 'done'>();
  protected readonly text = {
    done: `${this.task.data.messages}.done`,
    line: `${this.task.data.messages}.line`,
    saveFailed: `${this.task.data.messages}.saveFailed`,
  };
  protected readonly rows = computed(() => this.task.data.rows());
  protected readonly pending = signal<ReadonlySet<string>>(new Set());
  protected readonly failed = signal(false);

  protected async flip(key: string, shown: boolean, control: HlmSwitch) {
    this.pending.update((keys) => new Set(keys).add(key));
    const saved = await this.task.data.toggle(key, shown).catch(() => false);
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
}
