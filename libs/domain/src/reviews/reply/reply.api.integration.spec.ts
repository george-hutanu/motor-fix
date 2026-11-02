import { randomUUID } from 'node:crypto';

import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';

import { audienceOf } from '../../events/audience';
import { outbox } from '../../events/event.port';
import type { ReviewStatus } from '../../generated/prisma/enums';
import { quotesApp } from '../../quotes/quotes-api.testing';
import { ReviewsModule } from '../reviews.module';
import { garageReviews, reviewReply } from '../reviews.testing';

const reader = countedMetrics();
const { bearer, client, get, send, team, world } = quotesApp([ReviewsModule]);
const { prisma } = world;
const { review } = garageReviews(world);
const reply = reviewReply(world);

const MESSAGES = {
  already_replied: {
    en: 'You already replied to this review.',
    ro: 'Ai răspuns deja la această recenzie.',
  },
  forbidden: {
    en: 'Only the owner can reply to a review.',
    ro: 'Doar proprietarul poate răspunde la o recenzie.',
  },
  not_found: {
    en: 'No such review.',
    ro: 'Recenzia nu există.',
  },
  reply_not_public: {
    en: 'The reply is reported and hidden until an admin decides.',
    ro: 'Răspunsul e raportat și ascuns până decide un admin.',
  },
  reply_removed: {
    en: 'An admin removed the reply; another cannot be posted.',
    ro: 'Răspunsul a fost eliminat de un admin; nu se poate posta altul.',
  },
  review_not_public: {
    en: 'The review is no longer public.',
    ro: 'Recenzia nu mai e publică.',
  },
  validation_failed: {
    en: 'The reply must be 1 to 1,000 characters long.',
    ro: 'Răspunsul trebuie să aibă între 1 și 1.000 de caractere.',
  },
};

// Atelier Dinamo's team and one review of a job Andrei had done there by its
// quoting mechanic.
async function setting(status: ReviewStatus = 'published') {
  const dinamo = await team('Atelier Dinamo');
  const andrei = await world.account('Andrei Ion Marin', ['driver']);
  const posted = await review(dinamo.garage.id, andrei, { rating: 2 });
  const one = await prisma.review.update({
    data: { mechanicId: dinamo.answeringMechanic.id, status },
    where: { id: posted.id },
  });
  const job = await prisma.job.findUniqueOrThrow({ where: { id: one.jobId } });
  return {
    andrei,
    dinamo,
    job,
    owner: bearer(dinamo.owner, 'garage'),
    receptionist: bearer(dinamo.receptionist, 'receptionist'),
    review: one,
  };
}

const TEXT = 'Mulțumim, Andrei! Ne pare rău pentru întârziere.';

const post = (auth: string, reviewId: string, body: object) =>
  send('post', `/reviews/${reviewId}/reply`, auth, body);
const edit = (auth: string, reviewId: string, body: object) =>
  send('patch', `/reviews/${reviewId}/reply`, auth, body);

const rows = (reviewId: string) =>
  prisma.reviewReply.findMany({ where: { reviewId } });

const audits = (subjectId: string) =>
  prisma.activityLog.findMany({ orderBy: { at: 'asc' }, where: { subjectId } });

const events = (kind: string, subjectId: string) =>
  prisma.outboxEvent.findMany({ where: { kind, subjectId } });

const counted = (outcome: string) =>
  counterTotal(reader, 'motorfix_reviews_replied_total', { outcome });

const english = (accountId: string) =>
  prisma.account.update({ data: { language: 'en' }, where: { id: accountId } });

const staffRead = (garageId: string, auth: string) =>
  get(`/garages/${garageId}/reviews`, auth);

