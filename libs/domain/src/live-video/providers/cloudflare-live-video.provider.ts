import { createPrivateKey, type KeyObject, sign } from 'node:crypto';

import {
  LIVE_PROVIDER_TIMEOUT_MS,
  type LiveVideoSecrets,
} from '@motor-fix/contracts';
import { Logger } from '@nestjs/common';
import { type Span, SpanStatusCode, trace } from '@opentelemetry/api';

import type {
  InputStatus,
  LiveInput,
  LiveVideoProvider,
} from './live-video.provider';
import { recordProviderCall } from '../sessions/sessions.metrics';

const API = 'https://api.cloudflare.com/client/v4';

const tracer = () => trace.getTracer('motorfix');

const base64url = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

// Cloudflare's keys API hands the PEM out base64-encoded, one line that fits
// an environment variable; a raw PEM is taken as it is, its line breaks
// pasted as `\n` too. Only an RSA key signs the RS256 view token.
export function signingKey(value: string): KeyObject {
  const text = value.replaceAll('\\n', '\n');
  const pem = text.startsWith('-----BEGIN')
    ? text
    : Buffer.from(text, 'base64').toString('utf8');
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'rsa') throw new Error('not an RSA key');
  return key;
}

type Call = { body?: unknown; failed?: string };
type Operation =
  | 'create_input'
  | 'close_input'
  | 'delete_input'
  | 'delete_recording'
  | 'input_status';

// Sent on create and again on close, so the update cannot reset them.
const RECORDING = { mode: 'automatic', requireSignedURLs: true } as const;

// The states Cloudflare gives an input with a publisher on it.
const CONNECTED = new Set(['connected', 'reconnected']);

// Cloudflare Stream Live: a WHIP input per session, recorded, played back
// only through a token this adapter signs itself. Its log lines and answers
// carry the reason a call failed, never the token or the key.
export class CloudflareLiveVideo implements LiveVideoProvider {
  readonly name = 'cloudflare';
  private readonly logger = new Logger('LiveVideo');
  private readonly key: KeyObject;

  constructor(
    private readonly secrets: LiveVideoSecrets,
    private readonly api: string = API,
  ) {
    this.key = signingKey(secrets.CLOUDFLARE_STREAM_SIGNING_KEY_PEM);
  }

  async createInput(session: { id: string }): Promise<LiveInput> {
    const call = await this.call('create_input', 'POST', '/live_inputs', {
      meta: { name: `motorfix live session ${session.id}` },
      preferLowLatency: true,
      recording: RECORDING,
    });
    if (call.failed) return this.unavailable(call.failed);
    const body = call.body as {
      success?: unknown;
      result?: { uid?: unknown; webRTC?: { url?: unknown } };
    } | null;
    if (body?.success === false) return this.unavailable('rejected');
    const inputId = body?.result?.uid;
    const publishUrl = body?.result?.webRTC?.url;
    if (
      typeof inputId !== 'string' ||
      !inputId ||
      typeof publishUrl !== 'string' ||
      !publishUrl.startsWith('https://')
    )
      return this.unavailable('malformed');
    return { inputId, publishUrl };
  }

  // Disabled, never deleted: a kept recording is reached by its input.
  async closeInput(inputId: string): Promise<void> {
    const call = await this.call(
      'close_input',
      'PUT',
      `/live_inputs/${encodeURIComponent(inputId)}`,
      { enabled: false, recording: RECORDING },
    );
    if (call.failed === '404') return;
    const body = call.body as {
      success?: unknown;
      result?: { enabled?: unknown } | null;
    } | null;
    const failed =
      call.failed ??
      (body?.success === false
        ? 'rejected'
        : body?.result?.enabled !== false
          ? 'still_enabled'
          : undefined);
    if (failed) throw new Error(`live input close failed: ${failed}`);
  }

  async deleteInput(inputId: string): Promise<void> {
    const call = await this.call(
      'delete_input',
      'DELETE',
      `/live_inputs/${encodeURIComponent(inputId)}`,
    );
    // Cloudflare answers the delete with no body, which reads as malformed.
    if (call.failed && call.failed !== '404' && call.failed !== 'malformed') {
      throw new Error(`live input delete failed: ${call.failed}`);
    }
  }

