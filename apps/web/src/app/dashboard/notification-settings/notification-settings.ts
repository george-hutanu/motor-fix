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

import { Live } from '../live';

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
  styleUrl: './notification-settings.css',
  templateUrl: './notification-settings.html',
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
    // The switch already shows the choice; a save's answer may predate a
    // later toggle, so the live update re-reads instead.
    try {
      await this.api.notificationPreferencesControllerSave({
        body: { preferences: [{ channel, enabled, garageId, type }] },
      });
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

  // Also each switch's own id: without one, every wrapping label shares the
  // same id and names every switch after the first.
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
