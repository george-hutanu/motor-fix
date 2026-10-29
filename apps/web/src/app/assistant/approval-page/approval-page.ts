import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { MeService } from '@motor-fix/data-access';
import { TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { Panel } from '@motor-fix/ui-cockpit';

import { Live } from '../../dashboard/live';
import { Session } from '../../dashboard/session';
import {
  ApprovalSheet,
  type ApprovalSheetData,
} from '../approval-sheet/approval-sheet';

// The address the notification links to: opens the approval's sheet (a drawer
// on a desktop, a bottom sheet on a phone), then the next pending one, then
// the account's dashboard. A signed-out person signs in through the
// interceptor's dialog first.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Panel, TranslatePipe],
  selector: 'mf-approval-page',
  styleUrl: './approval-page.css',
  templateUrl: './approval-page.html',
})
export class ApprovalPage {
  private readonly me = inject(MeService);
  private readonly overlays = inject(Overlays);
  private readonly router = inject(Router);
  private readonly session = inject(Session);
  private readonly live = inject(Live);
  protected readonly missing = signal(false);

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    inject(DestroyRef).onDestroy(() => this.live.close());
    inject(ActivatedRoute)
      .paramMap.pipe(takeUntilDestroyed())
      .subscribe((params) => void this.show(params.get('id') ?? ''));
  }

  private async show(id: string) {
    this.missing.set(false);
    const approval = await this.me
      .assistantApprovalsControllerGet({ id })
      .catch(() => null);
    if (!approval) {
      this.missing.set(true);
      return;
    }
    const account = await this.session.load();
    this.live.open();
    const name = approval.assistantName;
    const next = await this.overlays.open<string | null, ApprovalSheetData>(
      ApprovalSheet,
      {
        data: { id },
        shape: 'drawer',
        title: name
          ? 'assistant.approval.title'
          : 'assistant.approval.titleUnnamed',
        titleParams: name ? { client: name } : undefined,
      },
    );
    if (next && next !== 'cancelled')
      await this.router.navigate(['/app/assistant/approvals', next], {
        replaceUrl: true,
      });
    else await this.router.navigateByUrl(account?.landing ?? '/');
  }
}
