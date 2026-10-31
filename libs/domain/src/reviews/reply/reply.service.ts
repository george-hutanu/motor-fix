import type {
  ReplyRefusal,
  ReplyToReviewDto,
  ReviewReplyDto,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { replyRefusalOf, replyShapeOf, replyTextProblemOf } from './reply';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { refusal } from '../../auth/http-refusal';
import { type Actor, forbidden } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { taken } from '../../auth/sign-up.service';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import type { PrismaClient } from '../../generated/prisma/client';
import type {
  ReviewReplyStatus,
  ReviewStatus,
} from '../../generated/prisma/enums';
import { recordReviewReplied } from '../reviews.metrics';

const MESSAGES: Record<
  ReplyRefusal | 'forbidden' | 'not_found' | 'validation_failed',
  { en: string; ro: string }
> = {
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

const STAFF: readonly Actor['role'][] = ['garage', 'receptionist', 'mechanic'];

type Mode = 'post' | 'edit';

// The garage's owner replies in public to one of its reviews, once, and edits
// that reply; the moderation stories hide or remove it.
@Injectable()
export class ReviewRepliesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  async post(
    actor: Actor,
    reviewId: string,
    dto: ReplyToReviewDto,
  ): Promise<ReviewReplyDto> {
    const review = await this.refuse(actor, reviewId, dto, 'post');
    let reply: Awaited<ReturnType<PrismaClient['reviewReply']['create']>>;
    try {
      reply = await this.prisma.$transaction(async (tx) => {
        // The review held still until the reply lands, so a removal cannot
        // slip in between the check and the write.
        const [held] = await tx.$queryRaw<{ status: ReviewStatus }[]>`
          SELECT status FROM review WHERE id = ${review.id}::uuid FOR UPDATE`;
        if (held?.status !== 'published') throw new Moved();
        const row = await tx.reviewReply.create({
          data: {
            garageId: review.garageId,
            postedById: actor.accountId,
            reviewId: review.id,
            text: dto.text,
          },
        });
        await this.audit.record(tx, {
          ...this.scope(actor, review),
          action: 'create',
          newValue: {
            reviewId: row.reviewId,
            status: row.status,
            text: row.text,
          },
          subjectId: row.id,
          subjectType: 'review_reply',
        });
        // publishes review.replied
        await this.announce(tx, 'review.replied', review, row.id);
        return row;
      });
    } catch (error) {
      // The loser of two replies at once, or a reply to a review removed
      // since the read, is refused for what the review is now.
      if (!(error instanceof Moved) && !taken(error)) throw error;
      await this.refuse(actor, reviewId, dto, 'post');
      throw this.refusal(
        actor,
        error instanceof Moved ? 'review_not_public' : 'already_replied',
      );
    }
    recordReviewReplied('published');
    return replyShapeOf(reply);
  }

  async edit(
    actor: Actor,
    reviewId: string,
    dto: ReplyToReviewDto,
  ): Promise<ReviewReplyDto> {
    const review = await this.refuse(actor, reviewId, dto, 'edit');
    let reply: Awaited<ReturnType<PrismaClient['reviewReply']['update']>>;
    try {
      reply = await this.prisma.$transaction(async (tx) => {
        // The reply and its review held still until the edit lands, so a
        // report or a removal cannot slip in between the check and the write.
        const [held] = await tx.$queryRaw<
          {
            id: string;
            text: string;
            status: ReviewReplyStatus;
            review_status: ReviewStatus;
          }[]
        >`
          SELECT r.id, r.text, r.status, v.status AS review_status
          FROM review_reply r JOIN review v ON v.id = r.review_id
          WHERE r.review_id = ${review.id}::uuid
          FOR UPDATE OF r, v`;
        const now = held
          ? replyRefusalOf({ status: held.review_status }, held, 'edit')
          : 'not_found';
        if (now || !held) throw new Moved();
        const row = await tx.reviewReply.update({
          data: { editedAt: new Date(), text: dto.text },
          where: { id: held.id },
        });
        await this.audit.record(tx, {
          ...this.scope(actor, review),
          action: 'update',
          field: 'text',
          newValue: row.text,
          oldValue: held.text,
          subjectId: row.id,
          subjectType: 'review_reply',
        });
        // publishes review.reply_edited
        await this.announce(tx, 'review.reply_edited', review, row.id);
        return row;
      });
    } catch (error) {
      if (!(error instanceof Moved)) throw error;
      // The reply or its review changed since the read: refused for what
      // they are now.
      await this.refuse(actor, reviewId, dto, 'edit');
      throw this.refusal(actor, 'reply_not_public');
    }
    recordReviewReplied('edited');
    return replyShapeOf(reply);
  }

  private scope(
    actor: Actor,
    review: {
      garageId: string;
      jobId: string;
      source: string;
      job: { carId: string };
    },
  ) {
    return {
      actorId: actor.accountId,
      actorRole: actor.role,
      garageId: review.garageId,
      ...(review.source === 'job' && {
        carId: review.job.carId,
        jobId: review.jobId,
      }),
    };
  }

  private announce(
    tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
    kind: 'review.replied' | 'review.reply_edited',
    review: {
      id: string;
      driverId: string;
      garageId: string;
      mechanicId: string | null;
    },
    replyId: string,
  ) {
    return this.events.record(tx, {
      audience: {
        authorAccountId: review.driverId,
        garageId: review.garageId,
        mechanicId: review.mechanicId,
        type: 'review',
      },
      kind,
      payload: {
        authorId: review.driverId,
        garageId: review.garageId,
        replyId,
        reviewId: review.id,
      },
      subjectId: review.id,
    });
  }

  // Throws the first reason the caller may not post or edit the reply,
  // counted; else answers the review.
  private async refuse(
    actor: Actor,
    reviewId: string,
    dto: ReplyToReviewDto,
    mode: Mode,
  ) {
    const review =
      actor.garageId && STAFF.includes(actor.role)
        ? await this.prisma.review.findFirst({
            include: { job: { select: { carId: true } }, reply: true },
            where: { garageId: actor.garageId, id: reviewId },
          })
        : null;
    if (!review) throw notFound(actor);
    if (actor.role !== 'garage') {
      recordReviewReplied('forbidden');
      throw forbidden(MESSAGES.forbidden[languageOf(actor)]);
    }
    const refused = replyRefusalOf(review, review.reply, mode);
    if (refused === 'not_found') throw notFound(actor);
    if (refused) throw this.refusal(actor, refused);
    const problem = replyTextProblemOf(dto.text);
    if (problem) {
      recordReviewReplied('validation_failed');
      throw refusal(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'validation_failed',
        MESSAGES.validation_failed[languageOf(actor)],
        [problem],
      );
    }
    return review;
  }

  private refusal(actor: Actor, code: ReplyRefusal) {
    recordReviewReplied(code);
    return refusal(
      HttpStatus.CONFLICT,
      code,
      MESSAGES[code][languageOf(actor)],
    );
  }
}

class Moved extends Error {}

// One body for every review the caller cannot reach, so none is told apart.
export const notFound = (actor: Actor) =>
  refusal(
    HttpStatus.NOT_FOUND,
    'not_found',
    MESSAGES.not_found[languageOf(actor)],
  );

const languageOf = (actor: Actor) => (actor.language === 'en' ? 'en' : 'ro');
