import { Injectable, Injector, inject, signal } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { NotificationsService } from '@motor-fix/data-access';
import { firstValueFrom } from 'rxjs';

import { PUSH_ENV, pushSupport } from './push-support';
import { httpStatus } from '../http-status';

export type PushState =
  | 'loading'
  | 'unavailable'
  | 'ios-hint'
  | 'unsupported'
  | 'blocked'
  | 'off'
  | 'on';

// This browser's push device: asks permission only when told to (a tap),
// saves the device with the API and keeps it in step with the browser.
@Injectable({ providedIn: 'root' })
export class PushDevice {
  private readonly env = inject(PUSH_ENV);
  private readonly sw = inject(SwPush, { optional: true });
  private readonly injector = inject(Injector);
  readonly state = signal<PushState>('loading');
  // A save, a removal or the test did not go through; retry is the same button.
  readonly failed = signal(false);
  // A tap is being answered; the buttons wait.
  readonly busy = signal(false);
  private key: string | null = null;
  private id: string | null = null;

  private get api() {
    return this.injector.get(NotificationsService);
  }

  // On app start and when the panel opens: read the state from the browser.
  // A browser that already has push on saves its device again, so an address
  // the service worker changed is not lost (FR-017).
  async refresh(): Promise<void> {
    if (this.busy()) return;
    const support = pushSupport(this.env);
    if (support !== 'supported' || !this.sw?.isEnabled) {
      this.state.set(support === 'supported' ? 'unsupported' : support);
      return;
    }
    try {
      this.state.set(await this.read(this.sw));
    } catch {
      this.state.set(this.key ? 'off' : 'unavailable');
    }
  }

  private async read(sw: SwPush): Promise<PushState> {
    this.key ??= (await this.api.pushSubscriptionsControllerKey()).publicKey;
    if (!this.key) return 'unavailable';
    if (this.env.permission() === 'denied') return 'blocked';
    const current = await firstValueFrom(sw.subscription);
    if (!current || this.env.permission() !== 'granted') return 'off';
    await this.save(current);
    return 'on';
  }

  async enable(): Promise<void> {
    if (this.state() !== 'off' || !this.key || !this.sw || this.busy()) return;
    this.busy.set(true);
    this.failed.set(false);
    try {
      const subscription = await this.sw.requestSubscription({
        serverPublicKey: this.key,
      });
      await this.save(subscription);
      this.state.set('on');
    } catch {
      const denied = this.env.permission() === 'denied';
      this.failed.set(!denied);
      this.state.set(denied ? 'blocked' : 'off');
    } finally {
      this.busy.set(false);
    }
  }

  async disable(): Promise<void> {
    if (this.state() !== 'on' || this.busy()) return;
    this.busy.set(true);
    this.failed.set(false);
    try {
      await this.removeFromServer();
      await this.sw?.unsubscribe();
      this.state.set('off');
    } catch {
      this.failed.set(true);
    } finally {
      this.busy.set(false);
    }
  }

  // True when the test went to the queue.
  async test(): Promise<boolean> {
    if (this.state() !== 'on') return false;
    this.failed.set(false);
    try {
      await this.api.pushSubscriptionsControllerTest();
      return true;
    } catch {
      this.failed.set(true);
      return false;
    }
  }

  // Before a sign-out: this browser stops getting the signed-out person's
  // messages. Never throws, never holds the sign-out back.
  async forget(): Promise<void> {
    if (this.state() !== 'on') return;
    try {
      await this.removeFromServer();
      await this.sw?.unsubscribe();
    } catch {
      // The server drops a dead device by itself on the first push.
    }
    this.state.set('off');
  }

  private async save(subscription: PushSubscription) {
    const json = subscription.toJSON();
    const { id } = await this.api.pushSubscriptionsControllerSave({
      body: {
        endpoint: subscription.endpoint,
        keys: {
          auth: json.keys?.['auth'] ?? '',
          p256dh: json.keys?.['p256dh'] ?? '',
        },
      },
    });
    this.id = id;
  }

  private async removeFromServer() {
    const id = this.id;
    this.id = null;
    if (!id) return;
    try {
      await this.api.pushSubscriptionsControllerRemove({ id });
    } catch (error) {
      if (httpStatus(error) !== 404) {
        this.id = id;
        throw error;
      }
    }
  }
}
