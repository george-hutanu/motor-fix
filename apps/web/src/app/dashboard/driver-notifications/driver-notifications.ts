import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  Injector,
  inject,
  type OnInit,
  signal,
  viewChildren,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NOTIFICATION_GROUPS,
  type NotificationGroupKey,
} from '@motor-fix/contracts/notification-groups';
import {
  type NotificationPreferenceDto,
  type NotificationPreferencesDto,
  NotificationsService,
} from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import {
  HlmButton,
  HlmRadio,
  HlmRadioGroup,
  HlmSwitch,
  toast,
} from '@motor-fix/ui-cockpit';
import { debounceTime, filter } from 'rxjs';

import { Live } from '../live';
import { NewsConsent } from '../news-consent/news-consent';
import { PushDevice, type PushState } from '../push-device';

type Choices = Record<NotificationGroupKey, boolean>;
type Flip = { enabled: boolean };
type Channel = NotificationPreferenceDto['channel'];
type Entry = Pick<
  NotificationPreferenceDto,
  'alwaysSent' | 'channel' | 'channels' | 'enabled' | 'type'
>;
// A pick shown but not yet saved.
type Pick_ = { channel: Channel };

// What the channel step needs of the read, with its defaults for an answer
// that predates it.
interface Reach {
  phoneVerified: boolean;
  pushDevice: boolean;
  sms: { cap: number; used: number };
}

const NO_REACH: Reach = {
  phoneVerified: false,
  pushDevice: false,
  sms: { cap: 0, used: 0 },
};

const PUSH_HINTS: Partial<Record<PushState, string>> = {
  blocked: 'shell.push.blocked',
  'ios-hint': 'shell.push.iosHint',
  loading: 'shell.push.unavailable',
  off: 'shell.push.off',
  unavailable: 'shell.push.unavailable',
  unsupported: 'shell.push.unsupported',
};

const needsPhone = (channel: Channel) =>
  channel === 'sms' || channel === 'whatsapp';

const reachOf = (answer: NotificationPreferencesDto): Reach => ({
  phoneVerified: answer.phoneVerified === true,
  pushDevice: answer.pushDevice === true,
  sms: answer.sms ?? NO_REACH.sms,
});

// What a driver with nothing saved gets: every group but news.
const DEFAULTS = Object.fromEntries(
  NOTIFICATION_GROUPS.map((key) => [key, key !== 'news']),
) as Choices;

