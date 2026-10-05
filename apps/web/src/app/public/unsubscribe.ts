import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  type OnInit,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { NotificationsService } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { httpStatus } from '../http-status';

type State = 'stopping' | 'stopped' | 'invalid' | 'error';

// Opened from a news e-mail's stop link: no sign-in and no click. On the
// server it only renders the busy state; the browser makes the one call.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, RouterLink, TranslatePipe],
  selector: 'mf-unsubscribe',
  styles: `
    :host { display: block; padding: var(--mf-space-4); }
    section { display: grid; gap: var(--mf-space-3); max-width: 36rem; }
    h1, p { margin: 0; overflow-wrap: anywhere; }
    button, a { justify-self: start; white-space: normal; }
  `,
  template: `
    <section [attr.aria-busy]="state() === 'stopping'">
      @switch (state()) {
        @case ('stopping') {
          <h1>{{ 'public.unsubscribe.stopping' | t }}</h1>
        }
        @case ('stopped') {
          <h1>{{ 'public.unsubscribe.stopped' | t }}</h1>
          <p>{{ 'public.unsubscribe.stoppedLine' | t }}</p>
          <a hlmBtn variant="secondary" [routerLink]="['/', i18n.language()]">{{ 'public.unsubscribe.home' | t }}</a>
        }
        @case ('invalid') {
          <h1>{{ 'public.unsubscribe.invalid' | t }}</h1>
          <p>{{ 'public.unsubscribe.invalidLine' | t }}</p>
          <a hlmBtn variant="secondary" [routerLink]="['/', i18n.language()]">{{ 'public.unsubscribe.home' | t }}</a>
        }
        @case ('error') {
          <h1>{{ 'public.unsubscribe.error' | t }}</h1>
          <button hlmBtn type="button" (click)="stop()">{{ 'public.unsubscribe.retry' | t }}</button>
        }
      }
    </section>
  `,
})
export class Unsubscribe implements OnInit {
  private readonly notifications = inject(NotificationsService);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  protected readonly i18n = inject(I18n);
  private readonly token: string =
    inject(ActivatedRoute).snapshot.paramMap.get('token') ?? '';
  protected readonly state = signal<State>('stopping');

  ngOnInit() {
    if (this.browser) void this.stop();
  }

  protected async stop() {
    this.state.set('stopping');
    try {
      await this.notifications.newsControllerUnsubscribe({ token: this.token });
      this.state.set('stopped');
    } catch (error) {
      this.state.set(httpStatus(error) === 400 ? 'invalid' : 'error');
    }
  }
}