// @traces 075-FR-004 075-FR-006 075-FR-007
// @traces 075-FR-013
describe('the owner replies to a review', () => {
  it('stores the trimmed reply and answers it in the staff shape', async () => {
    const s = await setting();

    const sent = await post(s.owner, s.review.id, { text: `  ${TEXT}\n ` });

    expect(sent.status).toBe(201);
    const [row] = await rows(s.review.id);
    expect(sent.body).toEqual({
      editedAt: null,
      id: row.id,
      postedAt: row.postedAt.toISOString(),
      status: 'published',
      text: TEXT,
    });
    expect(row).toMatchObject({
      editedAt: null,
      garageId: s.dinamo.garage.id,
      postedById: s.dinamo.owner,
      removedAt: null,
      removedCause: null,
      status: 'published',
      text: TEXT,
    });
  });

  it('keeps the inner line breaks and stores no NUL character', async () => {
    const s = await setting();

    await post(s.owner, s.review.id, { text: 'Mulțumim!\n\nRevenim.\u0000' });

    expect((await rows(s.review.id))[0].text).toBe('Mulțumim!\n\nRevenim.');
  });

  it('writes the reply to the audit history as the owner, with the job and the car', async () => {
    const s = await setting();

    const sent = await post(s.owner, s.review.id, { text: TEXT });

    const entries = await audits(sent.body.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'create',
      actorId: s.dinamo.owner,
      actorRole: 'owner',
      carId: s.job.carId,
      garageId: s.dinamo.garage.id,
      jobId: s.job.id,
      newValue: { reviewId: s.review.id, status: 'published', text: TEXT },
      subjectId: sent.body.id,
      subjectType: 'review_reply',
    });
  });

  it('names no job or car in the audit of a reply to a profile review', async () => {
    const s = await setting();
    await prisma.review.update({
      data: { source: 'profile' },
      where: { id: s.review.id },
    });

    const sent = await post(s.owner, s.review.id, { text: TEXT });

    expect(sent.status).toBe(201);
    expect((await audits(sent.body.id))[0]).toMatchObject({
      carId: null,
      jobId: null,
    });
  });

  it('writes one review.replied event to the review’s audience, the garage’s staff stream among it', async () => {
    const s = await setting();

    const sent = await post(s.owner, s.review.id, { text: TEXT });

    const written = await events('review.replied', s.review.id);
    expect(written).toHaveLength(1);
    expect(written[0].payload).toEqual({
      authorId: s.andrei,
      garageId: s.dinamo.garage.id,
      replyId: sent.body.id,
      reviewId: s.review.id,
    });
    const audience = audienceOf({
      authorAccountId: s.andrei,
      garageId: s.dinamo.garage.id,
      mechanicId: s.dinamo.answeringMechanic.id,
      type: 'review',
    });
    expect(written[0].audience).toEqual(audience);
    expect(audience).toContain(`garage:${s.dinamo.garage.id}`);
  });

  it('replies to a review with no mechanic', async () => {
    const s = await setting();
    await prisma.review.update({
      data: { mechanicId: null },
      where: { id: s.review.id },
    });

    const sent = await post(s.owner, s.review.id, { text: TEXT });

    expect(sent.status).toBe(201);
    const [event] = await events('review.replied', s.review.id);
    expect(event.audience).toEqual(
      audienceOf({
        authorAccountId: s.andrei,
        garageId: s.dinamo.garage.id,
        mechanicId: null,
        type: 'review',
      }),
    );
  });

  it('replies to the review of a deleted author', async () => {
    const s = await setting();
    await prisma.account.update({
      data: { email: null, name: '', status: 'deleted' },
      where: { id: s.andrei },
    });

    const sent = await post(s.owner, s.review.id, { text: TEXT });

    expect(sent.status).toBe(201);
    expect(await rows(s.review.id)).toHaveLength(1);
  });

  it('counts the reply as published', async () => {
    const s = await setting();
    const before = await counted('published');

    await post(s.owner, s.review.id, { text: TEXT });

    expect(await counted('published')).toBe(before + 1);
  });

  it('leaves no reply, audit entry or event when the event cannot be written', async () => {
    const s = await setting();
    const audited = () =>
      prisma.activityLog.count({ where: { subjectType: 'review_reply' } });
    const before = await audited();
    vi.spyOn(outbox, 'record').mockRejectedValueOnce(new Error('outbox down'));
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const refused = await post(s.owner, s.review.id, { text: TEXT });

    expect(refused.status).toBe(500);
    expect(await rows(s.review.id)).toEqual([]);
    expect(await audited()).toBe(before);
    expect(await events('review.replied', s.review.id)).toEqual([]);
  });

  it('refuses a second reply in the caller’s language, writing nothing', async () => {
    const s = await setting();
    await post(s.owner, s.review.id, { text: TEXT });
    const before = await counted('already_replied');

    const ro = await post(s.owner, s.review.id, { text: 'Încă unul.' });
    await english(s.dinamo.owner);
    const en = await post(s.owner, s.review.id, { text: 'One more.' });

    expect(ro.status).toBe(409);
    expect(ro.body).toEqual({
      code: 'already_replied',
      message: MESSAGES.already_replied.ro,
    });
    expect(en.body).toEqual({
      code: 'already_replied',
      message: MESSAGES.already_replied.en,
    });
    expect(await rows(s.review.id)).toHaveLength(1);
    expect(await events('review.replied', s.review.id)).toHaveLength(1);
    expect(await counted('already_replied')).toBe(before + 2);
  });

  it('keeps one reply when two are sent at once', async () => {
    const s = await setting();

    const answers = await Promise.all([
      post(s.owner, s.review.id, { text: 'Primul.' }),
      post(s.owner, s.review.id, { text: 'Al doilea.' }),
    ]);

    expect(answers.map((a) => a.status).sort()).toEqual([201, 409]);
    expect(answers.find((a) => a.status === 409)?.body.code).toBe(
      'already_replied',
    );
    expect(await rows(s.review.id)).toHaveLength(1);
    expect(await events('review.replied', s.review.id)).toHaveLength(1);
  });
});