// The driver's five group switches, each saved on its own when flipped.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmRadio, HlmRadioGroup, HlmSwitch, TranslatePipe],
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
  private readonly injector = inject(Injector);
  private readonly pickers = viewChildren(HlmRadioGroup);

  private readonly choices = signal<Choices | undefined>(undefined);
  // Flips shown but not yet settled (a save in flight or the consent step
  // open): a re-read keeps them, so a switch never jumps under the driver.
  private readonly unsettled = new Map<NotificationGroupKey, Flip>();
  // The same for a type's channel.
  private readonly picking = new Map<string, Pick_>();
  // The driver's own types as last read, a pick in flight shown over them.
  private readonly entries = signal<ReadonlyMap<string, Entry>>(new Map());
  private readonly groupTypes = signal<
    Partial<Record<NotificationGroupKey, readonly string[]>>
  >({});
  protected readonly reach = signal<Reach>(NO_REACH);
  // The groups whose types are shown.
  protected readonly opened = signal<ReadonlySet<NotificationGroupKey>>(
    new Set(),
  );
  // Why the last push pick of a group did not go through.
  protected readonly pushHint = signal<{
    key: NotificationGroupKey;
    copy: string;
  } | null>(null);
  private consentVersion = '';
  // Only the latest of overlapping reads is shown.
  private reads = 0;
  protected readonly failed = signal(false);
  protected readonly loaded = computed(() => this.choices() !== undefined);
  protected readonly rows = computed(() => {
    const choices = this.choices() ?? DEFAULTS;
    const entries = this.entries();
    const groupTypes = this.groupTypes();
    return NOTIFICATION_GROUPS.map((key) => {
      const types = (groupTypes[key] ?? []).flatMap(
        (type) => entries.get(type) ?? [],
      );
      return {
        enabled: choices[key],
        key,
        phone: types.some((t) => t.channels.some(needsPhone)),
        sms: types.some((t) => t.channels.includes('sms')),
        types,
      };
    });
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
        debounceTime(300),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => void this.load());
    this.live.resync
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => void this.load());
    void this.load();
  }

  // A failed re-read keeps the switches; only a first read shows the error.
  protected async load() {
    this.failed.set(false);
    const read = ++this.reads;
    try {
      const answer = await this.api.notificationPreferencesControllerRead();
      if (read !== this.reads) return;
      const choices = { ...DEFAULTS };
      for (const group of answer.groups) choices[group.key] = group.enabled;
      for (const [key, flip] of this.unsettled) choices[key] = flip.enabled;
      this.consentVersion = answer.newsConsent.currentTextVersion;
      this.showTypes(answer);
      this.choices.set(choices);
    } catch {
      if (read === this.reads && !this.loaded()) this.failed.set(true);
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
    if (askConsent && !(await this.consent())) {
      this.set(key, flip, false);
      return;
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

  // True only when the driver agrees; a step that cannot open says so.
  private async consent() {
    try {
      const answer = await this.overlays.open<boolean>(NewsConsent, {
        shape: 'dialog',
        title: 'driver.notifications.consent.title',
      });
      return answer === true;
    } catch {
      toast(this.i18n.t('shell.notifications.saveFailed'));
      return false;
    }
  }

  private showTypes(answer: NotificationPreferencesDto) {
    const entries = new Map<string, Entry>();
    for (const entry of answer.preferences) {
      if (entry.garageId !== null) continue;
      const pick = this.picking.get(entry.type);
      entries.set(entry.type, pick ? { ...entry, ...pick } : entry);
    }
    this.entries.set(entries);
    this.groupTypes.set(
      Object.fromEntries(answer.groups.map((g) => [g.key, g.types])),
    );
    this.reach.set(reachOf(answer));
  }

  protected flipOpen(key: NotificationGroupKey) {
    this.opened.update((open) => {
      const next = new Set(open);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  // The radio shows the pick at once; a later state comes from the live
  // re-read. Push first makes this browser a device, unless one is saved.
  protected async pick(key: NotificationGroupKey, type: string, to: string) {
    const entry = this.entries().get(type);
    if (!entry || entry.channel === to) return;
    const channel = to as Channel;
    const was = entry.channel;
    const pick = { channel };
    this.picking.set(type, pick);
    this.show(type, pick, channel);
    this.pushHint.set(null);
    try {
      if (channel === 'push' && !(await this.pushReady(key))) {
        this.show(type, pick, was);
        return;
      }
      await this.api.notificationPreferencesControllerSave({
        body: {
          preferences: [
            { channel, enabled: entry.enabled, garageId: null, type },
          ],
        },
      });
    } catch {
      this.show(type, pick, was);
      toast(this.i18n.t('shell.notifications.saveFailed'));
    } finally {
      if (this.picking.get(type) === pick) this.picking.delete(type);
    }
  }

  // True once the account has a push device; else the group says why not.
  private async pushReady(key: NotificationGroupKey) {
    if (this.reach().pushDevice) return true;
    const device = this.injector.get(PushDevice);
    await device.refresh();
    if (device.state() === 'off') await device.enable();
    const state = device.state();
    if (state === 'on') {
      this.reach.update((reach) => ({ ...reach, pushDevice: true }));
      return true;
    }
    const copy = PUSH_HINTS[state] ?? 'shell.push.unavailable';
    this.pushHint.set({ copy, key });
    return false;
  }

  // A later pick of the same type owns what it shows.
  private show(type: string, pick: Pick_, channel: Channel) {
    if (this.picking.get(type) !== pick) return;
    pick.channel = channel;
    this.entries.update((entries) => {
      const entry = entries.get(type);
      if (!entry) return entries;
      return new Map(entries).set(type, { ...entry, channel });
    });
    this.pickerOf(type)?.reset(channel);
  }

  private pickerOf(type: string) {
    return this.pickers().find((p) => p.name === this.pickerName(type));
  }

  protected pickerName(type: string) {
    return `driver-notifications-${type}`;
  }

  protected isOpen(key: NotificationGroupKey) {
    return this.opened().has(key);
  }

  // The month's SMS are used up: the next ones go by WhatsApp.
  protected smsSpent() {
    const { cap, used } = this.reach().sms;
    return cap > 0 && used >= cap;
  }

  protected locked(channel: Channel) {
    return needsPhone(channel) && !this.reach().phoneVerified;
  }

  protected typeKey(type: string) {
    return `driver.notifications.type.${type}`;
  }

  protected channelKey(channel: Channel) {
    return `driver.notifications.channel.${channel}`;
  }

  protected titleKey(key: NotificationGroupKey) {
    return `driver.notifications.group.${key}.title`;
  }

  protected hintKey(key: NotificationGroupKey) {
    return `driver.notifications.group.${key}.hint`;
  }

  // A later flip of the same switch owns what it shows.
  private set(key: NotificationGroupKey, flip: Flip, enabled: boolean) {
    if (this.unsettled.get(key) !== flip) return;
    flip.enabled = enabled;
    this.choices.update((choices) =>
      choices ? { ...choices, [key]: enabled } : choices,
    );
  }
}
