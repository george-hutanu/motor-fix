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

import { Session } from '../../dashboard/session';
import { SignInDialog } from '../../sign-in/sign-in-dialog';

type State = 'checking' | 'ready' | 'accepting' | 'invalid' | 'error';

// Every way the server says the link can no longer be used.
const GONE = new Set(['invite_invalid', 'invite_expired', 'feature_off']);

const gone = (error: unknown) => GONE.has(toProblem(error).code);

// The invite's link: who invites whom, as what, and "Acceptă". A signed-in
// person accepts on the press; anyone else gets account creation with the
// invited name and e-mail filled in, or the phone sign-in for an invite sent
// to a phone. Creating the account accepts at once; signing in to an existing
// one reads the link again and waits for "Acceptă", so it is that account
// that joins, warned first when it would leave another garage's team. Moving
// a linked mechanic between garages is refused with its own message. The
// server renders the checking state only.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, RouterLink, TranslatePipe],
  selector: 'mf-invite',
  styleUrl: './invite.css',
  templateUrl: './invite.html',
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
  protected readonly moveRequired = signal(false);
  // Set once the server has taken the acceptance: a retry then only switches
  // the role, since accepting again would answer that the link is used.
  private joined = false;
  // Whether the last read of the link carried a session: only then does its
  // answer name the garage the account would leave.
  private readSignedIn = false;

  constructor() {
    void this.i18n.enter('public');
  }

  ngOnInit() {
    if (this.browser) void this.check();
  }

  // The session is loaded from the cookie first, so the read carries the
  // bearer and a signed-in visitor learns what accepting would leave.
  protected async check() {
    this.state.set('checking');
    try {
      this.readSignedIn = !!(await this.session.load({ keepLanguage: true }));
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
    this.moveRequired.set(false);
    this.state.set('accepting');
    try {
      if (!(await this.signedIn(invite))) return;
      if (!this.joined) {
        await this.invites.invitesControllerAccept({
          body: { token: this.token },
        });
        this.joined = true;
      }
      const me = await this.session.switchRole(invite.kind);
      await this.router.navigateByUrl(me?.landing ?? '/app/garage');
    } catch (error) {
      this.refused(error);
    }
  }

  // Whether to accept now: with a session already, or once a new account is
  // made. Signing in to an existing account accepts on the next press, once the
  // person has seen which account it is and what it leaves.
  private async signedIn(invite: InviteViewDto): Promise<boolean> {
    if (await this.session.load({ keepLanguage: true })) {
      if (this.readSignedIn) return true;
      // The session appeared after the link was read: read it again, so the
      // warning is on screen before a press accepts.
      await this.check();
      return false;
    }
    const joined = await this.dialog.join({
      name: invite.name,
      ...(invite.phone
        ? { phone: invite.phone }
        : { email: invite.email ?? '' }),
    });
    if (joined === 'signed-up') return true;
    if (joined === 'signed-in') await this.check();
    else this.state.set('ready');
    return false;
  }

  private refused(error: unknown) {
    if (gone(error)) {
      this.state.set('invalid');
      return;
    }
    if (toProblem(error).code === 'move_required') this.moveRequired.set(true);
    else this.failed.set(true);
    this.state.set('ready');
  }
}
