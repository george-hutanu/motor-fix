import {
  askedSteps,
  type CompletionCopyDto,
  type ListingDraftData,
} from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import { copyOf, heldOf } from './completion.copy';
import { newToken } from '../../../auth/email-confirmation/email-confirmation';
import type { Actor } from '../../../auth/policy';
import { PRISMA } from '../../../auth/prisma';
import { refusal, taken } from '../../../auth/sign-up.service';
import type {
  PrismaClient,
  VerificationFile,
} from '../../../generated/prisma/client';
import { countCompletionOpened } from '../../../metrics/product-counters';
import { newestFirst } from '../../verification/verification.service';

const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No file to complete');
const forbidden = () =>
  refusal(HttpStatus.FORBIDDEN, 'forbidden', 'Only the owner completes it');

// The listing form reopened over a live garage, to answer the admins'
// request for more: one open copy per file, bound to it.
@Injectable()
export class CompletionService {
  private readonly logger = new Logger('Completion');

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async open(actor: Actor): Promise<CompletionCopyDto> {
    const file = await this.askingFile(actor);
    const copy =
      (await this.openCopy(file.id)) ?? (await this.create(actor, file));
    const key = newToken();
    await this.prisma.listingDraftToken.create({
      data: {
        draftId: copy.id,
        hash: key.hash,
        kind: 'browser',
        sentAt: new Date(),
      },
    });
    return {
      data: copy.data as ListingDraftData,
      edited: copy.updatedAt > copy.createdAt,
      email: copy.email,
      held: await heldOf(this.prisma, file.id),
      id: copy.id,
      language: copy.language,
      requestedItems: file.requestedItems,
      status: copy.status,
      step: copy.step,
      token: key.token,
      updatedAt: copy.updatedAt.toISOString(),
    };
  }

  // The garage's live file, which must be asking for more.
  private async askingFile(actor: Actor): Promise<VerificationFile> {
    if (!actor.garageId) throw notFound();
    if (actor.role !== 'garage') throw forbidden();
    const file = await this.prisma.verificationFile.findFirst({
      orderBy: newestFirst,
      where: { garageId: actor.garageId },
    });
    if (!file) throw notFound();
    if (file.status !== 'more_requested') {
      throw new HttpException(
        {
          code: 'verification_transition_refused',
          currentStatus: file.status,
          message: 'The file asks for nothing more',
        },
        HttpStatus.CONFLICT,
      );
    }
    return file;
  }

  private openCopy(fileId: string) {
    return this.prisma.listingDraft.findFirst({
      where: { status: 'open', verificationFileId: fileId },
    });
  }

  // A second open racing this one made the copy first: that one is answered.
  private async create(actor: Actor, file: VerificationFile) {
    const account = await this.prisma.account.findUniqueOrThrow({
      select: { email: true, language: true },
      where: { id: actor.accountId },
    });
    const data = await copyOf(this.prisma, file.garageId);
    // Equal stamps: a later save is what tells the copy was edited.
    const at = new Date();
    try {
      const copy = await this.prisma.listingDraft.create({
        data: {
          createdAt: at,
          data: data as never,
          email: account.email ?? '',
          language: account.language,
          step: askedSteps(file.requestedItems)[0] as number,
          updatedAt: at,
          verificationFileId: file.id,
        },
      });
      this.logger.log(
        `completion copy ${copy.id} opened for file ${file.id} garage ${file.garageId}`,
      );
      countCompletionOpened();
      return copy;
    } catch (error) {
      if (!taken(error)) throw error;
      const copy = await this.openCopy(file.id);
      if (!copy) throw error;
      return copy;
    }
  }
}
