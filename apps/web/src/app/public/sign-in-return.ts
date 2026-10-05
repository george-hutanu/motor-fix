import { isPlatformBrowser } from '@angular/common';
import { Component, inject, type OnInit, PLATFORM_ID } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { I18n } from '@motor-fix/i18n';

import { type Provider, Session } from '../dashboard/session';
import { Home } from '../home/home';
import { type ProviderResult, SignInDialog } from '../sign-in/sign-in-dialog';

const RESULTS: readonly string[] = [
  'consent',
  'cancelled',
  'failed',
  'maintenance',
  'suspended',
  'email_taken',
] satisfies ProviderResult[];

// Where the server sends the page back from Google or Apple: Home, with the
// dashboard opened on a sign-in, or the sign-in dialog over it otherwise. The
// address carries only the result, never a token; the session is in the
// cookie. The server renders Home only.
@Component({
  imports: [Home],
  selector: 'mf-sign-in-return',
  template: '<mf-home />',
})
export class SignInReturn implements OnInit {
  private readonly session = inject(Session);
  private readonly dialog = inject(SignInDialog);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18n);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;

  ngOnInit() {
    if (this.browser) void this.finish();
  }

  private async finish() {
    const provider: Provider =
      this.query.get('provider') === 'apple' ? 'apple' : 'google';
    const result = this.query.get('result') ?? '';
    if (result === 'signed-in' && (await this.session.load())) {
      await this.open();
      return;
    }
    const known = RESULTS.includes(result) ? (result as ProviderResult) : null;
    const signedIn = await this.dialog.returned(known ?? 'failed', provider);
    if (signedIn) await this.open();
    else await this.go(`/${this.i18n.language()}`);
  }

  // The screen that asked for the sign-in, or the role's dashboard.
  private async open() {
    const landing =
      this.session.takeReturnTo() ?? this.session.current()?.landing;
    await this.go(landing ?? `/${this.i18n.language()}`);
  }

  private go(url: string) {
    return this.router.navigateByUrl(url, { replaceUrl: true });
  }
}