// @traces 075-FR-005 075-FR-012 075-FR-013
describe('who may reply', () => {
  it.each([['receptionist'], ['mechanic']] as const)(
    'refuses the garage’s %s with the owner-only words',
    async (role) => {
      const s = await setting();
      const before = await counted('forbidden');
      const account =
        role === 'receptionist' ? s.dinamo.receptionist : s.dinamo.answering;

      const refused = await post(bearer(account, role), s.review.id, {
        text: TEXT,
      });

      expect(refused.status).toBe(403);
      expect(refused.body).toEqual({
        code: 'forbidden',
        message: MESSAGES.forbidden.ro,
      });
      expect(await rows(s.review.id)).toEqual([]);
      expect(await counted('forbidden')).toBe(before + 1);
    },
  );

  it('tells everyone outside the garage, and every review it may not reach, the same 404', async () => {
    const s = await setting();
    const nord = await team('Service Nord');
    const admin = await world.account('Ana Admin', ['admin']);
    const loose = await world.account('Fără Garaj', ['garage']);
    const body = { text: TEXT };

    const answers = await Promise.all([
      post(bearer(nord.owner, 'garage'), s.review.id, body),
      post(bearer(s.andrei, 'driver'), s.review.id, body),
      post(bearer(admin, 'admin'), s.review.id, body),
      post(bearer(loose, 'garage'), s.review.id, body),
      post(s.owner, 'not-a-uuid', body),
      post(s.owner, randomUUID(), body),
      edit(bearer(nord.owner, 'garage'), s.review.id, body),
      edit(s.owner, randomUUID(), body),
    ]);

    expect(answers.map((a) => a.status)).toEqual(Array(8).fill(404));
    expect(new Set(answers.map((a) => JSON.stringify(a.body))).size).toBe(1);
    expect(JSON.stringify(answers[0].body)).not.toContain(s.review.id);
    expect(await prisma.reviewReply.count()).toBe(0);
    expect(answers[0].body).toEqual({
      code: 'not_found',
      message: MESSAGES.not_found.ro,
    });
  });

  it('answers the 404 in the caller’s language', async () => {
    const s = await setting();
    await english(s.dinamo.owner);

    const [unknown, malformed] = await Promise.all([
      post(s.owner, randomUUID(), { text: TEXT }),
      edit(s.owner, 'not-a-uuid', { text: TEXT }),
    ]);

    expect(unknown.body).toEqual({
      code: 'not_found',
      message: MESSAGES.not_found.en,
    });
    expect(malformed.body).toEqual(unknown.body);
  });

  it('needs a session', async () => {
    const s = await setting();

    const answers = await Promise.all([
      // No bearer at all: an empty Authorization header.
      post('', s.review.id, { text: TEXT }),
      edit('', s.review.id, { text: TEXT }),
    ]);

    expect(answers.map((a) => a.status)).toEqual([401, 401]);
    expect(answers[0].body.code).toBe('sign_in_required');
    expect(await rows(s.review.id)).toEqual([]);
  });
});

