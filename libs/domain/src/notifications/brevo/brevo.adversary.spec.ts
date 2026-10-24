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

const brevo = (timeoutMs?: number, apiUrl = mock.url) =>
  new Brevo({ apiKey: 'test-key', apiUrl, timeoutMs });

const failure = (promise: Promise<unknown>) => promise.catch((e: unknown) => e);

describe('the Brevo adapter against odd answers', () => {
  it.each([400, 401, 403, 404, 422])(
    'does not retry a %i and names the status',
    async (status) => {
      mock.answer({ status });
      const error = (await failure(brevo().send(mail))) as BrevoError;
      expect(error).toBeInstanceOf(BrevoError);
      expect(error.retryable).toBe(false);
      expect(error.reason).toBe(`provider_${status}`);
    },
  );

  it.each([500, 502, 503, 504, 429])(
    'retries a %i and names the status',
    async (status) => {
      mock.answer({ status });
      const error = (await failure(brevo().send(mail))) as BrevoError;
      expect(error.retryable).toBe(true);
      expect(error.reason).toBe(`provider_${status}`);
    },
  );

  it('fails retryably when Brevo does not answer in time', async () => {
    mock.answer({ hang: true, status: 200 });
    const error = (await failure(brevo(150).send(mail))) as BrevoError;
    expect(error).toBeInstanceOf(BrevoError);
    expect(error.retryable).toBe(true);
  });

  it('fails retryably as unreachable when nothing listens', async () => {
    const error = (await failure(
      brevo(1000, 'http://127.0.0.1:1/v3').send(mail),
    )) as BrevoError;
    expect(error).toBeInstanceOf(BrevoError);
    expect(error.retryable).toBe(true);
    expect(error.reason).toBe('provider_unreachable');
  });

  it('fails when a 2xx answer carries no message id', async () => {
    mock.answer({ body: {}, status: 201 });
    expect(await failure(brevo().send(mail))).toBeInstanceOf(Error);
  });

  it('fails when a 2xx answer has an empty body', async () => {
    mock.answer({ status: 201 });
    expect(await failure(brevo().send(mail))).toBeInstanceOf(Error);
  });

  it('does not leak the key or the address in the error', async () => {
    mock.answer({ body: { message: 'bad ana@example.test' }, status: 400 });
    const error = (await failure(brevo().send(mail))) as BrevoError;
    expect(error.message).not.toContain('test-key');
    expect(error.message).not.toContain('ana@example.test');
    expect(error.reason).not.toContain('ana@example.test');
  });

  it('sends non-ASCII subjects, names and bodies intact', async () => {
    mock.answer({ body: { messageId: '<u@relay>' }, status: 201 });
    await brevo().send({
      ...mail,
      subject: 'Ofertă nouă — șăîâț',
      text: 'Bună, Ștefan\nLinia a doua',
      to: { email: 'stefan@example.test', name: 'Ștefan Țurcanu' },
    });
    expect(mock.emails()[0].body).toMatchObject({
      subject: 'Ofertă nouă — șăîâț',
      textContent: 'Bună, Ștefan\nLinia a doua',
      to: [{ email: 'stefan@example.test', name: 'Ștefan Țurcanu' }],
    });
  });

  it('sends a large body whole', async () => {
    mock.answer({ body: { messageId: '<big@relay>' }, status: 201 });
    await brevo().send({ ...mail, text: 'x'.repeat(2_000_000) });
    expect(
      (mock.emails()[0].body as { textContent: string }).textContent,
    ).toHaveLength(2_000_000);
  });

  it('keeps a single slash when the base address ends in one', async () => {
    mock.answer({ body: { messageId: '<s@relay>' }, status: 201 });
    await brevo(undefined, `${mock.url}/`).send(mail);
    expect(mock.calls[0].path).toBe('/v3/smtp/email');
  });

  it('makes one call per send and never retries by itself', async () => {
    mock.answer({ status: 503 }, { status: 503 });
    await failure(brevo().send(mail));
    expect(mock.emails()).toHaveLength(1);
  });

  it('returns distinct ids for two sends in a row', async () => {
    const a = await brevo().send(mail);
    const b = await brevo().send(mail);
    expect(a).not.toBe(b);
  });
});

