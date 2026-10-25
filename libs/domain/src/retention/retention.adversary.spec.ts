import { RETENTION_SWEEPS, runRetention } from './retention';
import { RETENTION_KINDS, retentionCutoff } from './retention.config';

const now = new Date('2026-10-24T10:00:00.000Z');

const makeDeps = () => {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    deps: {
      logger: {
        error: (line: string) => errors.push(line),
        log: (line: string) => lines.push(line),
      },
      prisma: {} as never,
      storage: { deleteObject: async () => undefined },
    },
    errors,
    lines,
  };
};

// @traces 1156-FR-003
describe('runRetention under hostile sweeps', () => {
  it('runs an empty sweep list as a success with no counts', async () => {
    const { deps, lines } = makeDeps();
    const result = await runRetention(deps, now, []);
    expect(result.counts).toEqual({});
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^retention run took \d+ ms$/);
  });

  it('logs a zero count as a normal line, not an error', async () => {
    const { deps, lines, errors } = makeDeps();
    const result = await runRetention(deps, now, [
      ['notification', async () => 0],
    ]);
    expect(result.counts).toEqual({ notification: 0 });
    expect(lines[0]).toBe('retention notification removed 0');
    expect(errors).toEqual([]);
  });

  it('says anonymised, not removed, for the audit kind', async () => {
    const { deps, lines } = makeDeps();
    await runRetention(deps, now, [['audit_entry', async () => 3]]);
    expect(lines[0]).toBe('retention audit_entry anonymised 3');
  });

  it('runs the sweeps one at a time in the given order', async () => {
    const { deps } = makeDeps();
    const order: string[] = [];
    const slow = (kind: string, ms: number) => async () => {
      order.push(`start ${kind}`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`end ${kind}`);
      return 1;
    };
    await runRetention(deps, now, [
      ['sign_in_code', slow('a', 20)],
      ['phone_change', slow('b', 1)],
    ]);
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b']);
  });

  it('keeps sweeping after a failure and fails once at the end naming every failed kind', async () => {
    const { deps, lines, errors } = makeDeps();
    const boom = new Error('boom');
    const after = jest.fn(async () => 4);
    const promise = runRetention(deps, now, [
      ['sign_in_code', async () => Promise.reject(boom)],
      ['phone_change', after],
      ['account_token', async () => Promise.reject('plain string')],
    ]);
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).message).toBe(
      'retention: sign_in_code, account_token failed',
    );
    expect((error as AggregateError).errors).toEqual([boom, 'plain string']);
    expect(after).toHaveBeenCalledTimes(1);
    expect(lines).toContain('retention phone_change removed 4');
    expect(lines.at(-1)).toMatch(/^retention run took \d+ ms$/);
    expect(errors).toEqual([
      'retention sign_in_code failed: Error',
      'retention account_token failed: string',
    ]);
  });

  it('survives a sweep that rejects with null or undefined', async () => {
    const { deps } = makeDeps();
    const error = await runRetention(deps, now, [
      ['sign_in_code', () => Promise.reject(null)],
      ['phone_change', () => Promise.reject(undefined)],
    ]).catch((e: unknown) => e);
    expect((error as AggregateError).message).toBe(
      'retention: sign_in_code, phone_change failed',
    );
  });

  it('catches a sweep that throws before returning a promise', async () => {
    const { deps } = makeDeps();
    const error = await runRetention(deps, now, [
      [
        'sign_in_code',
        (() => {
          throw new Error('sync');
        }) as never,
      ],
    ]).catch((e: unknown) => e);
    expect((error as AggregateError).message).toBe(
      'retention: sign_in_code failed',
    );
  });

  it('keeps row content out of the log lines', async () => {
    const { deps, lines, errors } = makeDeps();
    await runRetention(deps, now, [
      ['notification', async () => 2],
      [
        'legal_document',
        async () => Promise.reject(new Error('page legal/abc/secret.pdf')),
      ],
    ]).catch(() => undefined);
    expect(lines.slice(0, 1)).toEqual(['retention notification removed 2']);
    expect(errors).toEqual(['retention legal_document failed: Error']);
    expect(errors.join('\n')).not.toContain('legal/abc');
  });

  it('names exactly the configured kinds, in order, in the default sweeps', () => {
    expect(RETENTION_SWEEPS.map(([kind]) => kind)).toEqual([
      ...RETENTION_KINDS,
    ]);
  });
});

describe('retentionCutoff at the edges', () => {
  it('returns now itself for a zero-day period', () => {
    expect(retentionCutoff(now, 0)).toEqual(now);
  });

  it('counts whole days in milliseconds, with no calendar or zone shift across a DST change', () => {
    const spring = new Date('2026-03-30T00:30:00.000Z');
    expect(retentionCutoff(spring, 2).toISOString()).toBe(
      '2026-03-28T00:30:00.000Z',
    );
  });

  it('puts the 1826-day cutoff on the same calendar day five years back across one leap day', () => {
    const cutoff = retentionCutoff(new Date('2026-10-24T10:00:00.000Z'), 1826);
    expect(cutoff.toISOString()).toBe('2021-10-24T10:00:00.000Z');
  });

  it('does not mutate the date it is given', () => {
    const copy = new Date(now.getTime());
    retentionCutoff(now, 30);
    expect(now).toEqual(copy);
  });
});