// @traces 075-FR-005 075-FR-012 075-FR-013
describe('what a reply may hold', () => {
  it.each([
    ['an empty text', ''],
    ['a blank text', ' \n\t '],
    ['1,001 characters', 'a'.repeat(1001)],
  ])('refuses %s, naming the text', async (_, text) => {
    const s = await setting();
    const before = await counted('validation_failed');

    const refused = await post(s.owner, s.review.id, { text });

    expect(refused.status).toBe(422);
    expect(refused.body).toEqual({
      code: 'validation_failed',
      errors: [{ code: 'length', field: 'text' }],
      message: MESSAGES.validation_failed.ro,
    });
    expect(await rows(s.review.id)).toEqual([]);
    expect(await counted('validation_failed')).toBe(before + 1);
  });

  it('takes exactly 1,000 characters, an astral one counting once', async () => {
    const s = await setting();

    const sent = await post(s.owner, s.review.id, {
      text: `${'ă'.repeat(998)}🚗!`,
    });

    expect(sent.status).toBe(201);
  });

  it('names the length in English for an English owner', async () => {
    const s = await setting();
    await english(s.dinamo.owner);

    const refused = await post(s.owner, s.review.id, { text: ' ' });

    expect(refused.body.message).toBe(MESSAGES.validation_failed.en);
  });

  it.each([
    ['no text', {}],
    ['a text not a string', { text: 5 }],
    ['a null text', { text: null }],
    ['another member', { pinned: true, text: TEXT }],
  ])('refuses %s at the edge', async (_, body) => {
    const s = await setting();

    const answers = await Promise.all([
      post(s.owner, s.review.id, body),
      edit(s.owner, s.review.id, body),
    ]);

    expect(answers.map((a) => a.status)).toEqual([400, 400]);
    expect(await rows(s.review.id)).toEqual([]);
  });

  it('answers review_not_public before a length error', async () => {
    const s = await setting('reported');

    const refused = await post(s.owner, s.review.id, { text: '' });

    expect(refused.body.code).toBe('review_not_public');
  });
});

// @traces 075-FR-005 075-FR-009 075-FR-013
describe('a review or a reply that is not public', () => {
  it.each(['reported', 'removed', 'deleted_by_author'] as const)(
    'refuses a reply to a %s review',
    async (status) => {
      const s = await setting(status);
      const before = await counted('review_not_public');

      const refused = await post(s.owner, s.review.id, { text: TEXT });

      expect(refused.status).toBe(409);
      expect(refused.body).toEqual({
        code: 'review_not_public',
        message: MESSAGES.review_not_public.ro,
      });
      expect(await rows(s.review.id)).toEqual([]);
      expect(await counted('review_not_public')).toBe(before + 1);
    },
  );

  it('refuses a new reply where an admin removed one, in the caller’s language', async () => {
    const s = await setting();
    await reply(s.review.id, { status: 'removed' });

    const ro = await post(s.owner, s.review.id, { text: TEXT });
    await english(s.dinamo.owner);
    const en = await post(s.owner, s.review.id, { text: TEXT });

    expect(ro.status).toBe(409);
    expect(ro.body).toEqual({
      code: 'reply_removed',
      message: MESSAGES.reply_removed.ro,
    });
    expect(en.body.message).toBe(MESSAGES.reply_removed.en);
    expect(await rows(s.review.id)).toHaveLength(1);
  });

  it('keeps a reported reply from the public reads and shows it to the staff, refusing its edit', async () => {
    const s = await setting();
    const one = await reply(s.review.id, { status: 'reported' });

    const [profile, staff, refused] = await Promise.all([
      get(`/reviews/garage/${s.dinamo.garage.id}`),
      staffRead(s.dinamo.garage.id, s.owner),
      edit(s.owner, s.review.id, { text: 'Altfel.' }),
    ]);

    expect(profile.body.items[0].reply).toBeNull();
    expect(staff.body.items[0].reply).toEqual({
      editedAt: null,
      id: one.id,
      postedAt: one.postedAt.toISOString(),
      status: 'reported',
      text: one.text,
    });
    expect(staff.body.items[0].canReply).toBe(false);
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({
      code: 'reply_not_public',
      message: MESSAGES.reply_not_public.ro,
    });
    expect((await rows(s.review.id))[0].text).toBe(one.text);
  });

  it('shows a reply kept by an admin everywhere again and lets the owner edit it', async () => {
    const s = await setting();
    const one = await reply(s.review.id, { status: 'reported' });
    await prisma.reviewReply.update({
      data: { status: 'published' },
      where: { id: one.id },
    });

    const profile = await get(`/reviews/garage/${s.dinamo.garage.id}`);
    const edited = await edit(s.owner, s.review.id, { text: 'Altfel.' });

    expect(profile.body.items[0].reply.text).toBe(one.text);
    expect(edited.status).toBe(200);
  });

  it('carries a removed reply in no read and closes the review to a reply', async () => {
    const s = await setting();
    await prisma.mechanic.update({
      data: { onProfile: true },
      where: { id: s.dinamo.answeringMechanic.id },
    });
    const one = await reply(s.review.id, { status: 'removed' });

    const reads = await Promise.all([
      get(`/reviews/garage/${s.dinamo.garage.id}`),
      get(`/reviews/mechanic/${s.dinamo.answeringMechanic.id}`),
      staffRead(s.dinamo.garage.id, s.owner),
    ]);

    for (const read of reads) {
      expect(read.status).toBe(200);
      expect(read.body.items[0].reply).toBeNull();
      expect(JSON.stringify(read.body)).not.toContain(one.text);
    }
    expect(reads[2].body.items[0].canReply).toBe(false);
  });

  it('keeps a published reply under a reported review in the staff read, closed to a reply', async () => {
    const s = await setting();
    const one = await reply(s.review.id);
    await prisma.review.update({
      data: { status: 'reported' },
      where: { id: s.review.id },
    });

    const staff = await staffRead(s.dinamo.garage.id, s.owner);

    expect(staff.body.items[0].reply).toMatchObject({
      id: one.id,
      status: 'published',
    });
    expect(staff.body.items[0].canReply).toBe(false);
  });
});

