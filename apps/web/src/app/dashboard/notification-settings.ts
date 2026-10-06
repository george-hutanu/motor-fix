import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  type OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { LiveMessage } from '@motor-fix/contracts';
import {
  NotificationsService,
  type StaffChannelDto,
  type StaffNotificationsDto,
  type StaffNotificationTypeDto,
} from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmButton, HlmSwitch, toast } from '@motor-fix/ui-cockpit';
import { debounceTime, filter } from 'rxjs';

import { Live } from './live';

type Channel = StaffChannelDto['channel'];

const REASON: Record<string, string> = {
  garage_whatsapp_off: 'shell.notifications.whatsappOff',
  phone_not_verified: 'shell.notifications.phoneNeeded',
};

// Unique ids for the helper lines when the panel is shown more than once.
let panels = 0;

// The person's staff lists: one switch per type and channel, saved on toggle.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmSwitch, TranslatePipe],
  selector: 'mf-notification-settings',
  styles: `
    :host { display: block; }
    section { display: flex; flex-direction: column; gap: var(--mf-space-3); margin: var(--mf-space-4); padding: var(--mf-space-4); border: 1px solid var(--mf-line-strong); border-radius: var(--mf-radius-md, 12px); min-width: 0; }
    h2, h3, p { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    h3 { font-size: 1rem; }
    .title { margin: var(--mf-space-4) var(--mf-space-4) 0; }
    ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    li { display: flex; flex-direction: column; gap: var(--mf-space-2); padding: var(--mf-space-3) 0; border-top: 1px solid var(--mf-line); min-width: 0; }
    .name { display: flex; flex-direction: column; gap: var(--mf-space-1); min-width: 0; }
    .hint { color: var(--mf-ink-muted); font-size: 0.875rem; }
    .channels { display: flex; flex-wrap: wrap; gap: var(--mf-space-2) var(--mf-space-4); }
    label { display: inline-flex; align-items: center; gap: var(--mf-space-2); }
    .skeleton { height: 44px; border-radius: var(--mf-radius-sm, 8px); background: var(--mf-line); }
    button[hlmBtn] { width: 100%; white-space: normal; }
    @media (min-width: 390px) { button[hlmBtn] { width: auto; align-self: flex-start; } }
    @media (min-width: 768px) {
      li { flex-direction: row; align-items: center; justify-content: space-between; gap: var(--mf-space-4); }
      .channels { flex-wrap: nowrap; flex-shrink: 0; }
    }
  `,
  template: `
    @if (entries(); as lists) {
      @if (lists.length > 0) {
        <h2 class="title">{{ 'shell.notifications.title' | t }}</h2>
      }
      @for (entry of lists; track entry.garageId; let e = $index) {
        <section [attr.aria-label]="heading(entry, lists.length) ?? ('shell.notifications.title' | t)">
          @if (heading(entry, lists.length); as name) {
            <h2>{{ name }}</h2>
          }
          @if (reason(entry); as key) {
            <p class="hint" [id]="id + '-wa-' + e">{{ key | t }}</p>
          }
          @for (section of entry.sections; track section.key) {
            <h3>{{ sectionKey(section.key) | t }}</h3>
            <ul>
              @for (item of section.types; track item.type; let r = $index) {
                <li>
                  <div class="name">
                    <span>{{ typeKey(item.type) | t }}</span>
                    @if (item.channels.length === 0) {
                      <span class="hint">{{ 'shell.notifications.inApp' | t }}</span>
                    }
                    @if (isLocked(item)) {
                      <span class="hint" [id]="rowId(e, section.key, r)">{{ 'shell.notifications.alwaysSent' | t }}</span>
                    }
                    @if (item.type === 'REQUEST_RECEIVED') {
                      <span class="hint">{{ 'shell.notifications.reminders' | t }}</span>
                    }
                  </div>
                  @if (item.channels.length > 0) {
                    <div class="channels">
                      @for (c of item.channels; track c.channel) {
                        <label>
                          <hlm-switch
                            [checked]="isOn(entry, c)"
                            [disabled]="isFixed(entry, c)"
                            [aria-label]="switchName(item.type, c.channel)"
                            [aria-describedby]="describedBy(entry, c, e, section.key, r)"
                            (checkedChange)="toggle(entry, item.type, c.channel, $event)"
                          />
                          <span aria-hidden="true">{{ channelKey(c.channel) | t }}</span>
                        </label>
                      }
                    </div>
                  }
                </li>
              }
            </ul>
          }
        </section>
      }
    } @else if (failed()) {
      <section>
        <p role="alert">{{ 'shell.notifications.loadFailed' | t }}</p>
        <button hlmBtn variant="secondary" type="button" (click)="load()">
          {{ 'shell.notifications.retry' | t }}
        </button>
      </section>
    } @else {
      <section aria-busy="true">
        @for (row of skeleton; track row) {
          <div class="skeleton" aria-hidden="true"></div>
        }
      </section>
    }
  `,
})
export class NotificationSettings implements OnInit {
  private readonly api = inject(NotificationsService);
  private readonly live = inject(Live);
  private readonly i18n = inject(I18n);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly id = `notifications-${++panels}`;
  protected readonly skeleton = [0, 1, 2];
  protected readonly entries = signal<StaffNotificationsDto[] | undefined>(
    undefined,
  );
  protected readonly failed = signal(false);

