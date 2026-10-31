import type { Job } from 'bullmq';

import {
  DIRECT_SEND_WAIT_MS,
  type DirectSendJob,
  sendDirect,
} from './direct-send';
import { DirectSend } from './direct-send.client';
import { type Brevo, BrevoError } from '../brevo/brevo';
import { testConfig, testPhoneConfig } from '../notifications.testing';

const TO = '+40722123456';
const values = {
  car: 'Dacia Logan',
  days: 7,
  link: 'https://motorfix.example/ro/transfer/abc',
};

function sender(
  sendWhatsApp: Brevo['sendWhatsApp'] = async () => 'wa-1',
  send: Brevo['send'] = async () => 'em-1',
) {
  const brevo = { send: jest.fn(send), sendWhatsApp: jest.fn(sendWhatsApp) };
  return {
    brevo,
    email: testConfig('http://brevo.test'),
    phone: testPhoneConfig({
      PHONE_ALLOWLIST: '+407*',
      WHATSAPP_TEMPLATES:
        'motorfix_car_transfer_link_ro=41,motorfix_car_transfer_link_en=42',
    }),
  };
}

function job(
  name: string,
  data: Partial<DirectSendJob> = {},
  timestamp: number = Date.now(),
): Job<DirectSendJob> {
  return {
    data: {
      language: 'ro',
      template: 'CAR_TRANSFER_LINK',
      to: TO,
      values,
      ...data,
    },
    name,
    timestamp,
  } as Job<DirectSendJob>;
}

function client(
  add: () => Promise<unknown>,
  wait: () => Promise<unknown> = async () => null,
  ready: () => Promise<unknown> = async () => undefined,
) {
  const queue = {
    add: jest.fn(async () => {
      await add();
      return {
        remove: async () => undefined,
        waitUntilFinished: jest.fn(wait),
      };
    }),
    close: jest.fn(async () => undefined),
    getBackend: () => ({ publishEvent: async () => '1-0' }),
  };
  const events = { close: jest.fn(), waitUntilReady: jest.fn(ready) };
  return { queue, send: new DirectSend(queue as never, () => events as never) };
}

const code = (s: DirectSend) =>
  s.whatsapp('SIGN_IN_CODE', 'ro', { code: '123456', minutes: 10 }, TO);

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// @traces 1379-FR-004
describe('sendDirect age guard boundary', () => {
  it('sends a job exactly as old as the wait cap', async () => {
    const now = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const s = sender();

    expect(
      await sendDirect(s, job('whatsapp', {}, now - DIRECT_SEND_WAIT_MS)),
    ).toBeNull();
    expect(s.brevo.sendWhatsApp).toHaveBeenCalledTimes(1);
  });

  it('answers stale one millisecond past the cap and calls nothing', async () => {
    const now = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const s = sender();

    expect(
      await sendDirect(s, job('email', {}, now - DIRECT_SEND_WAIT_MS - 1)),
    ).toBe('stale');
    expect(s.brevo.send).not.toHaveBeenCalled();
    expect(s.brevo.sendWhatsApp).not.toHaveBeenCalled();
  });

  it('answers stale for a job that carries no timestamp rather than sending it', async () => {
    const s = sender();
    const untimed = job('whatsapp');
    (untimed as { timestamp?: number }).timestamp = undefined;

    expect(await sendDirect(s, untimed)).toBe('stale');
    expect(s.brevo.sendWhatsApp).not.toHaveBeenCalled();
  });
});