// @traces 075-FR-009 075-FR-013
describe('the reply in the reads', () => {
  it('carries a published reply on the public reads with its text and dates only', async () => {
    const s = await setting();
    await prisma.mechanic.update({
      data: { onProfile: true },
      where: { id: s.dinamo.answeringMechanic.id },
    });
    const sent = await post(s.owner, s.review.id, { text: TEXT });
    const owner = await prisma.account.findUniqueOrThrow({
      where: { id: s.dinamo.owner },
    });

    const reads = await Promise.all([
      get(`/reviews/garage/${s.dinamo.garage.id}`),
      get(`/reviews/mechanic/${s.dinamo.answeringMechanic.id}`),
    ]);

    for (const read of reads) {
      expect(read.status).toBe(200);
      expect(read.body.items[0].reply).toEqual({
        editedAt: null,
        postedAt: sent.body.postedAt,
        text: TEXT,
      });
      const text = JSON.stringify(read.body);
      for (const absent of [s.dinamo.owner, owner.name, sent.body.id]) {
        expect(text).not.toContain(absent);
      }
    }
  });

  it('answers a null reply for a review with none, on every read', async () => {
    const s = await setting();
    await prisma.mechanic.update({
      data: { onProfile: true },
      where: { id: s.dinamo.answeringMechanic.id },
    });

    const reads = await Promise.all([
      get(`/reviews/garage/${s.dinamo.garage.id}`),
      get(`/reviews/mechanic/${s.dinamo.answeringMechanic.id}`),
      staffRead(s.dinamo.garage.id, s.owner),
    ]);

    for (const read of reads) expect(read.body.items[0].reply).toBeNull();
    expect(reads[2].body.items[0].canReply).toBe(true);
  });

  it('gives the owner the reply and closes the review to a second one; the receptionist reads it too', async () => {
    const s = await setting();
    const sent = await post(s.owner, s.review.id, { text: TEXT });

    const [owner, receptionist] = await Promise.all([
      staffRead(s.dinamo.garage.id, s.owner),
      staffRead(s.dinamo.garage.id, s.receptionist),
    ]);

    expect(owner.body.items[0].reply).toEqual(sent.body);
    expect(owner.body.items[0].canReply).toBe(false);
    expect(receptionist.body.items[0].reply).toEqual(sent.body);
    expect(receptionist.body.items[0].canReply).toBe(false);
  });
});

