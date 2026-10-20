import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { CatalogueService, type JobTypeDto } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask, type OverlayResult } from '@motor-fix/overlays';
import { HlmButton, HlmInput, HlmLabel } from '@motor-fix/ui-cockpit';

export interface JobPickerData {
  // The jobs already on the list, which the search leaves out.
  listed: readonly string[];
}

export type JobPickerResult = { job: JobTypeDto } | 'propose';

const DEBOUNCE_MS = 250;

// The catalogue's jobs the garage does not list yet, searched as typed; a
// job closes the picker with it, "Propune-o" with the proposal.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmInput, HlmLabel, TranslatePipe],
  selector: 'mf-job-picker',
  styleUrl: './job-picker.css',
  templateUrl: './job-picker.html',
})
export class JobPicker {
  private readonly catalogue = inject(CatalogueService);
  private readonly i18n = inject(I18n);
  protected readonly task = injectOverlayTask<
    JobPickerData,
    OverlayResult<JobPickerResult>
  >();
  private readonly exclude = [...new Set(this.task.data.listed)].join(',');

  protected readonly state = signal<'searching' | 'found' | 'down'>(
    'searching',
  );
  protected readonly results = signal<readonly JobTypeDto[]>([]);

  private timer: ReturnType<typeof setTimeout> | undefined;
  // Only the latest search's answer is shown.
  private searches = 0;

  constructor() {
    void this.i18n.enter('garage');
    void this.i18n.enter('public');
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
    this.search('');
  }

  protected name(job: JobTypeDto) {
    return this.i18n.language() === 'en' && job.nameEn.trim()
      ? job.nameEn
      : job.nameRo;
  }

  protected find(event: Event) {
    const q = (event.target as HTMLInputElement).value.trim();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.search(q), DEBOUNCE_MS);
  }

  private search(q: string) {
    const turn = ++this.searches;
    this.state.set('searching');
    this.catalogue
      .jobTypesControllerSearch({
        ...(this.exclude && { exclude: this.exclude }),
        ...(q && { q }),
      })
      .then(
        ({ items }) => {
          if (turn !== this.searches) return;
          this.results.set(items);
          this.state.set('found');
        },
        () => {
          if (turn !== this.searches) return;
          this.results.set([]);
          this.state.set('down');
        },
      );
  }
}