  // The reference is the live input: its recordings are listed and each is
  // deleted. A 404 on either call is a recording already gone; an answer
  // with no JSON body is a delete the provider accepted.
  async deleteRecording(inputId: string): Promise<void> {
    const list = await this.call(
      'delete_recording',
      'GET',
      `/live_inputs/${encodeURIComponent(inputId)}/videos`,
    );
    if (list.failed === '404') return;
    if (list.failed) throw new Error(`recording delete failed: ${list.failed}`);
    for (const uid of videoUids(list.body)) {
      const call = await this.call(
        'delete_recording',
        'DELETE',
        `/${encodeURIComponent(uid)}`,
      );
      if (call.failed && call.failed !== '404' && call.failed !== 'malformed') {
        throw new Error(`recording delete failed: ${call.failed}`);
      }
    }
  }

  // The input's current state: a connected or reconnected publisher, or none
  // since the state was entered; an input with no state never had one, and
  // an input already gone has none.
  async inputStatus(inputId: string): Promise<InputStatus> {
    const call = await this.call(
      'input_status',
      'GET',
      `/live_inputs/${encodeURIComponent(inputId)}`,
    );
    if (call.failed === '404') return { connected: false, since: null };
    if (call.failed) throw new Error(`input status failed: ${call.failed}`);
    const body = call.body as {
      success?: unknown;
      result?: { status?: { current?: Record<string, unknown> } | null };
    } | null;
    if (body?.success === false || !body?.result) {
      throw new Error('input status failed: malformed');
    }
    const current = body.result.status?.current;
    if (!current) return { connected: false, since: null };
    const entered = new Date(String(current['statusEnteredAt']));
    return {
      connected: CONNECTED.has(String(current['state'])),
      since: Number.isNaN(entered.getTime()) ? null : entered,
    };
  }

  viewUrl(inputId: string, expiresAt: Date): string {
    const header = base64url({
      alg: 'RS256',
      kid: this.secrets.CLOUDFLARE_STREAM_SIGNING_KEY_ID,
    });
    const payload = base64url({
      exp: Math.floor(expiresAt.getTime() / 1000),
      sub: inputId,
    });
    const data = `${header}.${payload}`;
    const signature = sign('sha256', Buffer.from(data), this.key).toString(
      'base64url',
    );
    const host = new URL('https://cloudflarestream.com');
    host.hostname = `customer-${this.secrets.CLOUDFLARE_STREAM_CUSTOMER_CODE}.${host.hostname}`;
    return `${host.origin}/${data}.${signature}/manifest/video.m3u8?protocol=llhls`;
  }

  private call(
    operation: Operation,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: object,
  ): Promise<Call> {
    const url = `${this.api}/accounts/${this.secrets.CLOUDFLARE_STREAM_ACCOUNT_ID}/stream${path}`;
    return tracer().startActiveSpan(`live-video.${operation}`, async (span) => {
      span.setAttributes({
        'http.host': new URL(url).host,
        'live.operation': operation,
        'live.provider': this.name,
      });
      const started = performance.now();
      try {
        return await this.send(span, url, method, body);
      } finally {
        recordProviderCall(
          this.name,
          operation,
          (performance.now() - started) / 1000,
        );
        span.end();
      }
    });
  }

  private async send(
    span: Span,
    url: string,
    method: string,
    body?: object,
  ): Promise<Call> {
    let response: Response;
    try {
      response = await fetch(url, {
        body: body && JSON.stringify(body),
        headers: {
          Authorization: `Bearer ${this.secrets.CLOUDFLARE_STREAM_API_TOKEN}`,
          ...(body && { 'Content-Type': 'application/json' }),
        },
        method,
        // A redirect would carry the token to wherever it points.
        redirect: 'manual',
        signal: AbortSignal.timeout(LIVE_PROVIDER_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = (error as Error | undefined)?.name === 'TimeoutError';
      span.setStatus({ code: SpanStatusCode.ERROR });
      return { failed: timedOut ? 'timeout' : 'network' };
    }
    span.setAttribute('http.status', response.status);
    if (!response.ok) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      await response.body?.cancel();
      return { failed: String(response.status) };
    }
    const json: unknown = await response.json().catch(() => null);
    if (json === null) return { failed: 'malformed' };
    return { body: json };
  }

  private unavailable(reason: string): LiveInput {
    this.logger.warn(`live provider failed: create_input ${reason}`);
    return { unavailable: reason };
  }
}

// Every video uid of a live input's list, or a throw when the list is not one.
function videoUids(body: unknown): string[] {
  const listed = body as { success?: unknown; result?: unknown } | null;
  if (listed?.success === false) {
    throw new Error('recording delete failed: rejected');
  }
  const videos = listed?.result;
  if (!Array.isArray(videos)) {
    throw new Error('recording delete failed: malformed');
  }
  return videos.map((video: { uid?: unknown } | null) => {
    if (typeof video?.uid !== 'string' || !video.uid) {
      throw new Error('recording delete failed: malformed');
    }
    return video.uid;
  });
}
