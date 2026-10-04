import { Component, computed, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  type CanActivateFn,
  NavigationEnd,
  PRIMARY_OUTLET,
  Router,
  RouterLink,
} from '@angular/router';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { filter } from 'rxjs';

import { Session } from '../dashboard/session';

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

export const toAccount: CanActivateFn = async () => {
  const router = inject(Router);
  const me = await inject(Session).load();
  return me ? router.parseUrl(me.landing) : true;
};

@Component({
  host: {
    '(document:focusin)': 'typing.set(takesText($event.target))',
    '(document:focusout)': 'typing.set(false)',
    '[hidden]': 'typing()',
  },
  imports: [RouterLink, TranslatePipe],
  selector: 'mf-public-tab-bar',
  styles: `
    :host {
      display: block;
      position: sticky;
      bottom: 0;
      z-index: 10;
      margin-top: auto;
      border-top: 1px solid var(--mf-line);
      background: color-mix(in srgb, var(--mf-bg) 74%, transparent);
      -webkit-backdrop-filter: saturate(160%) blur(18px);
      backdrop-filter: saturate(160%) blur(18px);
    }
    :host([hidden]) { display: none; }
    @media (min-width: 768px) { :host { display: none; } }
    @media (prefers-reduced-transparency: reduce) {
      :host { background: var(--mf-bg); -webkit-backdrop-filter: none; backdrop-filter: none; }
    }
    nav {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      padding: 6px 8px max(14px, var(--mf-safe-bottom));
    }
    a {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 2px;
      min-height: 52px;
      color: var(--mf-text-secondary);
      font-size: var(--mf-size-label);
      font-weight: 700;
      text-align: center;
      text-decoration: none;
    }
    a[aria-current="page"] { color: var(--mf-amber-ink); }
    svg { flex: none; }
  `,
  template: `
    <nav [attr.aria-label]="'public.tabs.label' | t">
      <a [routerLink]="['/', language()]" [attr.aria-current]="active() === 'search' ? 'page' : null">
        <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
        <span>{{ 'public.tabs.search' | t }}</span>
      </a>
      <a [routerLink]="['/', language(), 'garages']" [queryParams]="brand() ? { brand: brand() } : {}" [attr.aria-current]="active() === 'garages' ? 'page' : null">
        <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s6.5-6.1 6.5-11A6.5 6.5 0 0 0 5.5 10c0 4.9 6.5 11 6.5 11z" /><circle cx="12" cy="10" r="2.3" /></svg>
        <span>{{ 'public.tabs.garages' | t }}</span>
      </a>
      <a [routerLink]="['/', language(), 'account']" [attr.aria-current]="active() === 'account' ? 'page' : null">
        <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4s6.3 1.8 7.5 5.4" /></svg>
        <span>{{ 'public.tabs.account' | t }}</span>
      </a>
    </nav>
  `,
})
export class PublicTabBar {
  private readonly router = inject(Router);
  private readonly url = signal(this.router.url);
  protected readonly language = inject(I18n).language;
  protected readonly brand = inject(LastBrand).value;
  protected readonly typing = signal(false);
  protected readonly takesText = takesText;
  protected readonly active = computed(() => {
    const tree = this.router.parseUrl(this.url());
    const segments = tree.root.children[PRIMARY_OUTLET]?.segments ?? [];
    return TAB_OF[segments[1]?.path ?? ''];
  });

  constructor() {
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(({ urlAfterRedirects }) => {
        this.url.set(urlAfterRedirects);
        const tree = this.router.parseUrl(urlAfterRedirects);
        const segments = tree.root.children[PRIMARY_OUTLET]?.segments ?? [];
        const brand = tree.queryParams['brand'];
        if (segments.length === 2 && segments[1].path === 'garages' && brand)
          this.brand.set(String(brand));
      });
  }
}
