import { Component, computed, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { filter } from 'rxjs';

import { segmentsOf } from '../../addresses';
import { SignInDialog } from '../../sign-in/sign-in-dialog';

type Tab = 'search' | 'garages' | 'account';

// The section after the language prefix.
const TAB_OF: Record<string, Tab> = {
  '': 'search',
  account: 'account',
  garages: 'garages',
  mechanics: 'garages',
};

const UNTYPED = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

// Browsers do not report the on-screen keyboard; a focused text field is the
// closest sign of it.
const takesText = (target: EventTarget | null) =>
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLInputElement && !UNTYPED.has(target.type)) ||
  (target instanceof HTMLElement && target.isContentEditable);

// Root-provided so the brand survives the dashboards, which have no bar.
@Injectable({ providedIn: 'root' })
class LastBrand {
  readonly value = signal<string | null>(null);
}

@Component({
  host: {
    '(document:focusin)': 'typing.set(takesText($event.target))',
    '(document:focusout)': 'typing.set(false)',
    '[hidden]': 'typing()',
  },
  imports: [RouterLink, TranslatePipe],
  selector: 'mf-public-tab-bar',
  styleUrl: './tab-bar.css',
  templateUrl: './tab-bar.html',
})
export class PublicTabBar {
  private readonly router = inject(Router);
  private readonly segments = signal<string[]>([]);
  protected readonly language = inject(I18n).language;
  protected readonly brand = inject(LastBrand).value;
  protected readonly brandQuery = computed(() => {
    const brand = this.brand();
    return brand ? { brand } : {};
  });
  protected readonly typing = signal(false);
  protected readonly takesText = takesText;
  protected readonly active = computed(() => TAB_OF[this.segments()[1] ?? '']);
  private readonly signIn = inject(SignInDialog);

  // A plain click opens sign-in over this screen, or the dashboard; a click
  // meant for a new tab keeps the account screen's address.
  protected account(event: MouseEvent) {
    if (
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    void this.signIn.start();
  }

  // The address it starts on counts too: the frame may create the bar after
  // that navigation has ended.
  constructor() {
    this.follow(this.router.url);
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(({ urlAfterRedirects }) => {
        this.follow(urlAfterRedirects);
      });
  }

  private follow(url: string) {
    const tree = this.router.parseUrl(url);
    const segments = segmentsOf(tree);
    this.segments.set(segments);
    const brand = tree.queryParams['brand'];
    if (segments.length === 2 && segments[1] === 'garages' && brand)
      this.brand.set(String(brand));
  }
}
