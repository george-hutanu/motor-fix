import { createHash } from 'node:crypto';

import { z } from 'zod';

import { argsHash, confirmationRequired, notSent } from './confirmation';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

// @traces 1253-FR-004
describe('argsHash', () => {
  it('is the hex SHA-256 of the key-sorted JSON', () => {
    expect(argsHash({ reason: 'fully_booked', requestId: 'r' })).toBe(
      sha('{"reason":"fully_booked","requestId":"r"}'),
    );
  });

  it('sorts keys at every depth, so key order never changes it', () => {
    // Parsed from text, so the key order is the one written.
    const unsorted = JSON.parse('{"b":{"y":1,"x":[{"q":1,"p":2}]},"a":1}');
    expect(argsHash(unsorted)).toBe(
      argsHash({ a: 1, b: { x: [{ p: 2, q: 1 }], y: 1 } }),
    );
  });

  it('is the same once the schema drops an unknown key', () => {
    const schema = z.object({ reason: z.string(), requestId: z.string() });
    const parsed = schema.parse({ extra: 1, reason: 'a', requestId: 'r' });
    expect(argsHash(parsed)).toBe(argsHash({ reason: 'a', requestId: 'r' }));
  });

  it('changes with another reason', () => {
    expect(argsHash({ reason: 'fully_booked', requestId: 'r' })).not.toBe(
      argsHash({ reason: 'job_not_done', requestId: 'r' }),
    );
  });
});

// @traces 1253-FR-001
describe('confirmationRequired', () => {
  it('answers the id, the expiry as ISO, the summary and the tool', () => {
    expect(
      confirmationRequired(
        { expiresAt: new Date('2026-10-26T12:05:00Z'), id: 'c-1' },
        'decline_quote_request',
        'Atelier declines.',
      ),
    ).toEqual({
      confirmationId: 'c-1',
      expiresAt: '2026-10-26T12:05:00.000Z',
      status: 'confirmation_required',
      summary: 'Atelier declines.',
      tool: 'decline_quote_request',
    });
  });
});

// @traces 1253-FR-005
describe('notSent', () => {
  it.each(['refused', 'expired', 'arguments_changed', 'void'] as const)(
    'says nothing was sent for %s, in both languages',
    (reason) => {
      const ro = notSent(reason, 'ro');
      const en = notSent(reason, 'en');
      expect(ro).toMatchObject({ reason, status: 'not_sent' });
      expect(en).toMatchObject({ reason, status: 'not_sent' });
      expect(ro.message).not.toBe(en.message);
      expect(en.message).toMatch(/nothing was sent/i);
      expect(ro.message).toMatch(/nu s-a trimis nimic/i);
    },
  );
});
