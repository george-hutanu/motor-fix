import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  type OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NOTIFICATION_GROUPS,
  type NotificationGroupKey,
} from '@motor-fix/contracts';
import { NotificationsService } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton, HlmSwitch, toast } from '@motor-fix/ui-cockpit';
import { debounceTime, filter } from 'rxjs';

import { Live } from '../live';
import { NewsConsent } from '../news-consent/news-consent';

type Choices = Record<NotificationGroupKey, boolean>;
type Flip = { enabled: boolean };

// What a driver with nothing saved gets: every group but news.
const DEFAULTS = Object.fromEntries(
  NOTIFICATION_GROUPS.map((key) => [key, key !== 'news']),
) as Choices;

// The driver's five group switches, each saved on its own when flipped.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmSwitch, TranslatePipe],
  selector: 'mf-driver-notifications',
  styleUrl: './driver-notifications.css',
  templateUrl: './driver-notifications.html',
})
export class DriverNotifications implements OnInit {
  private readonly api = inject(NotificationsService);
  private readonly live = inject(Live);
  private readonly overlays = inject(Overlays);
  private readonly i18n = inject(I18n);
  private readonly destroyRef = inject(DestroyRef);

  private readonly choices = signal<Choices | undefined>(undefined);
  // Flips shown but not yet settled (a save in flight or the consent step
  // open): a re-read keeps them, so a switch never jumps under the driver.
  private readonly unsettled = new Map<NotificationGroupKey, Flip>();
  private consentVersion = '';
  protected readonly failed = signal(false);
  protected readonly loaded = computed(() => this.choices() !== undefined);
  protected readonly rows = computed(() => {
    const choices = this.choices() ?? DEFAULTS;
    return NOTIFICATION_GROUPS.map((key) => ({ enabled: choices[key], key }));
  });

  constructor() {
    void this.i18n.enter('driver');
  }

  ngOnInit() {
    this.live.events
      .pipe(
        filter(
          (message) => message.kind === 'notification_preferences.updated',
        ),
      )
      .pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.load());
    this.live.resync
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.load());
    void this.load();
  }

  // A failed re-read keeps the switches; only a first read shows the error.
  protected async load() {
    this.failed.set(false);
    try {
      const answer = await this.api.notificationPreferencesControllerRead();
      const choices = { ...DEFAULTS };
      for (const group of answer.groups) choices[group.key] = group.enabled;
      for (const [key, flip] of this.unsettled) choices[key] = flip.enabled;
      this.consentVersion = answer.newsConsent.currentTextVersion;
      this.choices.set(choices);
    } catch {
      if (!this.loaded()) this.failed.set(true);
    }
  }

  // The switch shows the flip at once; a later state comes from the live
  // re-read, since a save's answer may predate a later flip.
  protected async toggle(key: NotificationGroupKey, enabled: boolean) {
    const flip = { enabled };
    this.unsettled.set(key, flip);
    this.set(key, flip, enabled);
    try {
      await this.save(key, flip);
    } finally {
      if (this.unsettled.get(key) === flip) this.unsettled.delete(key);
    }
  }

  private async save(key: NotificationGroupKey, flip: Flip) {
    const { enabled } = flip;
    const askConsent = key === 'news' && enabled;
    // The version of the text the driver is shown, whatever a re-read brings.
    const version = this.consentVersion;
    if (askConsent) {
      const answer = await this.overlays
        .open<boolean>(NewsConsent, {
          shape: 'dialog',
          title: 'driver.notifications.consent.title',
        })
        .catch(() => false);
      if (answer !== true) {
        this.set(key, flip, false);
        return;
      }
    }
    try {
      await this.api.notificationPreferencesControllerSave({
        body: {
          groups: [{ enabled, key }],
          ...(askConsent && { newsConsentTextVersion: version }),
        },
      });
    } catch {
      this.set(key, flip, !enabled);
      toast(this.i18n.t('shell.notifications.saveFailed'));
      // The consent text may have moved on: the next try needs its version.
      if (askConsent) void this.load();
    }
  }

  protected titleKey(key: NotificationGroupKey) {
    return `driver.notifications.group.${key}.title`;
  }

  protected hintKey(key: NotificationGroupKey) {
    return `driver.notifications.group.${key}.hint`;
  }

  private set(key: NotificationGroupKey, flip: Flip, enabled: boolean) {
    flip.enabled = enabled;
    this.choices.update((choices) =>
      choices ? { ...choices, [key]: enabled } : choices,
    );
  }
}
