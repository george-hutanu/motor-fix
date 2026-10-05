import type { Agent } from 'node:https';

import { sendNotification, WebPushError } from 'web-push';

import type { PushConfig } from './push-config';

export const PUSH_SENDER = Symbol('PUSH_SENDER');

// 404 and 410: the push service no longer knows the device. A retry may
// still work for a network error, 429 or 5xx; any other answer is final.
export type PushResult = 'sent' | 'gone' | 'retry' | 'refused';

export interface PushDevice {
  endpoint: string;
  p256dh: string;
  auth: string;
}

const DAY_SECONDS = 24 * 60 * 60;

export class PushSender {
  constructor(
    private readonly config: PushConfig,
    private readonly timeoutMs = 10_000,
    // Only tests pass one, to reach a local server without TLS.
    private readonly agent?: Agent,
  ) {}

  async send(
    device: PushDevice,
    payload: string,
    urgent: boolean,
  ): Promise<PushResult> {
    try {
      await sendNotification(
        {
          endpoint: device.endpoint,
          keys: { auth: device.auth, p256dh: device.p256dh },
        },
        payload,
        {
          agent: this.agent,
          TTL: DAY_SECONDS,
          timeout: this.timeoutMs,
          urgency: urgent ? 'high' : 'normal',
          vapidDetails: this.config,
        },
      );
      return 'sent';
    } catch (error) {
      return result(error);
    }
  }
}

function result(error: unknown): PushResult {
  if (!(error instanceof WebPushError)) {
    // A network error or timeout reaches us as a plain Error; keys the
    // browser could not have made are refused by web-push before any request.
    const message = error instanceof Error ? error.message : '';
    return /subscription|key|auth|vapid/i.test(message) ? 'refused' : 'retry';
  }
  const { statusCode } = error;
  if (statusCode === 404 || statusCode === 410) return 'gone';
  if (statusCode === 429 || statusCode >= 500) return 'retry';
  return 'refused';
}

// What Angular's service worker shows, and where a tap on it goes.
export function pushPayload(
  text: { title: string; body: string; link: string },
  icon: string,
): string {
  return JSON.stringify({
    notification: {
      body: text.body,
      data: {
        onActionClick: {
          default: { operation: 'navigateLastFocusedOrOpen', url: text.link },
        },
      },
      icon,
      title: text.title,
    },
  });
}