  ngOnInit() {
    // The preferences event goes straight to Redis, so it is no outbox kind.
    const wanted = (message: LiveMessage) =>
      message.kind === 'notification_preferences.updated' ||
      (message.kind === 'garage.features_changed' &&
        (this.entries() ?? []).some((entry) => entry.garageId === message.id));
    this.live.events
      .pipe(filter(wanted))
      .pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.load());
    this.live.resync
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.load());
    void this.load();
  }

  // A failed re-read keeps the lists on screen; only a first read shows the error.
  protected async load() {
    this.failed.set(false);
    try {
      const answer = await this.api.notificationPreferencesControllerRead();
      this.entries.set(answer.staff);
    } catch {
      if (this.entries() === undefined) this.failed.set(true);
    }
  }

  protected async toggle(
    entry: StaffNotificationsDto,
    type: string,
    channel: Channel,
    enabled: boolean,
  ) {
    const { garageId } = entry;
    this.set(garageId, type, channel, enabled);
    try {
      const answer = await this.api.notificationPreferencesControllerSave({
        body: { preferences: [{ channel, enabled, garageId, type }] },
      });
      this.entries.set(answer.staff);
    } catch {
      this.set(garageId, type, channel, !enabled);
      toast(this.i18n.t('shell.notifications.saveFailed'));
    }
  }

  protected heading(entry: StaffNotificationsDto, count: number) {
    if (entry.role === 'admin') return this.i18n.t('shell.notifications.admin');
    return count > 1 ? entry.garageName : null;
  }

  protected reason(entry: StaffNotificationsDto) {
    const { available, reason } = entry.whatsapp;
    return available || !reason ? null : (REASON[reason] ?? null);
  }

  protected isLocked(item: StaffNotificationTypeDto) {
    return item.channels.some((c) => c.locked);
  }

  protected isOn(entry: StaffNotificationsDto, c: StaffChannelDto) {
    if (c.locked) return true;
    if (c.channel === 'whatsapp' && !entry.whatsapp.available) return false;
    return c.enabled;
  }

  protected isFixed(entry: StaffNotificationsDto, c: StaffChannelDto) {
    return c.locked || (c.channel === 'whatsapp' && !entry.whatsapp.available);
  }

  protected sectionKey(key: string) {
    return `shell.notifications.section.${key}`;
  }

  protected typeKey(type: string) {
    return `shell.notifications.type.${type}`;
  }

  protected channelKey(channel: Channel) {
    return `shell.notifications.channel.${channel}`;
  }

  protected switchName(type: string, channel: Channel) {
    return this.i18n.t('shell.notifications.switch', {
      channel: this.i18n.t(this.channelKey(channel)),
      type: this.i18n.t(this.typeKey(type)),
    });
  }

  protected rowId(entry: number, section: string, row: number) {
    return `${this.id}-${entry}-${section}-${row}`;
  }

  protected describedBy(
    entry: StaffNotificationsDto,
    c: StaffChannelDto,
    e: number,
    section: string,
    row: number,
  ) {
    if (c.locked) return this.rowId(e, section, row);
    if (c.channel === 'whatsapp' && this.reason(entry))
      return `${this.id}-wa-${e}`;
    return null;
  }

  private set(
    garageId: string | null,
    type: string,
    channel: Channel,
    enabled: boolean,
  ) {
    this.entries.update((entries) =>
      entries?.map((entry) =>
        entry.garageId !== garageId
          ? entry
          : {
              ...entry,
              sections: entry.sections.map((section) => ({
                ...section,
                types: section.types.map((item) =>
                  item.type !== type
                    ? item
                    : {
                        ...item,
                        channels: item.channels.map((c) =>
                          c.channel === channel ? { ...c, enabled } : c,
                        ),
                      },
                ),
              })),
            },
      ),
    );
  }
}
