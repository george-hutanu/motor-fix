// @traces 195-FR-005 392-FR-001 392-FR-002 392-FR-007
import { Brevo, BrevoError } from './brevo';
import { BrevoMock } from './brevo-mock.testing';
import { systemLog } from '../../admin/system-log/system-log';

const mock = new BrevoMock();
const mail = {
  from: { email: 'noreply@example.test', name: 'MotorFix' },
  html: '<p>Un mesaj</p>',
  subject: 'Salut',
  text: 'Un mesaj',
  to: { email: 'ana@example.test', name: 'Ana' },
};

beforeAll(() => mock.start());
afterAll(() => mock.stop());
beforeEach(() => mock.reset());

const brevo = (timeoutMs?: number) =>
  new Brevo({ apiKey: 'test-key', apiUrl: mock.url, timeoutMs });

describe('the Brevo e-mail adapter', () => {
  it('sends one transactional e-mail and returns its message id', async () => {
    mock.answer({ body: { messageId: '<abc@relay>' }, status: 201 });
    await expect(brevo().send(mail)).resolves.toBe('<abc@relay>');
    expect(mock.emails()).toHaveLength(1);
    const [call] = mock.emails();
    expect(call.method).toBe('POST');
    expect(call.headers['api-key']).toBe('test-key');
    expect(call.body).toEqual({
      htmlContent: '<p>Un mesaj</p>',
      sender: { email: 'noreply@example.test', name: 'MotorFix' },
      subject: 'Salut',
      textContent: 'Un mesaj',
      to: [{ email: 'ana@example.test', name: 'Ana' }],
    });
  });

  // @traces 280-FR-015
  it('sets the reply-to address when given one', async () => {
    mock.answer({ body: { messageId: '<abc@relay>' }, status: 201 });
    await brevo().send({
      ...mail,
      replyTo: { email: 'ion@example.test', name: 'Ion' },
    });
    expect(mock.emails()[0].body).toMatchObject({
      replyTo: { email: 'ion@example.test', name: 'Ion' },
    });
  });

  it('sends no reply-to when given none', async () => {
    mock.answer({ body: { messageId: '<abc@relay>' }, status: 201 });
    await brevo().send(mail);
    expect(mock.emails()[0].body).not.toHaveProperty('replyTo');
  });

  it.each([500, 503, 429])(
    'treats a %s answer as worth retrying',
    async (status) => {
      mock.answer({ status });
      const error = await brevo()
        .send(mail)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BrevoError);
      expect(error).toMatchObject({
        reason: `provider_${status}`,
        retryable: true,
      });
    },
  );

  it.each([400, 401, 403])('does not retry a %s answer', async (status) => {
    mock.answer({ status });
    await expect(brevo().send(mail)).rejects.toMatchObject({
      reason: `provider_${status}`,
      retryable: false,
    });
  });

  it('treats no answer within the timeout as worth retrying', async () => {
    mock.answer({ hang: true, status: 0 });
    await expect(brevo(200).send(mail)).rejects.toMatchObject({
      reason: 'provider_unreachable',
      retryable: true,
    });
  });

  it('treats an unreachable provider as worth retrying', async () => {
    const down = new Brevo({ apiKey: 'k', apiUrl: 'http://127.0.0.1:9/v3' });
    await expect(down.send(mail)).rejects.toMatchObject({
      reason: 'provider_unreachable',
      retryable: true,
    });
  });

  it('accepts a key Brevo knows and refuses one it does not', async () => {
    await expect(brevo().checkKey()).resolves.toBe(true);
    expect(mock.calls.at(-1)).toMatchObject({
      method: 'GET',
      path: '/v3/account',
    });
    mock.answer({ status: 401 });
    await expect(brevo().checkKey()).resolves.toBe(false);
  });
});

describe('the Brevo account check', () => {
  it('gives up, without waiting for its own timeout, when the caller does', async () => {
    mock.answer({ hang: true, status: 0 });
    const caller = new AbortController();
    const checked = brevo(30_000).checkKey(caller.signal);
    setTimeout(() => caller.abort(), 20);
    await expect(checked).resolves.toBe(false);
  });
});

describe('the Brevo SMS adapter', () => {
  const sms = {
    content: 'MotorFix: ITP-ul expiră curând.',
    recipient: '+40712345678',
    sender: 'MotorFix',
  };

  it('sends one transactional SMS to the number without its plus', async () => {
    mock.answer({ body: { messageId: 7781, reference: 'r' }, status: 201 });
    await expect(brevo().sendSms(sms)).resolves.toBe('7781');
    const [call] = mock.sms();
    expect(call.method).toBe('POST');
    expect(call.headers['api-key']).toBe('test-key');
    expect(call.body).toEqual({
      content: 'MotorFix: ITP-ul expiră curând.',
      recipient: '40712345678',
      sender: 'MotorFix',
      type: 'transactional',
    });
  });

  it.each([500, 429])(
    'treats a %s answer as worth retrying',
    async (status) => {
      mock.answer({ status });
      await expect(brevo().sendSms(sms)).rejects.toMatchObject({
        reason: `provider_${status}`,
        retryable: true,
      });
    },
  );

  it('does not retry a refused number', async () => {
    mock.answer({ body: { code: 'invalid_parameter' }, status: 400 });
    await expect(brevo().sendSms(sms)).rejects.toMatchObject({
      reason: 'provider_400',
      retryable: false,
    });
  });

  it('does not retry an answer without a message id', async () => {
    mock.answer({ body: {}, status: 201 });
    await expect(brevo().sendSms(sms)).rejects.toMatchObject({
      reason: 'provider_bad_answer',
      retryable: false,
    });
  });
});

