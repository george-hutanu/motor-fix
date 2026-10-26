import { randomUUID } from 'node:crypto';

import type { ReviewStatus } from '../../generated/prisma/enums';
import { quotesApp } from '../../quotes/quotes-api.testing';
import { ReviewsModule } from '../reviews.module';
import { garageReviews, reviewReply } from '../reviews.testing';

const { bearer, get, send, team, world } = quotesApp([ReviewsModule]);
const { prisma } = world;
const { review } = garageReviews(world);
const reply = reviewReply(world);

async function setting(status: ReviewStatus = 'published') {
  const dinamo = await team('Atelier Dinamo');
  const andrei = await world.account('Andrei Ion Marin', ['driver']);
  const posted = await review(dinamo.garage.id, andrei, { rating: 4 });
  const one = await prisma.review.update({
    data: { mechanicId: dinamo.answeringMechanic.id, status },
    where: { id: posted.id },
  });
  return {
    andrei,
    dinamo,
    owner: bearer(dinamo.owner, 'garage'),
    review: one,
  };
}

const post = (auth: string, reviewId: string, body: object) =>
  send('post', `/reviews/${reviewId}/reply`, auth, body);
const edit = (auth: string, reviewId: string, body: object) =>
  send('patch', `/reviews/${reviewId}/reply`, auth, body);
const rows = (reviewId: string) =>
  prisma.reviewReply.findMany({ where: { reviewId } });

// @traces 075-FR-004 075-FR-005
describe('hostile reply bodies', () => {
  it.each([
    ['an array body', [{ text: 'Bun' }]],
    ['a text that is an array', { text: ['Bun'] }],
    ['a text that is an object', { text: { $gt: '' } }],
    ['a text that is a boolean', { text: true }],
  ])('refuses %s with 400 and stores nothing', async (_, body) => {
    const s = await setting();

    const refused = await post(s.owner, s.review.id, body as object);

    expect(refused.status).toBe(400);
    expect(await rows(s.review.id)).toEqual([]);
  });

  it('refuses a text made only of NUL characters with 422, not a server error', async () => {
    const s = await setting();

    const refused = await post(s.owner, s.review.id, { text: '\u0000\u0000' });

    expect(refused.status).toBe(422);
    expect(refused.body.errors).toEqual([{ code: 'length', field: 'text' }]);
  });

  it.each([
    ['a no-break space', '  '],
    ['a byte order mark', '﻿'],
    ['line separators', '  '],
  ])('treats %s alone as a blank text', async (_, text) => {
    const s = await setting();

    const refused = await post(s.owner, s.review.id, { text });

    expect(refused.status).toBe(422);
    expect(await rows(s.review.id)).toEqual([]);
  });

  it('counts 1,000 characters with NULs between them as 1,000, not more', async () => {
    const s = await setting();

    const sent = await post(s.owner, s.review.id, {
      text: 'a\u0000'.repeat(1000),
    });

    expect(sent.status).toBe(201);
    expect(sent.body.text).toBe('a'.repeat(1000));
  });

  it('refuses 1,001 astral characters although they are 2,002 UTF-16 units', async () => {
    const s = await setting();

    const refused = await post(s.owner, s.review.id, {
      text: '🚗'.repeat(1001),
    });

    expect(refused.status).toBe(422);
  });

  it('takes 1,000 astral characters', async () => {
    const s = await setting();

    const sent = await post(s.owner, s.review.id, { text: '🚗'.repeat(1000) });

    expect(sent.status).toBe(201);
    expect((await rows(s.review.id))[0].text).toBe('🚗'.repeat(1000));
  });

  it('answers a lone surrogate with a client answer, not a 500', async () => {
    const s = await setting();

    const sent = await post(s.owner, s.review.id, { text: 'Bun\ud800' });

    expect(sent.status).toBeLessThan(500);
  });

  it('keeps markup and links exactly as written', async () => {
    const s = await setting();
    const text = '<script>alert(1)</script> https://x.ro "&amp;" $' + '{1+1}';

    const sent = await post(s.owner, s.review.id, { text });

    expect(sent.status).toBe(201);
    expect(sent.body.text).toBe(text);
  });

  it('answers a two-megabyte text with 413 or 422, never 201 or 500', async () => {
    const s = await setting();

    const refused = await post(s.owner, s.review.id, {
      text: 'a'.repeat(2_000_000),
    });

    expect([413, 422]).toContain(refused.status);
    expect(await rows(s.review.id)).toEqual([]);
  });

  it('refuses a body that names the status or the garage as another member', async () => {
    const s = await setting();
    const other = await team('Service Nord');

    const refused = await post(s.owner, s.review.id, {
      garageId: other.garage.id,
      status: 'removed',
      text: 'Bun',
    });

    expect(refused.status).toBe(400);
    expect(await rows(s.review.id)).toEqual([]);
  });
});