// @traces 075-FR-004 075-FR-005 075-FR-007
// @traces 075-FR-013
describe('the owner edits her reply', () => {
  async function replied() {
    const s = await setting();
    const sent = await post(s.owner, s.review.id, { text: TEXT });
    return { ...s, replyId: sent.body.id as string };
  }

  it('changes the text and marks it edited', async () => {
    const s = await replied();

    const edited = await edit(s.owner, s.review.id, { text: ' Altfel spus. ' });

    expect(edited.status).toBe(200);
    const [row] = await rows(s.review.id);
    expect(row.editedAt).not.toBeNull();
    expect(edited.body).toEqual({
      editedAt: row.editedAt?.toISOString(),
      id: s.replyId,
      postedAt: row.postedAt.toISOString(),
      status: 'published',
      text: 'Altfel spus.',
    });
  });

  it('writes the old and the new text to the audit history and one review.reply_edited event', async () => {
    const s = await replied();

    await edit(s.owner, s.review.id, { text: 'Altfel spus.' });

    const entries = await audits(s.replyId);
    expect(entries.map((e) => e.action)).toEqual(['create', 'update']);
    expect(entries[1]).toMatchObject({
      actorId: s.dinamo.owner,
      actorRole: 'owner',
      field: 'text',
      garageId: s.dinamo.garage.id,
      newValue: 'Altfel spus.',
      oldValue: TEXT,
      subjectType: 'review_reply',
    });
    const written = await events('review.reply_edited', s.review.id);
    expect(written).toHaveLength(1);
    expect(written[0].payload).toEqual({
      authorId: s.andrei,
      garageId: s.dinamo.garage.id,
      replyId: s.replyId,
      reviewId: s.review.id,
    });
  });

  it('audits an edit that keeps the text', async () => {
    const s = await replied();

    const edited = await edit(s.owner, s.review.id, { text: TEXT });

    expect(edited.status).toBe(200);
    expect(await audits(s.replyId)).toHaveLength(2);
  });

  it('counts the edit', async () => {
    const s = await replied();
    const before = await counted('edited');

    await edit(s.owner, s.review.id, { text: 'Altfel spus.' });

    expect(await counted('edited')).toBe(before + 1);
  });

  it('answers 404 for a review with no reply', async () => {
    const s = await setting();

    const refused = await edit(s.owner, s.review.id, { text: TEXT });

    expect(refused.status).toBe(404);
    expect(refused.body.code).toBe('not_found');
  });

  it('refuses the receptionist and the mechanic', async () => {
    const s = await replied();

    const answers = await Promise.all([
      edit(s.receptionist, s.review.id, { text: 'X' }),
      edit(bearer(s.dinamo.answering, 'mechanic'), s.review.id, { text: 'X' }),
    ]);

    expect(answers.map((a) => a.status)).toEqual([403, 403]);
    expect((await rows(s.review.id))[0].text).toBe(TEXT);
  });

  it('refuses an edit once the review is no longer public, before a length error', async () => {
    const s = await replied();
    await prisma.review.update({
      data: { status: 'removed' },
      where: { id: s.review.id },
    });

    const refused = await edit(s.owner, s.review.id, { text: '' });

    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('review_not_public');
  });

  it('refuses a removed reply', async () => {
    const s = await replied();
    await prisma.reviewReply.update({
      data: { removedAt: new Date(), status: 'removed' },
      where: { id: s.replyId },
    });

    const refused = await edit(s.owner, s.review.id, { text: 'Altfel.' });

    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('reply_removed');
  });

  it('refuses an empty edit, keeping the text', async () => {
    const s = await replied();

    const refused = await edit(s.owner, s.review.id, { text: '   ' });

    expect(refused.status).toBe(422);
    expect(refused.body.errors).toEqual([{ code: 'length', field: 'text' }]);
    expect((await rows(s.review.id))[0].text).toBe(TEXT);
  });

  it('leaves the text, audit and events as they were when the event cannot be written', async () => {
    const s = await replied();
    vi.spyOn(outbox, 'record').mockRejectedValueOnce(new Error('outbox down'));
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const refused = await edit(s.owner, s.review.id, { text: 'Altfel.' });

    expect(refused.status).toBe(500);
    expect((await rows(s.review.id))[0]).toMatchObject({
      editedAt: null,
      text: TEXT,
    });
    expect(await audits(s.replyId)).toHaveLength(1);
    expect(await events('review.reply_edited', s.review.id)).toEqual([]);
  });

  it('lands no edit on a reply reported between the read and the write', async () => {
    const s = await replied();
    // The report lands as the edit's transaction opens: the edit must read
    // the reply inside its transaction and refuse it.
    const app = client();
    const open = app.$transaction.bind(app);
    vi.spyOn(app, '$transaction').mockImplementationOnce(
      async (...args: unknown[]) => {
        await prisma.reviewReply.update({
          data: { status: 'reported' },
          where: { id: s.replyId },
        });
        return (open as (...a: unknown[]) => Promise<unknown>)(...args);
      },
    );

    const refused = await edit(s.owner, s.review.id, { text: 'Altfel.' });

    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('reply_not_public');
    expect((await rows(s.review.id))[0].text).toBe(TEXT);
  });

  it('still refuses a second POST', async () => {
    const s = await replied();
    await edit(s.owner, s.review.id, { text: 'Altfel.' });

    const refused = await post(s.owner, s.review.id, { text: TEXT });

    expect(refused.body.code).toBe('already_replied');
  });
});
