import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  type OnInit,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { InvitesService, type InviteViewDto } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { toProblem } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { Session } from '../dashboard/session';
import { SignInDialog } from '../sign-in/sign-in-dialog';

type State = 'checking' | 'ready' | 'accepting' | 'invalid' | 'error';

// Every way the server says the link can no longer be used.
const GONE = new Set(['invite_invalid', 'invite_expired', 'feature_off']);

const gone = (error: unknown) => GONE.has(toProblem(error).code);

// The invite e-mail's link: who invites whom, as what, and "Acceptă". A
// signed-in person accepts on the press; anyone else gets account creation
// with the invited name and e-mail filled in. Creating the account accepts at
// once; signing in to an existing one waits for "Acceptă" again, so it is
// that account that joins. The server renders the checking state only.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, RouterLink, TranslatePipe],
  selector: 'mf-invite',
  styles: `
    :host { display: block; padding: var(--mf-space-4); }
    section { display: grid; gap: var(--mf-space-3); max-width: 36rem; }
    h1, p { margin: 0; overflow-wrap: anywhere; }
    p { color: var(--mf-text-secondary); }
    button, a { justify-self: start; white-space: normal; }
  `,
  template: `
    <section [attr.aria-busy]="state() === 'checking' || state() === 'accepting'">
      @switch (state()) {
        @case ('checking') {
          <h1>{{ 'public.invite.loading' | t }}</h1>
        }
        @case ('invalid') {
          <h1>{{ 'public.invite.invalid' | t }}</h1>
          <a hlmBtn variant="secondary" [routerLink]="['/', i18n.language()]">{{ 'public.invite.home' | t }}</a>
        }
        @case ('error') {
          <h1>{{ 'public.invite.error' | t }}</h1>
          <button hlmBtn type="button" (click)="check()">{{ 'public.invite.retry' | t }}</button>
        }
        @default {
          @if (invite(); as invite) {
            @if (invite.kind === 'mechanic') {
              <h1>{{ 'public.invite.mechanic' | t: { garage: invite.garage } }}</h1>
            } @else {
              <h1>{{ 'public.invite.receptionist' | t: { garage: invite.garage } }}</h1>
            }
            @if (invite.kind === 'mechanic') {
              <p>{{ 'public.invite.profile' | t }}</p>
            }
            @if (failed()) {
              <p role="alert">{{ 'public.invite.acceptFailed' | t }}</p>
            }
            <button hlmBtn type="button" [disabled]="state() === 'accepting'" (click)="accept()">
              {{ 'public.invite.accept' | t }}
            </button>
          }
        }
      }
    </section>
  `,
})
export class InvitePage implements OnInit {
  private readonly invites = inject(InvitesService);
  private readonly session = inject(Session);
  private readonly dialog = inject(SignInDialog);
  private readonly router = inject(Router);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  protected readonly i18n = inject(I18n);
  private readonly token: string =
    inject(ActivatedRoute).snapshot.paramMap.get('token') ?? '';

  protected readonly state = signal<State>('checking');
  protected readonly invite = signal<InviteViewDto | null>(null);
  protected readonly failed = signal(false);

  constructor() {
    void this.i18n.enter('public');
  }

  ngOnInit() {
    if (this.browser) void this.check();
  }

  protected async check() {
    this.state.set('checking');
    try {
      this.invite.set(
        await this.invites.invitesControllerCheck({
          body: { token: this.token },
        }),
      );
      this.state.set('ready');
    } catch (error) {
      this.state.set(gone(error) ? 'invalid' : 'error');
    }
  }

  protected async accept() {
    const invite = this.invite();
    if (!invite || this.state() === 'accepting') return;
    this.failed.set(false);
    this.state.set('accepting');
    try {
      if (!(await this.session.load())) {
        const joined = await this.dialog.join({
          email: invite.email,
          name: invite.name,
        });
        // Signed in to an existing account: that account joins on the next
        // press, once the person has seen which one it is.
        if (joined !== 'signed-up') {
          this.state.set('ready');
          return;
        }
      }
      await this.invites.invitesControllerAccept({
        body: { token: this.token },
      });
      const me = await this.session.switchRole(invite.kind);
      await this.router.navigateByUrl(me?.landing ?? '/app/garage');
    } catch (error) {
      if (gone(error)) {
        this.state.set('invalid');
        return;
      }
      this.failed.set(true);
      this.state.set('ready');
    }
  }
}
