import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { SwPush } from '@angular/service-worker';
import { NotificationsService } from '@motor-fix/data-access';
import { BehaviorSubject } from 'rxjs';

import { PushDevice } from './push-device';
import { PUSH_ENV, type PushEnv } from './push-support';

const subscription = {
  endpoint: 'https://push.example.test/abc',
  toJSON: () => ({ keys: { auth: 'AUTH', p256dh: 'P256' } }),
} as unknown as PushSubscription;

let permission: NotificationPermission;
let current: BehaviorSubject<PushSubscription | null>;
let sw: {
  isEnabled: boolean;
  requestSubscription: jest.Mock;
  subscription: BehaviorSubject<PushSubscription | null>;
  unsubscribe: jest.Mock;
};
let api: {
  pushSubscriptionsControllerKey: jest.Mock;
  pushSubscriptionsControllerRemove: jest.Mock;
  pushSubscriptionsControllerSave: jest.Mock;
  pushSubscriptionsControllerTest: jest.Mock;
};

function device(env: Partial<PushEnv> = {}, withSw = true) {
  permission = 'default';
  current = new BehaviorSubject<PushSubscription | null>(null);
  sw = {
    isEnabled: true,
    requestSubscription: jest.fn(async () => subscription),
    subscription: current,
    unsubscribe: jest.fn(async () => undefined),
  };
  api = {
    pushSubscriptionsControllerKey: jest.fn(async () => ({ publicKey: 'KEY' })),
    pushSubscriptionsControllerRemove: jest.fn(async () => undefined),
    pushSubscriptionsControllerSave: jest.fn(async () => ({ id: 'dev-1' })),
    pushSubscriptionsControllerTest: jest.fn(async () => ({ queued: 1 })),
  };
  TestBed.configureTestingModule({
    providers: [
      {
        provide: PUSH_ENV,
        useValue: {
          hasPushManager: true,
          maxTouchPoints: 0,
          permission: () => permission,
          standalone: false,
          userAgent: 'Chrome',
          ...env,
        },
      },
      ...(withSw ? [{ provide: SwPush, useValue: sw }] : []),
      { provide: NotificationsService, useValue: api },
    ],
  });
  return TestBed.inject(PushDevice);
}

