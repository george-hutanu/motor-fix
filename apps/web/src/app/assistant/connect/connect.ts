import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  type OnInit,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '@motor-fix/data-access';
import { TranslatePipe } from '@motor-fix/i18n';
import { Panel } from '@motor-fix/ui-cockpit';

import { LEAVE } from '../../dashboard/session';

// Where the identity server sends a person who is connecting an assistant. A
// signed-out person signs in through the interceptor's dialog, which then
// sends the approval again; the answer is the identity server's address.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Panel, TranslatePipe],
  selector: 'mf-assistant-connect',
  styleUrl: './connect.css',
  templateUrl: './connect.html',
})
export class Connect implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly leave = inject(LEAVE);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly request =
    inject(ActivatedRoute).snapshot.queryParamMap.get('request') ?? '';
  protected readonly failed = signal(false);

  ngOnInit() {
    if (!this.browser) return;
    if (this.request) void this.approve();
    else this.failed.set(true);
  }

  private async approve() {
    try {
      const { redirect } = await this.auth.assistantControllerApprove({
        body: { request: this.request },
      });
      this.leave(redirect);
    } catch {
      this.failed.set(true);
    }
  }
}