// @traces 1379-FR-002
describe('sendDirect hostile jobs', () => {
  it('calls no provider for an unknown channel name', async () => {
    const s = sender();

    await sendDirect(s, job('sms')).catch(() => undefined);

    expect(s.brevo.sendWhatsApp).not.toHaveBeenCalled();
    expect(s.brevo.send).not.toHaveBeenCalled();
  });

  it('calls no provider for a prototype-chain template name', async () => {
    const s = sender();

    await sendDirect(s, job('whatsapp', { template: '__proto__' })).catch(
      () => undefined,
    );
    await sendDirect(s, job('whatsapp', { template: 'constructor' })).catch(
      () => undefined,
    );

    expect(s.brevo.sendWhatsApp).not.toHaveBeenCalled();
  });

  it('fails without the recipient in the reason when the template has no values', async () => {
    const s = sender();

    const error = await sendDirect(s, job('whatsapp', { values: {} })).then(
      () => null,
      (e: Error) => e,
    );

    expect(s.brevo.sendWhatsApp).toHaveBeenCalledTimes(0);
    expect(error?.message ?? '').not.toContain(TO);
  });

  it('calls no provider for an empty recipient', async () => {
    const s = sender();

    const answer = await sendDirect(s, job('whatsapp', { to: '' })).catch(
      () => 'failed',
    );

    expect(answer).not.toBeNull();
    expect(s.brevo.sendWhatsApp).not.toHaveBeenCalled();
  });

  it('calls no provider for a number with a trailing newline outside the allowlist', async () => {
    const s = sender();

    const answer = await sendDirect(
      s,
      job('whatsapp', { to: '+40822123456\n' }),
    );

    expect(answer).toBe('not_allowed');
    expect(s.brevo.sendWhatsApp).not.toHaveBeenCalled();
  });

  it('maps a provider that throws synchronously to provider_error, never its message', async () => {
    const s = sender(() => {
      throw new Error(`boom ${TO}`);
    });

    await expect(sendDirect(s, job('whatsapp'))).rejects.toThrow(
      /^provider_error$/,
    );
  });

  it('maps an e-mail provider that throws synchronously to provider_error', async () => {
    const s = sender(undefined, () => {
      throw new Error('smtp secret key=abc');
    });

    await expect(
      sendDirect(
        s,
        job('email', {
          template: 'STAFF_INVITE.owner',
          to: 'ana@example.test',
          values: {
            app: 'https://m.test',
            garage: 'G',
            link: 'https://m.test/i',
          },
        }),
      ),
    ).rejects.toThrow(/^provider_error$/);
  });

  it('fails with the provider reason for a refusal and calls once', async () => {
    const s = sender(async () => {
      throw new BrevoError('rejected', false);
    });

    await expect(sendDirect(s, job('whatsapp'))).rejects.toThrow(/^rejected$/);
    expect(s.brevo.sendWhatsApp).toHaveBeenCalledTimes(1);
  });
});

// @traces 1379-FR-003
describe('DirectSend failure paths', () => {
  it('answers a failure kind when the job fails with a null rejection', async () => {
    const c = client(
      async () => undefined,
      () => Promise.reject(null),
    );

    expect(await code(c.send)).toBe('provider_error');
  });

  it('answers a failure kind when the job fails with undefined', async () => {
    const c = client(
      async () => undefined,
      () => Promise.reject(undefined),
    );

    expect(await code(c.send)).toBe('provider_error');
  });

  it('answers provider_error for a failed reason holding a number, an address or spaces', async () => {
    for (const reason of [TO, 'a@b.ro', 'has space', '', 'Provider_Error']) {
      const c = client(
        async () => undefined,
        () => Promise.reject(new Error(reason)),
      );

      expect(await code(c.send)).toBe('provider_error');
    }
  });

  it('answers queue_unavailable when the listener is not ready', async () => {
    const c = client(
      async () => undefined,
      async () => null,
      () => Promise.reject(new Error('ECONNREFUSED')),
    );

    expect(await code(c.send)).toBe('queue_unavailable');
  });

  it('answers queue_unavailable when the queue throws before returning a promise', async () => {
    const c = client(async () => undefined);
    c.queue.add.mockImplementation(() => {
      throw new Error('connection closed');
    });

    expect(await code(c.send)).toBe('queue_unavailable');
  });

  it('keeps no timer pending after an answer', async () => {
    jest.useFakeTimers();
    const c = client(async () => undefined);

    expect(await code(c.send)).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps no timer pending after a failure', async () => {
    jest.useFakeTimers();
    const c = client(async () => {
      throw new Error('down');
    });

    expect(await code(c.send)).toBe('queue_unavailable');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('gives two concurrent sends a job each with their own answer', async () => {
    const results = [null, 'blocked'];
    const queue = {
      add: jest.fn(async () => {
        const result = results.shift();
        return {
          remove: async () => undefined,
          waitUntilFinished: async () => result,
        };
      }),
      close: jest.fn(),
      getBackend: () => ({ publishEvent: async () => '1-0' }),
    };
    const events = { close: jest.fn(), waitUntilReady: async () => undefined };
    const s = new DirectSend(queue as never, () => events as never);

    const [a, b] = await Promise.all([code(s), code(s)]);

    expect(queue.add).toHaveBeenCalledTimes(2);
    expect([a, b]).toEqual([null, 'blocked']);
  });

  it('carries unicode recipients and values into the job untouched', async () => {
    const c = client(async () => undefined);

    await c.send.email(
      'STAFF_INVITE.owner',
      'ro',
      { garage: 'Șura Țâncu 🚗' },
      { email: 'ștefan@exemplu.ro', name: 'Ștefan\r\nBcc: x@y.z' },
    );

    expect(c.queue.add).toHaveBeenCalledWith(
      'email',
      expect.objectContaining({
        name: 'Ștefan\r\nBcc: x@y.z',
        to: 'ștefan@exemplu.ro',
        values: { garage: 'Șura Țâncu 🚗' },
      }),
      expect.objectContaining({ attempts: 1 }),
    );
  });
});
