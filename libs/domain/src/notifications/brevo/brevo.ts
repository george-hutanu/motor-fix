import { systemLog } from '../../admin/system-log/system-log';

interface Mailbox {
  email: string;
  // A listing draft's address comes with no name.
  name?: string;
}

interface OutgoingEmail {
  from: Mailbox;
  to: Mailbox;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
  // Where a reply goes, when not to the sender.
  replyTo?: Mailbox;
}

interface OutgoingSms {
  sender: string;
  // E.164, with its plus.
  recipient: string;
  content: string;
}

interface OutgoingWhatsApp {
  sender: string;
  to: string;
  templateId: number;
  params: readonly string[];
}

// The system status log's source for each kind of send.
type Channel = 'email' | 'notifications';

// A failed send in the system status log: the HTTP status Brevo answered, or
// why there was no usable answer. Never awaited: the send does not wait.
const logFailure = (
  source: Channel,
  answer: { status: number } | { reason: string },
) => {
  void systemLog.write('service_error', source, {
    provider: 'brevo',
    ...answer,
  });
};

export class BrevoError extends Error {
  constructor(
    readonly reason: string,
    readonly retryable: boolean,
  ) {
    super(`Brevo refused the message: ${reason}`);
  }
}

// Brevo numbers carry the country code without its plus.
const digits = (phone: string) => phone.replace(/^\+/, '');

// Brevo's transactional e-mail, SMS and WhatsApp APIs: a few calls, so no SDK.
export class Brevo {
  private readonly timeoutMs: number;
  private readonly apiKey: string;
  private readonly apiUrl: string;

  constructor(options: { apiKey: string; apiUrl: string; timeoutMs?: number }) {
    this.apiKey = options.apiKey;
    this.apiUrl = options.apiUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  send(mail: OutgoingEmail): Promise<string> {
    return this.post('email', '/smtp/email', {
      ...(mail.headers ? { headers: mail.headers } : {}),
      htmlContent: mail.html,
      ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
      sender: mail.from,
      subject: mail.subject,
      textContent: mail.text,
      to: [mail.to],
    });
  }

  sendSms(sms: OutgoingSms): Promise<string> {
    return this.post('notifications', '/transactionalSMS/sms', {
      content: sms.content,
      recipient: digits(sms.recipient),
      sender: sms.sender,
      type: 'transactional',
    });
  }

  sendWhatsApp(message: OutgoingWhatsApp): Promise<string> {
    return this.post('notifications', '/whatsapp/sendMessage', {
      contactNumbers: [digits(message.to)],
      ...(message.params.length ? { params: message.params } : {}),
      senderNumber: digits(message.sender),
      templateId: message.templateId,
    });
  }

  // An aborted signal gives up on the check, which then answers false.
  async checkKey(signal?: AbortSignal): Promise<boolean> {
    const res = await this.call('/account', { method: 'GET' }, signal).catch(
      () => null,
    );
    return res?.ok ?? false;
  }

  // Answers Brevo's message id. Accepted without one, the message may have
  // gone, so it is not retried.
  private async post(
    source: Channel,
    path: string,
    body: object,
  ): Promise<string> {
    const res = await this.call(path, {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }).catch((error: BrevoError) => {
      logFailure(source, { reason: error.reason });
      throw error;
    });
    if (!res.ok) {
      logFailure(source, { status: res.status });
      throw new BrevoError(
        `provider_${res.status}`,
        res.status >= 500 || res.status === 429,
      );
    }
    const answer = (await res.json().catch(() => null)) as {
      messageId?: unknown;
    } | null;
    const id = answer?.messageId;
    if (typeof id === 'string' || typeof id === 'number') return String(id);
    logFailure(source, { reason: 'provider_bad_answer' });
    throw new BrevoError('provider_bad_answer', false);
  }

  private async call(path: string, init: RequestInit, signal?: AbortSignal) {
    try {
      return await fetch(`${this.apiUrl}${path}`, {
        ...init,
        headers: {
          ...init.headers,
          accept: 'application/json',
          'api-key': this.apiKey,
        },
        signal: signal
          ? AbortSignal.any([AbortSignal.timeout(this.timeoutMs), signal])
          : AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new BrevoError('provider_unreachable', true);
    }
  }
}
