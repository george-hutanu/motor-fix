import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MeService } from '@motor-fix/data-access';
import { TranslatePipe } from '@motor-fix/i18n';

import { APPROVAL_EVENTS, liveResource } from '../../dashboard/live';

// One line over every signed-in view while the assistant waits for approvals,
// leading to the oldest one's sheet; nothing at none.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe],
  selector: 'mf-approval-strip',
  styleUrl: './approval-strip.css',
  templateUrl: './approval-strip.html',
})
export class ApprovalStrip {
  private readonly me = inject(MeService);
  private readonly approvals = liveResource(
    () => this.me.assistantApprovalsControllerList(),
    APPROVAL_EVENTS,
  );
  protected readonly pending = computed(
    () => this.approvals.value()?.pending ?? 0,
  );
  protected readonly oldest = computed(() => this.approvals.value()?.items[0]);
}