describe('the Brevo WhatsApp adapter', () => {
  const message = {
    params: ['B 123 ABC'],
    sender: '+40700000099',
    templateId: 12,
    to: '+40712345678',
  };

  it('sends the approved template with its values from the sender number', async () => {
    mock.answer({ body: { messageId: 'wa-77' }, status: 201 });
    await expect(brevo().sendWhatsApp(message)).resolves.toBe('wa-77');
    expect(mock.whatsapp()[0].body).toEqual({
      contactNumbers: ['40712345678'],
      params: ['B 123 ABC'],
      senderNumber: '40700000099',
      templateId: 12,
    });
  });

  it('sends no values for a template without slots', async () => {
    await brevo().sendWhatsApp({ ...message, params: [] });
    expect(mock.whatsapp()[0].body).not.toHaveProperty('params');
  });

  it('does not retry a number that is not on WhatsApp', async () => {
    mock.answer({ body: { code: 'invalid_parameter' }, status: 400 });
    await expect(brevo().sendWhatsApp(message)).rejects.toMatchObject({
      reason: 'provider_400',
      retryable: false,
    });
  });

  it('treats Brevo down as worth retrying', async () => {
    mock.answer({ status: 503 });
    await expect(brevo().sendWhatsApp(message)).rejects.toMatchObject({
      reason: 'provider_503',
      retryable: true,
    });
  });
});

// @traces 297-FR-008
describe('a Brevo error in the system log', () => {
  const sms = {
    content: 'MotorFix: ITP-ul expiră curând.',
    recipient: '+40712345678',
    sender: 'MotorFix',
  };
  const whatsapp = {
    params: ['B 123 ABC'],
    sender: '+40700000099',
    templateId: 12,
    to: '+40712345678',
  };
  let write: jest.SpyInstance;

  beforeEach(() => {
    // A write that never finishes: the send must not wait for it.
    write = jest
      .spyOn(systemLog, 'write')
      .mockReturnValue(new Promise(() => {}));
  });
  afterEach(() => jest.restoreAllMocks());

  it('is written for a refused e-mail as an e-mail error with its status, without waiting for it', async () => {
    mock.answer({ status: 503 });
    await expect(brevo().send(mail)).rejects.toBeInstanceOf(BrevoError);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('service_error', 'email', {
      provider: 'brevo',
      status: 503,
    });
  });

  it('is written for an SMS and a WhatsApp send as a notifications error', async () => {
    mock.answer({ status: 400 });
    await expect(brevo().sendSms(sms)).rejects.toBeInstanceOf(BrevoError);
    mock.answer({ status: 400 });
    await expect(brevo().sendWhatsApp(whatsapp)).rejects.toBeInstanceOf(
      BrevoError,
    );
    expect(write.mock.calls).toEqual([
      ['service_error', 'notifications', { provider: 'brevo', status: 400 }],
      ['service_error', 'notifications', { provider: 'brevo', status: 400 }],
    ]);
  });

  it.each([
    [
      'an unreachable provider',
      () => mock.answer({ hang: true, status: 0 }),
      'provider_unreachable',
    ],
    [
      'an answer without a message id',
      () => mock.answer({ body: {}, status: 201 }),
      'provider_bad_answer',
    ],
  ])('is written for %s with its reason', async (_, answer, reason) => {
    answer();
    await expect(brevo(200).send(mail)).rejects.toBeInstanceOf(BrevoError);
    expect(write).toHaveBeenCalledWith('service_error', 'email', {
      provider: 'brevo',
      reason,
    });
  });

  it('carries no recipient, number or text of the message', async () => {
    mock.answer({ status: 400 });
    await brevo()
      .sendSms(sms)
      .catch(() => undefined);
    mock.answer({ status: 400 });
    await brevo()
      .send(mail)
      .catch(() => undefined);
    expect(JSON.stringify(write.mock.calls)).not.toMatch(
      /40712345678|ana@|ITP|Salut|mesaj/,
    );
  });

  it('is not written by a sent message or the account check', async () => {
    mock.answer({ body: { messageId: '<abc@relay>' }, status: 201 });
    await brevo().send(mail);
    mock.answer({ status: 401 });
    await brevo().checkKey();
    expect(write).not.toHaveBeenCalled();
  });
});
