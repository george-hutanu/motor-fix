import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { REQUEST_STATUS_LABELS } from '@motor-fix/contracts/request-status';
import {
  type RequestSummaryDto,
  RequestsService,
} from '@motor-fix/data-access';
import { I18n, relativeTime, TranslatePipe } from '@motor-fix/i18n';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { EmptyState } from '../empty-state/empty-state';
import { liveResource } from '../live';

interface Row {
  id: string;
  car: string;
  what: string;
  status: string;
  when: string;
}

// "Cererile mele": the driver's requests, newest first, kept current by the
// request events so one sent in another tab shows up without a reload.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyState, HlmButton, RouterLink, TranslatePipe],
  selector: 'mf-requests-view',
  styleUrl: './requests-view.css',
  templateUrl: './requests-view.html',
})
export class RequestsView {
  private readonly api = inject(RequestsService);
  private readonly i18n = inject(I18n);
  protected readonly language = this.i18n.language;
  protected readonly list = liveResource(
    () => this.api.requestsControllerList(),
    ['request.created', 'quote.sent'],
  );
  protected readonly rows = computed(() => {
    const items = this.list.value()?.items;
    if (!items) return undefined;
    const language = this.language();
    const now = new Date();
    return items.map((item) => this.row(item, language, now));
  });

  constructor() {
    void this.i18n.enter('driver');
  }

  private row(item: RequestSummaryDto, language: 'ro' | 'en', now: Date): Row {
    const { brand, model, year } = item.car;
    const jobs = item.jobs.map((job) =>
      language === 'en' ? job.nameEn : job.nameRo,
    );
    return {
      car: `${brand} ${model} ${year}`,
      id: item.id,
      status: REQUEST_STATUS_LABELS[language][item.status],
      what: jobs.length
        ? jobs.join(', ')
        : (item.description ?? '').split('\n')[0],
      when: relativeTime(item.createdAt, language, now),
    };
  }
}
