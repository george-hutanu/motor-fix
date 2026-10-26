import { createPrivateKey, type KeyObject, sign } from 'node:crypto';

import {
  LIVE_PROVIDER_TIMEOUT_MS,
  type LiveVideoSecrets,
} from '@motor-fix/contracts';
import { Logger } from '@nestjs/common';
import { type Span, SpanStatusCode, trace } from '@opentelemetry/api';

import type { LiveInput, LiveVideoProvider } from './live-video.provider';
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
    const call = await this.call('create_input', 'POST', '', {
      meta: { name: `motorfix live session ${session.id}` },
      preferLowLatency: true,
      recording: { mode: 'automatic', requireSignedURLs: true },
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

  async closeInput(inputId: string): Promise<void> {
    const call = await this.call(
      'close_input',
      'DELETE',
      `/${encodeURIComponent(inputId)}`,
    );
    if (call.failed) throw new Error(`live input close failed: ${call.failed}`);
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
    operation: 'create_input' | 'close_input',
    method: 'POST' | 'DELETE',
    path: string,
    body?: object,
  ): Promise<Call> {
    const url = `${this.api}/accounts/${this.secrets.CLOUDFLARE_STREAM_ACCOUNT_ID}/stream/live_inputs${path}`;
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