describe('PushDevice', () => {
  it('starts loading and asks nothing of the browser', () => {
    const d = device();
    expect(d.state()).toBe('loading');
    expect(sw.requestSubscription).not.toHaveBeenCalled();
  });

  it('reads off for a browser with push that was never turned on, without prompting', async () => {
    const d = device();
    await d.refresh();
    expect(d.state()).toBe('off');
    expect(sw.requestSubscription).not.toHaveBeenCalled();
    expect(api.pushSubscriptionsControllerSave).not.toHaveBeenCalled();
  });

  it('reads the unsupported and Home Screen states without calling the api', async () => {
    const a = device({ hasPushManager: false });
    await a.refresh();
    expect(a.state()).toBe('unsupported');
    TestBed.resetTestingModule();
    const b = device({ standalone: false, userAgent: 'iPhone' });
    await b.refresh();
    expect(b.state()).toBe('ios-hint');
    expect(api.pushSubscriptionsControllerKey).not.toHaveBeenCalled();
  });

  it('says unsupported when the service worker is not running', async () => {
    const d = device();
    sw.isEnabled = false;
    await d.refresh();
    expect(d.state()).toBe('unsupported');
  });

  it('says unsupported with no service worker at all', async () => {
    const d = device({}, false);
    await d.refresh();
    expect(d.state()).toBe('unsupported');
  });

  it('says unavailable when the server has no key, and when the key call fails', async () => {
    const d = device();
    api.pushSubscriptionsControllerKey.mockResolvedValue({ publicKey: null });
    await d.refresh();
    expect(d.state()).toBe('unavailable');
    TestBed.resetTestingModule();
    const e = device();
    api.pushSubscriptionsControllerKey.mockRejectedValue(new Error('down'));
    await e.refresh();
    expect(e.state()).toBe('unavailable');
  });

  it('says blocked when the browser denied permission', async () => {
    const d = device();
    permission = 'denied';
    await d.refresh();
    expect(d.state()).toBe('blocked');
  });

  it('saves a device the browser already holds again on refresh', async () => {
    const d = device();
    permission = 'granted';
    current.next(subscription);
    await d.refresh();
    expect(d.state()).toBe('on');
    expect(api.pushSubscriptionsControllerSave).toHaveBeenCalledWith({
      body: {
        endpoint: 'https://push.example.test/abc',
        keys: { auth: 'AUTH', p256dh: 'P256' },
        label: 'Chrome',
      },
    });
  });

  it('reads off when the save on refresh fails, to try again next start', async () => {
    const d = device();
    permission = 'granted';
    current.next(subscription);
    api.pushSubscriptionsControllerSave.mockRejectedValue(new Error('down'));
    await d.refresh();
    expect(d.state()).toBe('off');
  });

  it('asks permission on enable, with the server key, and saves the device', async () => {
    const d = device();
    await d.refresh();
    await d.enable();
    expect(sw.requestSubscription).toHaveBeenCalledWith({
      serverPublicKey: 'KEY',
    });
    expect(d.state()).toBe('on');
    expect(d.failed()).toBe(false);
    expect(d.busy()).toBe(false);
  });

  it('goes blocked when the person refuses the prompt', async () => {
    const d = device();
    await d.refresh();
    sw.requestSubscription.mockImplementation(async () => {
      permission = 'denied';
      throw new Error('denied');
    });
    await d.enable();
    expect(d.state()).toBe('blocked');
    expect(d.failed()).toBe(false);
  });

  it('shows an error and stays off when the save fails', async () => {
    const d = device();
    await d.refresh();
    api.pushSubscriptionsControllerSave.mockRejectedValue(
      new HttpErrorResponse({ status: 500 }),
    );
    await d.enable();
    expect(d.state()).toBe('off');
    expect(d.failed()).toBe(true);
    expect(d.busy()).toBe(false);
  });

  it('ignores a second enable while one is in flight', async () => {
    const d = device();
    await d.refresh();
    await Promise.all([d.enable(), d.enable()]);
    expect(sw.requestSubscription).toHaveBeenCalledTimes(1);
  });

  it('turns off: deletes the device and unsubscribes', async () => {
    const d = device();
    await d.refresh();
    await d.enable();
    await d.disable();
    expect(api.pushSubscriptionsControllerRemove).toHaveBeenCalledWith({
      id: 'dev-1',
    });
    expect(sw.unsubscribe).toHaveBeenCalled();
    expect(d.state()).toBe('off');
  });

  it('stays on with an error when the delete fails, and treats 404 as done', async () => {
    const d = device();
    await d.refresh();
    await d.enable();
    api.pushSubscriptionsControllerRemove.mockRejectedValueOnce(
      new HttpErrorResponse({ status: 500 }),
    );
    await d.disable();
    expect(d.state()).toBe('on');
    expect(d.failed()).toBe(true);
    api.pushSubscriptionsControllerRemove.mockRejectedValueOnce(
      new HttpErrorResponse({ status: 404 }),
    );
    await d.disable();
    expect(d.state()).toBe('off');
  });

  it('sends the test only while on', async () => {
    const d = device();
    await d.refresh();
    expect(await d.test()).toBe(false);
    await d.enable();
    expect(await d.test()).toBe(true);
    api.pushSubscriptionsControllerTest.mockRejectedValue(new Error('x'));
    expect(await d.test()).toBe(false);
    expect(d.failed()).toBe(true);
  });

  it('forgets the device before a sign-out and never throws', async () => {
    const d = device();
    await d.refresh();
    await d.enable();
    api.pushSubscriptionsControllerRemove.mockRejectedValue(new Error('x'));
    await expect(d.forget()).resolves.toBeUndefined();
    expect(d.state()).toBe('off');
    expect(sw.unsubscribe).not.toHaveBeenCalled();
  });

  it('signs out after a short wait when the delete never answers', async () => {
    const d = device();
    await d.refresh();
    await d.enable();
    api.pushSubscriptionsControllerRemove.mockReturnValue(
      new Promise(() => undefined),
    );
    await expect(d.forget(10)).resolves.toBeUndefined();
    expect(d.state()).toBe('off');
  });

  it('does nothing on forget when push is not on', async () => {
    const d = device();
    await d.refresh();
    await d.forget();
    expect(api.pushSubscriptionsControllerRemove).not.toHaveBeenCalled();
  });
});