describe('the key check', () => {
  it('accepts a good key and sends it as the api-key header', async () => {
    await expect(brevo().checkKey()).resolves.toBe(true);
    expect(mock.calls[0].headers['api-key']).toBe('test-key');
  });

  it.each([401, 403])('refuses a key answered with %i', async (status) => {
    mock.answer({ status });
    await expect(brevo().checkKey()).resolves.toBe(false);
  });

  it('answers false rather than throwing when nothing listens', async () => {
    await expect(brevo(500, 'http://127.0.0.1:1/v3').checkKey()).resolves.toBe(
      false,
    );
  });

  it('answers false rather than throwing when Brevo hangs', async () => {
    mock.answer({ hang: true, status: 200 });
    await expect(brevo(150).checkKey()).resolves.toBe(false);
  });

  it('never sends an e-mail', async () => {
    await brevo().checkKey();
    expect(mock.emails()).toHaveLength(0);
  });
});

// @traces 520-FR-001
describe('the start-up key status against odd answers', () => {
  it.each([200, 201, 204])('passes a %i', async (status) => {
    mock.answer({ status });
    await expect(brevo().keyStatus()).resolves.toEqual({ outcome: 'passed' });
  });

  it('passes a 200 whose body is not JSON', async () => {
    mock.answer({ body: undefined, status: 200 });
    await expect(brevo().keyStatus()).resolves.toEqual({ outcome: 'passed' });
  });

  it.each([400, 401, 403, 404, 410, 422])(
    'refuses a %i and names the status',
    async (status) => {
      mock.answer({ status });
      await expect(brevo().keyStatus()).resolves.toEqual({
        outcome: 'refused',
        status,
      });
    },
  );

  it.each([500, 502, 503, 504, 599, 429])(
    'finds Brevo unreachable on a %i',
    async (status) => {
      mock.answer({ status });
      await expect(brevo().keyStatus()).resolves.toEqual({
        outcome: 'unreachable',
        reason: `provider_${status}`,
      });
    },
  );

  it('finds Brevo unreachable when it never answers', async () => {
    mock.answer({ hang: true, status: 200 });
    await expect(brevo(150).keyStatus()).resolves.toEqual({
      outcome: 'unreachable',
      reason: 'provider_timeout',
    });
  });

  it('finds Brevo unreachable when nothing listens', async () => {
    await expect(
      brevo(1000, 'http://127.0.0.1:1/v3').keyStatus(),
    ).resolves.toEqual({
      outcome: 'unreachable',
      reason: 'provider_unreachable',
    });
  });

  it('finds Brevo unreachable when the host does not resolve', async () => {
    await expect(
      brevo(1000, 'http://no-such-host.invalid/v3').keyStatus(),
    ).resolves.toEqual({
      outcome: 'unreachable',
      reason: 'provider_unreachable',
    });
  });

  it('asks GET /account once and never puts the key in the outcome', async () => {
    mock.answer({ status: 503 });
    const status = await brevo().keyStatus();
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]).toMatchObject({ method: 'GET', path: '/v3/account' });
    expect(JSON.stringify(status)).not.toContain('test-key');
  });

  it('answers the same on a second ask after a failure', async () => {
    mock.answer({ status: 503 }, { status: 401 }, { status: 200 });
    const b = brevo();
    expect(await b.keyStatus()).toMatchObject({ outcome: 'unreachable' });
    expect(await b.keyStatus()).toEqual({ outcome: 'refused', status: 401 });
    expect(await b.keyStatus()).toEqual({ outcome: 'passed' });
  });

  it('gives up on an already aborted signal without passing', async () => {
    const stop = new AbortController();
    stop.abort();
    const status = await brevo().keyStatus(stop.signal);
    expect(status.outcome).not.toBe('passed');
    await expect(brevo().checkKey(stop.signal)).resolves.toBe(false);
  });

  it('gives up promptly when the signal aborts an ask in flight', async () => {
    mock.answer({ hang: true, status: 200 });
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 30);
    const started = Date.now();
    const status = await brevo(5000).keyStatus(stop.signal);
    expect(status.outcome).toBe('unreachable');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('answers checkKey true only for a passing key', async () => {
    mock.answer({ status: 200 }, { status: 401 }, { status: 503 });
    const b = brevo();
    expect(await b.checkKey()).toBe(true);
    expect(await b.checkKey()).toBe(false);
    expect(await b.checkKey()).toBe(false);
  });

  it('refuses a redirect it cannot follow instead of passing it', async () => {
    mock.answer({ status: 304 });
    await expect(brevo().keyStatus()).resolves.toEqual({
      outcome: 'refused',
      status: 304,
    });
  });
});
