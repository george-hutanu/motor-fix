import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  Component,
  DestroyRef,
  type EnvironmentProviders,
  Injectable,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
} from '@angular/core';
import { Subject } from 'rxjs';

import { I18n } from './i18n';
import { isLanguage, type Language } from './languages';
import { TranslatePipe } from './translate.pipe';

const KEY = 'mf.lang';

// Every storage access is guarded: with storage blocked the browser throws on
// reading `localStorage` itself, and the app must still work in Romanian.
@Injectable({ providedIn: 'root' })
export class LanguageChoice {
  private readonly i18n = inject(I18n);
  private readonly window = inject(DOCUMENT).defaultView;
  private readonly tapped = new Subject<Language>();
  // Languages tapped on the switch; the address, another tab and the session
  // choose without a tap.
  readonly taps = this.tapped.asObservable();

  pick(language: string): Promise<void> {
    const chosen = this.choose(language);
    if (isLanguage(language)) this.tapped.next(language);
    return chosen;
  }

  choose(language: string): Promise<void> {
    if (!isLanguage(language)) return Promise.resolve();
    try {
      this.window?.localStorage.setItem(KEY, language);
    } catch {}
    return this.i18n.use(language);
  }

  saved(): Language | null {
    let saved: string | null = null;
    try {
      saved = this.window?.localStorage.getItem(KEY) ?? null;
    } catch {}
    return saved && isLanguage(saved) ? saved : null;
  }

  restore(): () => void {
    const saved = this.saved();
    if (saved) void this.i18n.use(saved);
    // Another tab's choice; the tab that wrote the value gets no event.
    const follow = ({ key, newValue }: StorageEvent) => {
      if (key === KEY && newValue) void this.i18n.use(newValue);
    };
    this.window?.addEventListener('storage', follow);
    return () => this.window?.removeEventListener('storage', follow);
  }
}

// After the first render, so the server's Romanian page hydrates unchanged.
export function provideRememberedLanguage(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideEnvironmentInitializer(() => {
      const choice = inject(LanguageChoice);
      const destroy = inject(DestroyRef);
      afterNextRender(() => destroy.onDestroy(choice.restore()));
    }),
  ]);
}

@Component({
  imports: [TranslatePipe],
  selector: 'mf-language-switch',
  styles: `
    :host { display: inline-flex; }
    button { min-width: 44px; min-height: 44px; padding: 0 8px; font: inherit; font-size: var(--mf-size-body); }
    button[aria-pressed='true'] { font-weight: 700; text-decoration: underline; }
  `,
  template: `
    <div role="group" [attr.aria-label]="'shell.language.label' | t">
      <button type="button" [attr.aria-pressed]="i18n.language() === 'ro'" (click)="choice.pick('ro')">
        {{ 'shell.language.ro' | t }}
      </button>
      <button type="button" [attr.aria-pressed]="i18n.language() === 'en'" (click)="choice.pick('en')">
        {{ 'shell.language.en' | t }}
      </button>
    </div>
  `,
})
export class LanguageSwitch {
  protected readonly i18n = inject(I18n);
  protected readonly choice = inject(LanguageChoice);
}
