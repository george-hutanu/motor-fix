import { logEntry } from './log';

afterEach(() => jest.restoreAllMocks());

describe('logEntry while telemetry is off', () => {
  it('still writes its one JSON line on stdout', () => {
    const out = jest.spyOn(console, 'log').mockImplementation(() => {});

    logEntry('warn', 'telemetry is off', { method: 'GET' });

    expect(out).toHaveBeenCalledTimes(1);
    expect(JSON.parse(out.mock.calls[0]?.[0])).toEqual({
      level: 'warn',
      message: 'telemetry is off',
      method: 'GET',
    });
  });

  it('still writes an error on stderr and nothing on stdout', () => {
    const out = jest.spyOn(console, 'log').mockImplementation(() => {});
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});

    logEntry('error', 'boom');

    expect(err.mock.calls).toEqual([
      [JSON.stringify({ level: 'error', message: 'boom' })],
    ]);
    expect(out).not.toHaveBeenCalled();
  });
});
