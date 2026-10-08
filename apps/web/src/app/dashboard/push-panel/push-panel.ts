import {
  ChangeDetectionStrategy,
  Component,
  inject,
  type OnInit,
} from '@angular/core';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmButton, toast } from '@motor-fix/ui-cockpit';

import { PushDevice, type PushState } from '../push-device';

// The line that says what is going on, by state.
const TEXT: Partial<Record<PushState, string>> = {
  blocked: 'shell.push.blocked',
  'ios-hint': 'shell.push.iosHint',
  off: 'shell.push.off',
  on: 'shell.push.on',
  unavailable: 'shell.push.unavailable',
  unsupported: 'shell.push.unsupported',
};

// This device's push switch. Permission is asked only on the tap.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-push-panel',
  styleUrl: './push-panel.css',
  templateUrl: './push-panel.html',
})
export class PushPanel implements OnInit {
  protected readonly device = inject(PushDevice);
  private readonly i18n = inject(I18n);

  protected line() {
    return TEXT[this.device.state()] ?? null;
  }

  ngOnInit() {
    void this.device.refresh();
  }

  protected async test() {
    if (await this.device.test()) toast(this.i18n.t('shell.push.testSent'));
  }
}