// @traces 075-FR-005
describe('who may reach a reply', () => {
  it('gives a mechanic of another garage the 404 of a stranger, not the 403', async () => {
    const s = await setting();
    const nord = await team('Service Nord');
    const stranger = await post(
      bearer(nord.answering, 'mechanic'),
      s.review.id,
      {
        text: 'Bun',
      },
    );
    const stranger2 = await post(
      bearer(nord.receptionist, 'receptionist'),
      s.review.id,
      {
        text: 'Bun',
      },
    );
    const unknown = await post(s.owner, randomUUID(), { text: 'Bun' });

    expect(stranger.status).toBe(404);
    expect(stranger2.status).toBe(404);
    expect(stranger.body).toEqual(unknown.body);
    expect(stranger2.body).toEqual(unknown.body);
  });

  it('refuses a plain mechanic of the garage with 403', async () => {
    const s = await setting();

    const refused = await post(
      bearer(s.dinamo.plain, 'mechanic'),
      s.review.id,
      {
        text: 'Bun',
      },
    );

    expect(refused.status).toBe(403);
  });

  it('answers an upper-case review id like the lower-case one', async () => {
    const s = await setting();

    const sent = await post(s.owner, s.review.id.toUpperCase(), {
      text: 'Bun',
    });

    expect(sent.status).toBe(201);
  });

  it.each([
    '00000000-0000-0000-0000-000000000000',
    '%00',
    "1'; DROP TABLE review_reply;--",
    `${randomUUID()}%20`,
  ])('answers 404 for the review id %s', async (id) => {
    const s = await setting();

    const refused = await post(s.owner, encodeURIComponent(id), {
      text: 'Bun',
    });

    expect(refused.status).toBe(404);
  });

  it('refuses a review its author deleted with review_not_public', async () => {
    const s = await setting('deleted_by_author');

    const refused = await post(s.owner, s.review.id, { text: 'Bun' });

    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('review_not_public');
  });
});

