interface Mailbox {
  email: string;
  name: string;
}

interface OutgoingEmail {
  from: Mailbox;
  to: Mailbox;
  subject: string;
  text: string;
}

export class BrevoError extends Error {
  constructor(
    readonly reason: string,
    readonly retryable: boolean,
  ) {
    super(`Brevo refused the e-mail: ${reason}`);
  }
}

// Brevo's transactional e-mail API: two calls, so no SDK.
export class Brevo {
  readonly timeoutMs: number;
  private readonly apiKey: string;
  private readonly apiUrl: string;

  constructor(options: { apiKey: string; apiUrl: string; timeoutMs?: number }) {
    this.apiKey = options.apiKey;
    this.apiUrl = options.apiUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async send(mail: OutgoingEmail): Promise<string> {
    const res = await this.call('/smtp/email', {
      body: JSON.stringify({
        sender: mail.from,
        subject: mail.subject,
        textContent: mail.text,
        to: [mail.to],
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    if (!res.ok) {
      throw new BrevoError(
        `provider_${res.status}`,
        res.status >= 500 || res.status === 429,
      );
    }
    // Accepted without an id: the e-mail may have gone, so it is not retried.
    const answer = (await res.json().catch(() => null)) as {
      messageId?: unknown;
    } | null;
    if (typeof answer?.messageId !== 'string')
      throw new BrevoError('provider_bad_answer', false);
    return answer.messageId;
  }

  async checkKey(): Promise<boolean> {
    const res = await this.call('/account', { method: 'GET' }).catch(
      () => null,
    );
    return res?.ok ?? false;
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
