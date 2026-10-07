import { EVENT_KINDS, type EventKind } from './events';

describe('the event kinds', () => {
  it.each([
    'account.password_reset',
    'request.created',
    'quote.sent',
    'quote.accepted',
    'quote.closed',
    'booking.moved',
    'job.started',
    'job.done',
    'job.step_done',
    'job.paused',
    'media.added',
    'live.started',
    'live.stopped',
    'verification.decided',
    'review.reported',
    'review.decided',
  ])('names %s, a kind the story asks for', (kind) => {
    expect(EVENT_KINDS).toContain(kind);
  });

  it.each([
    'account.created',
    'account.signed_out_everywhere',
    'account.suspended',
    'member.removed',
    'mechanic.updated',
    'garage.features_changed',
    'live.test',
  ])('names %s, which the live stream already acts on or sends', (kind) => {
    expect(EVENT_KINDS).toContain(kind);
  });

  it('names each kind once, as area.verb_past', () => {
    expect(new Set(EVENT_KINDS).size).toBe(EVENT_KINDS.length);
    for (const kind of EVENT_KINDS) expect(kind).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });

  it('keeps the stream’s own and straight-to-Redis kinds out', () => {
    for (const kind of [
      'hello',
      'bye',
      'session.revoked',
      'notification.created',
    ]) {
      expect(EVENT_KINDS).not.toContain(kind);
    }
  });

  it('refuses a kind outside the catalogue at compile time', () => {
    // @ts-expect-error: not an event kind
    const typo: EventKind = 'quote.snet';
    expect(EVENT_KINDS).not.toContain(typo);
  });
});
