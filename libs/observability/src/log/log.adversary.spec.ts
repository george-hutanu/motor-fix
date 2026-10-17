import { SeverityNumber } from '@opentelemetry/api-logs';

import { logEntry } from './log';
import { startTelemetry } from '../setup/start';
import { inMemory } from '../testing/in-memory';

const memory = inMemory();
const started = startTelemetry(
  'worker',
  { APP_ENV: 'staging', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' },
  memory,
);

let out: jest.SpyInstance;
let err: jest.SpyInstance;

beforeEach(async () => {
  out = jest.spyOn(console, 'log').mockImplementation(() => {});
  err = jest.spyOn(console, 'error').mockImplementation(() => {});
  await started?.flush();
  memory.logExporter.reset();
});

afterEach(() => jest.restoreAllMocks());
afterAll(() => started?.shutdown());

async function records() {
  await started?.flush();
  return memory.logExporter.getFinishedLogRecords();
}

const written = (spy: jest.SpyInstance) =>
  spy.mock.calls.map(([line]) => String(line));

describe('logEntry under hostile input', () => {
  // @traces 1345-FR-002
  it('keeps the level and message of the entry when an attribute carries those names', () => {
    logEntry('warn', 'real message', {
      level: 'error',
      message: 'forged',
    });

    const [line] = written(out);
    expect(JSON.parse(line ?? '')).toMatchObject({
      level: 'warn',
      message: 'real message',
    });
  });

  it('writes a message with line breaks as exactly one line', () => {
    logEntry('error', 'first\nsecond\r\nthird fourth');

    const lines = written(err);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/[\r\n]/);
    expect(JSON.parse(lines[0] ?? '').message).toBe(
      'first\nsecond\r\nthird fourth',
    );
  });

  it('writes an empty message and no attributes as a valid entry', async () => {
    logEntry('warn', '');

    expect(JSON.parse(written(out)[0] ?? '')).toEqual({
      level: 'warn',
      message: '',
    });
    const [record, ...rest] = await records();
    expect(rest).toEqual([]);
    expect(record?.body).toBe('');
    expect(record?.severityNumber).toBe(SeverityNumber.WARN);
  });

  it('keeps unicode in the message and in a path attribute', () => {
    logEntry('warn', 'garaj închis: Știrbei Vodă 🚗', {
      path: '/api/v1/garages/Ștefan-cel-Mare',
    });

    expect(JSON.parse(written(out)[0] ?? '')).toEqual({
      level: 'warn',
      message: 'garaj închis: Știrbei Vodă 🚗',
      path: '/api/v1/garages/Ștefan-cel-Mare',
    });
  });

  it('writes a 1 MB message as one parseable line and one record', async () => {
    const big = 'x'.repeat(1_000_000);

    logEntry('warn', big);

    const lines = written(out);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '').message).toHaveLength(1_000_000);
    expect(await records()).toHaveLength(1);
  });

  it('survives a null attribute value that slipped past the types', async () => {
    const attributes = { method: 'GET', note: null } as unknown as Record<
      string,
      string
    >;

    expect(() => logEntry('warn', 'with null', attributes)).not.toThrow();

    const [line] = written(out);
    expect(JSON.parse(line ?? '')).toMatchObject({
      level: 'warn',
      message: 'with null',
      method: 'GET',
    });
    const [record] = await records();
    expect(record?.attributes).toMatchObject({ method: 'GET' });
  });

  it('masks an e-mail address in the message and the path on the OTel record as on the line', async () => {
    logEntry('error', 'failed for ana@example.com', {
      method: 'GET',
      path: '/api/v1/users/ana@example.com',
    });

    expect(written(err)[0]).not.toContain('ana@example.com');
    const [record] = await records();
    expect(record?.body).not.toContain('ana@example.com');
    expect(JSON.stringify(record?.attributes)).not.toContain('ana@example.com');
  });

  it('keeps boolean and zero attributes and drops only undefined ones', () => {
    logEntry('warn', 'values', {
      ok: false,
      retries: 0,
      skipped: undefined,
    });

    expect(JSON.parse(written(out)[0] ?? '')).toEqual({
      level: 'warn',
      message: 'values',
      ok: false,
      retries: 0,
    });
  });

  it('writes the same entry twice as two lines and two records', async () => {
    logEntry('warn', 'again', { method: 'GET' });
    logEntry('warn', 'again', { method: 'GET' });

    expect(written(out)).toHaveLength(2);
    expect(written(out)[0]).toBe(written(out)[1]);
    expect(await records()).toHaveLength(2);
  });

  it('does not write a warning to stderr or an error to stdout', () => {
    logEntry('warn', 'w');
    logEntry('error', 'e');

    expect(written(out).map((l) => JSON.parse(l).level)).toEqual(['warn']);
    expect(written(err).map((l) => JSON.parse(l).level)).toEqual(['error']);
  });
});
