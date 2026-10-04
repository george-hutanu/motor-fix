import { Brevo, BrevoError } from './brevo';
import { BrevoMock } from './brevo-mock.testing';

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

  it.each([
    500, 503, 429,
  ])('treats a %s answer as worth retrying', async (status) => {
    mock.answer({ status });
    const error = await brevo()
      .send(mail)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BrevoError);
    expect(error).toMatchObject({
      reason: `provider_${status}`,
      retryable: true,
    });
  });

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
