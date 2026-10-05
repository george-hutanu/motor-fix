interface Mailbox {
  email: string;
  name: string;
}

interface OutgoingEmail {
  from: Mailbox;
  to: Mailbox;
  subject: string;
  text: string;
  html: string;
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
    return this.post('/smtp/email', {
      htmlContent: mail.html,
      sender: mail.from,
      subject: mail.subject,
      textContent: mail.text,
      to: [mail.to],
    });
  }

  sendSms(sms: OutgoingSms): Promise<string> {
    return this.post('/transactionalSMS/sms', {
      content: sms.content,
      recipient: digits(sms.recipient),
      sender: sms.sender,
      type: 'transactional',
    });
  }

  sendWhatsApp(message: OutgoingWhatsApp): Promise<string> {
    return this.post('/whatsapp/sendMessage', {
      contactNumbers: [digits(message.to)],
      ...(message.params.length ? { params: message.params } : {}),
      senderNumber: digits(message.sender),
      templateId: message.templateId,
    });
  }

  async checkKey(): Promise<boolean> {
    const res = await this.call('/account', { method: 'GET' }).catch(
      () => null,
    );
    return res?.ok ?? false;
  }

  // Answers Brevo's message id. Accepted without one, the message may have
  // gone, so it is not retried.
  private async post(path: string, body: object): Promise<string> {
    const res = await this.call(path, {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    if (!res.ok) {
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
    throw new BrevoError('provider_bad_answer', false);
  }

  private async call(path: string, init: RequestInit) {
    try {
      return await fetch(`${this.apiUrl}${path}`, {
        ...init,
        headers: {
          ...init.headers,
          accept: 'application/json',
          'api-key': this.apiKey,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new BrevoError('provider_unreachable', true);
    }
  }
}
