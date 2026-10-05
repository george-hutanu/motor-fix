import {
  ChangeDetectionStrategy,
  Component,
  inject,
  type OnInit,
} from '@angular/core';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmButton, toast } from '@motor-fix/ui-cockpit';

import { PushDevice, type PushState } from './push-device';

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
  styles: `
    :host { display: block; }
    section { display: flex; flex-direction: column; gap: var(--mf-space-3); margin: var(--mf-space-4); padding: var(--mf-space-4); border: 1px solid var(--mf-line-strong); border-radius: var(--mf-radius-md, 12px); }
    h2, p { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    .actions { display: flex; flex-direction: column; gap: var(--mf-space-2); }
    button { width: 100%; white-space: normal; }
    @media (min-width: 390px) { .actions { flex-direction: row; flex-wrap: wrap; } button { width: auto; } }
  `,
  template: `
    @if (device.state() !== 'loading') {
      <section aria-labelledby="push-title">
        <h2 id="push-title">{{ 'shell.push.title' | t }}</h2>
        @if (line(); as key) {
          <p role="status">{{ key | t }}</p>
        }
        @if (device.failed()) {
          <p role="alert">{{ 'shell.push.failed' | t }}</p>
        }
        <div class="actions">
          @if (device.state() === 'off') {
            <button hlmBtn type="button" [disabled]="device.busy()" (click)="enable()">
              {{ 'shell.push.enable' | t }}
            </button>
          }
          @if (device.state() === 'on') {
            <button hlmBtn variant="secondary" type="button" [disabled]="device.busy()" (click)="disable()">
              {{ 'shell.push.disable' | t }}
            </button>
            <button hlmBtn variant="secondary" type="button" [disabled]="device.busy()" (click)="test()">
              {{ 'shell.push.test' | t }}
            </button>
          }
        </div>
      </section>
    }
  `,
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

  protected enable() {
    return this.device.enable();
  }

  protected disable() {
    return this.device.disable();
  }

  protected async test() {
    if (await this.device.test()) toast(this.i18n.t('shell.push.testSent'));
  }
}
