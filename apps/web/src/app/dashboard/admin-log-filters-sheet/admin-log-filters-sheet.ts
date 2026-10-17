import { Component, inject, signal, viewChild } from '@angular/core';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { LogPickers } from '../admin-log-filters/log-pickers/log-pickers';
import type { LogChoice } from '../admin-log-view/narrowing';

// The phone's log filters: "Aplică" closes with the choice once its dates
// are right, Escape or the close button with no change.
@Component({
  imports: [HlmButton, LogPickers, TranslatePipe],
  selector: 'mf-admin-log-filters-sheet',
  styleUrl: './admin-log-filters-sheet.css',
  templateUrl: './admin-log-filters-sheet.html',
})
export class AdminLogFiltersSheet {
  protected readonly task = injectOverlayTask<LogChoice, LogChoice>();
  private readonly pickers = viewChild.required(LogPickers);
  protected readonly chosen = signal<LogChoice>(this.task.data);

  constructor() {
    void inject(I18n).enter('admin');
  }

  protected apply() {
    if (!this.pickers().fault()) this.task.close(this.chosen());
  }
}