// @traces 075-FR-005 075-FR-007
describe('replies in a race and twice', () => {
  it('stores one reply and one event when twenty POSTs arrive together', async () => {
    const s = await setting();

    const answers = await Promise.all(
      Array.from({ length: 20 }, () =>
        post(s.owner, s.review.id, { text: 'Bun' }),
      ),
    );

    expect(answers.filter((a) => a.status === 201)).toHaveLength(1);
    expect(answers.filter((a) => a.status === 409)).toHaveLength(19);
    expect(
      new Set(answers.filter((a) => a.status === 409).map((a) => a.body.code)),
    ).toEqual(new Set(['already_replied']));
    expect(await rows(s.review.id)).toHaveLength(1);
    expect(
      await prisma.outboxEvent.count({
        where: { kind: 'review.replied', subjectId: s.review.id },
      }),
    ).toBe(1);
  });

  it('keeps one consistent text, audit and event per edit when edits arrive together', async () => {
    const s = await setting();
    await reply(s.review.id, { postedAt: new Date(Date.now() - 60_000) });

    const answers = await Promise.all(
      ['Unu', 'Doi', 'Trei', 'Patru'].map((text) =>
        edit(s.owner, s.review.id, { text }),
      ),
    );

    expect(answers.map((a) => a.status)).toEqual([200, 200, 200, 200]);
    const [row] = await rows(s.review.id);
    expect(['Unu', 'Doi', 'Trei', 'Patru']).toContain(row.text);
    const updates = await prisma.activityLog.findMany({
      where: { action: 'update', subjectId: row.id },
    });
    expect(updates).toHaveLength(4);
    expect(
      await prisma.outboxEvent.count({
        where: { kind: 'review.reply_edited', subjectId: s.review.id },
      }),
    ).toBe(4);
  });

  it('keeps postedAt and the id through an edit and moves editedAt forward on the second', async () => {
    const s = await setting();
    const sent = await post(s.owner, s.review.id, { text: 'Bun' });

    const first = await edit(s.owner, s.review.id, { text: 'Mai bun' });
    const second = await edit(s.owner, s.review.id, { text: 'Cel mai bun' });

    expect(first.body.id).toBe(sent.body.id);
    expect(second.body.postedAt).toBe(sent.body.postedAt);
    expect(Date.parse(second.body.editedAt)).toBeGreaterThanOrEqual(
      Date.parse(first.body.editedAt),
    );
    expect(second.body.text).toBe('Cel mai bun');
  });

  it('writes no audit entry and no event for a refused edit', async () => {
    const s = await setting();
    await post(s.owner, s.review.id, { text: 'Bun' });
    const before = await prisma.outboxEvent.count();

    const refused = await edit(s.owner, s.review.id, {
      text: 'a'.repeat(1001),
    });

    expect(refused.status).toBe(422);
    expect(await prisma.outboxEvent.count()).toBe(before);
    expect((await rows(s.review.id))[0].editedAt).toBeNull();
  });

  it('lets a POST after a reported reply answer already_replied, not reply_not_public', async () => {
    const s = await setting();
    await reply(s.review.id, { status: 'reported' });

    const refused = await post(s.owner, s.review.id, { text: 'Bun' });

    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('already_replied');
  });
});

// @traces 075-FR-009
describe('what the reads carry about a reply', () => {
  it('carries no reply object on a garage page for a review whose reply is removed and no key of the staff shape on the public one', async () => {
    const s = await setting();
    await prisma.mechanic.update({
      data: { onProfile: true },
      where: { id: s.dinamo.answeringMechanic.id },
    });
    await post(s.owner, s.review.id, { text: 'Bun' });

    const read = await get(`/reviews/garage/${s.dinamo.garage.id}`);

    expect(Object.keys(read.body.items[0].reply).sort()).toEqual([
      'editedAt',
      'postedAt',
      'text',
    ]);
  });

  it('shows the staff read a reply with the staff keys only, and canReply false to the receptionist', async () => {
    const s = await setting();
    await post(s.owner, s.review.id, { text: 'Bun' });

    const read = await get(
      `/garages/${s.dinamo.garage.id}/reviews`,
      bearer(s.dinamo.receptionist, 'receptionist'),
    );

    expect(read.status).toBe(200);
    expect(Object.keys(read.body.items[0].reply).sort()).toEqual([
      'editedAt',
      'id',
      'postedAt',
      'status',
      'text',
    ]);
    expect(read.body.items[0].canReply).toBe(false);
  });

  it('reads an edited text and its editedAt on the public page at once', async () => {
    const s = await setting();
    await post(s.owner, s.review.id, { text: 'Bun' });
    const edited = await edit(s.owner, s.review.id, { text: 'Mai bun' });

    const read = await get(`/reviews/garage/${s.dinamo.garage.id}`);

    expect(read.body.items[0].reply).toEqual({
      editedAt: edited.body.editedAt,
      postedAt: edited.body.postedAt,
      text: 'Mai bun',
    });
  });
});
