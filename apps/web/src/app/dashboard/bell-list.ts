import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { ago, type BellStore } from './bell';

// The person's notifications, newest first; opening one marks it read.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-bell-list',
  styles: `
    :host { display: block; }
    .actions { display: flex; justify-content: flex-end; margin-bottom: var(--mf-space-2); }
    ul { list-style: none; margin: 0; padding: 0; }
    li { border-top: 1px solid var(--mf-line); }
    li:first-child { border-top: 0; }
    li button {
      display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--mf-space-1) var(--mf-space-3);
      width: 100%; min-height: var(--mf-tap); padding: var(--mf-space-3) 0;
      border: 0; background: transparent; color: var(--mf-text-secondary);
      font: inherit; text-align: start; cursor: pointer;
    }
    li.unread button { color: var(--mf-text); font-weight: 600; }
    .text { overflow-wrap: anywhere; text-wrap: pretty; }
    time { color: var(--mf-text-secondary); font-size: var(--mf-size-small); font-weight: 400; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .dot { display: inline-block; width: 8px; height: 8px; margin-inline-end: var(--mf-space-2); border-radius: 50%; background: var(--mf-amber); vertical-align: middle; }
    .hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    [data-skeleton] { height: 20px; margin: var(--mf-space-4) 0; border-radius: var(--mf-radius-chip); background: var(--mf-line); }
    .more { display: flex; justify-content: center; padding-top: var(--mf-space-3); }
    p { margin: 0; color: var(--mf-text-secondary); }
    .failed { display: flex; flex-wrap: wrap; align-items: center; gap: var(--mf-space-3); }
  `,
  template: `
    <div [attr.aria-busy]="store.state() === 'loading'">
      @switch (store.state()) {
        @case ('loading') {
          @for (n of [1, 2, 3]; track n) {
            <div data-skeleton></div>
          }
        }
        @case ('error') {
          <div class="failed">
            <p>{{ 'shell.bell.failed' | t }}</p>
            <button hlmBtn variant="secondary" type="button" (click)="store.load()">{{ 'shell.bell.retry' | t }}</button>
          </div>
        }
        @case ('ready') {
          @if (store.items().length === 0) {
            <p>{{ 'shell.bell.empty' | t }}</p>
          } @else {
            @if (unread()) {
              <div class="actions">
                <button hlmBtn variant="secondary" type="button" (click)="store.readAll()">{{ 'shell.bell.readAll' | t }}</button>
              </div>
            }
            <ul>
              @for (item of store.items(); track item.id) {
                <li [class.unread]="!item.readAt">
                  <button type="button" (click)="store.read(item.id)">
                    <span>
                      @if (!item.readAt) {
                        <span class="dot" aria-hidden="true"></span><span class="hidden">{{ 'shell.bell.unread' | t }}, </span>
                      }
                      <span class="text">{{ item.text }}</span>
                    </span>
                    <time [attr.datetime]="item.at">{{ when(item.at) }}</time>
                  </button>
                </li>
              }
            </ul>
            @if (store.more()) {
              <div class="more">
                <button hlmBtn variant="secondary" type="button" (click)="store.loadMore()">{{ 'shell.bell.more' | t }}</button>
              </div>
            }
          }
        }
      }
    </div>
  `,
})
export class BellList {
  protected readonly store = injectOverlayTask<BellStore>().data;
  private readonly i18n = inject(I18n);
  private readonly now = new Date();
  protected readonly unread = computed(() =>
    this.store.items().some((n) => !n.readAt),
  );

  protected when(at: string) {
    return ago(at, this.now, this.i18n);
  }
}
