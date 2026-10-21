import {
  checkListing,
  type FieldProblem,
  isListingDraftData,
  isSurveySection,
  type ListingDraftData,
  type ListingSubmittedDto,
  stripCui,
  surveyComplete,
} from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../../../audit/audit.port';
import { AccountsService } from '../../../auth/accounts.service';
import { hashToken } from '../../../auth/email-confirmation/email-confirmation';
import { type Actor, assertGarage } from '../../../auth/policy';
import { PRISMA } from '../../../auth/prisma';
import { refusal, taken } from '../../../auth/sign-up.service';
import { localDay } from '../../../bucharest';
import { EVENT_PORT, type EventPort } from '../../../events/event.port';
import type {
  ListingDraft,
  Prisma,
  PrismaClient,
} from '../../../generated/prisma/client';
import { countListingSubmission } from '../../../metrics/product-counters';
import { GarageDetailsService } from '../../details/garage-details.service';
import { LegalDocumentsService } from '../../documents/legal-documents/legal-documents.service';
import { writeGarageBrands } from '../../garage-brands/write-garage-brands';
import { writeGarageHours } from '../../garage-hours';
import { writeGaragePayments } from '../../garage-settings/write-garage-payments';
import { GarageMechanicsService } from '../../mechanics/garage-mechanics.service';
import { GaragePhotosService } from '../../photos/garage-photos.service';
import {
  ListingPhotosService,
  type PhotoSize,
} from '../../photos/listing-photos/listing-photos.service';
import { GaragePlaceService } from '../../place/garage-place.service';
import { GaragePricesService } from '../../prices/garage-prices/garage-prices.service';
import { applySurvey } from '../../survey/survey';
import { VerificationService } from '../../verification/verification.service';
import { ListingDraftsService } from '../listing-drafts.service';

const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'draft_not_found', 'No such draft');

const sentAlready = () =>
  refusal(
    HttpStatus.CONFLICT,
    'draft_already_submitted',
    'This listing was already sent',
  );

const ownsOne = () =>
  refusal(
    HttpStatus.CONFLICT,
    'garage_already_exists',
    'This account already has a garage',
  );

const OWNER_PERMISSIONS = {
  canAnswerQuotes: true,
  canMoveBookings: true,
  canRecordFinalPrice: true,
};

const SENT_STATUSES: readonly unknown[] = ['approved', 'submitted'];

const isSent = (value: unknown): value is ListingSubmittedDto => {
  const sent = value as Record<string, unknown> | null;
  return (
    typeof sent === 'object' &&
    sent !== null &&
    typeof sent['fileId'] === 'string' &&
    typeof sent['garageId'] === 'string' &&
    SENT_STATUSES.includes(sent['status']) &&
    Array.isArray(sent['warnings'])
  );
};

// The answer a sent draft keeps for its key; another key, or a stored answer
// that is not one, is refused.
function earlierAnswer(
  draft: ListingDraft,
  key: string,
): ListingSubmittedDto | undefined {
  if (draft.status !== 'submitted') return undefined;
  if (draft.submitKey !== key || !isSent(draft.submitResult)) {
    throw sentAlready();
  }
  return draft.submitResult;
}

interface Extras {
  holders: string[];
  sizes: PhotoSize[];
  warnings: FieldProblem[];
}

const dataOf = (draft: ListingDraft): ListingDraftData =>
  isListingDraftData(draft.data) ? draft.data : {};

// Turns a complete draft into a garage, its owner and its submitted file, in
// one transaction: the steps' own write use cases, then the verification
// file and its documents.
@Injectable()
export class ListingSubmitService {
  now = () => new Date();
  private readonly logger = new Logger('ListingSubmitService');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly drafts: ListingDraftsService,
    private readonly accounts: AccountsService,
    private readonly details: GarageDetailsService,
    private readonly prices: GaragePricesService,
    private readonly mechanics: GarageMechanicsService,
    private readonly place: GaragePlaceService,
    private readonly photos: GaragePhotosService,
    private readonly listingPhotos: ListingPhotosService,
    private readonly verification: VerificationService,
    private readonly documents: LegalDocumentsService,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  async submit(
    actor: Actor,
    id: string,
    token: string | undefined,
    key: string,
  ): Promise<ListingSubmittedDto> {
    const draft = await this.draftOf(id, token);
    const answered = earlierAnswer(draft, key);
    if (answered) return answered;
    // Both read outside the transaction: the object store, and a read the
    // drafts service makes on its own connection.
    const data = dataOf(draft);
    const cui = stripCui(data.steps?.['6']?.cui ?? '');
    const [holders, sizes] = await Promise.all([
      cui ? this.drafts.cuiHeldElsewhere(id, cui) : [],
      this.listingPhotos.describe(data.files ?? []),
    ]);

    const outcome = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM listing_draft WHERE id = ${id}::uuid FOR UPDATE`;
        const locked = await tx.listingDraft.findUniqueOrThrow({
          where: { id },
        });
        const replay = earlierAnswer(locked, key);
        if (replay) return { replay };
        const owned = await tx.garageMember.findFirst({
          where: { accountId: actor.accountId, role: 'owner' },
        });
        if (owned) throw ownsOne();
        const fresh = dataOf(locked);
        const warnings = this.recheck(fresh, locked.email, holders.length > 0);
        const sent = await this.write(tx, actor, fresh, {
          holders,
          sizes,
          warnings,
        });
        await this.markSent(tx, actor, id, key, sent);
        return { sent };
      },
      { timeout: 30_000 },
    );
    if (outcome.replay) return outcome.replay;
    this.logger.log(
      `listing sent: draft ${id} garage ${outcome.sent.garageId} account ${actor.accountId}`,
    );
    countListingSubmission();
    return outcome.sent;
  }

  private async draftOf(id: string, token: string | undefined) {
    if (!token) throw notFound();
    const row = await this.prisma.listingDraftToken.findUnique({
      include: { draft: true },
      where: { hash: hashToken(token) },
    });
    if (!row || row.draft.id !== id) throw notFound();
    return row.draft;
  }

  // The check's rules, the survey's five answers added; the warnings it
  // returns never refuse.
  private recheck(data: ListingDraftData, email: string, cuiHeld: boolean) {
    const { errors, warnings } = checkListing({ data, email });
    if (!isSurveySection(data.survey) || !surveyComplete(data.survey)) {
      errors.push({ code: 'required', field: 'survey' });
    }
    if (cuiHeld) warnings.push({ code: 'cui_in_use', field: 'steps.6.cui' });
    if (errors.length) {
      throw new HttpException(
        {
          code: 'validation_failed',
          errors,
          message: 'The listing is not complete',
          warnings,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return warnings;
  }

  private async markSent(
    tx: Prisma.TransactionClient,
    actor: Actor,
    id: string,
    key: string,
    sent: ListingSubmittedDto,
  ) {
    await tx.listingDraft.update({
      data: {
        status: 'submitted',
        submitKey: key,
        submitResult: sent as unknown as Prisma.InputJsonObject,
        submittedAt: this.now(),
      },
      where: { id },
    });
    await this.audit.record(tx, {
      action: 'update',
      actorId: actor.accountId,
      actorRole: 'garage',
      field: 'status',
      garageId: sent.garageId,
      newValue: 'submitted',
      oldValue: 'draft',
      subjectId: id,
      subjectType: 'listing_draft',
    });
  }

  private async write(
    tx: Prisma.TransactionClient,
    actor: Actor,
    data: ListingDraftData,
    extras: Extras,
  ): Promise<ListingSubmittedDto> {
    const { accountId } = actor;
    await this.accounts.grantRole(
      tx,
      { id: accountId, role: actor.role },
      accountId,
      'garage',
    );
    const { id: garageId } = await this.details.create(
      tx,
      accountId,
      data.steps?.['1'] ?? {},
    );
    const owner: Actor = {
      ...actor,
      garageId,
      permissions: OWNER_PERMISSIONS,
      role: 'garage',
      roles: [...new Set([...actor.roles, 'garage' as const])],
    };
    return this.fill(tx, owner, garageId, data, extras);
  }

  // The new garage's rows, written as its owner.
  private async fill(
    tx: Prisma.TransactionClient,
    owner: Actor,
    garageId: string,
    data: ListingDraftData,
    { holders, sizes, warnings }: Extras,
  ): Promise<ListingSubmittedDto> {
    const { accountId } = owner;
    assertGarage(owner, garageId);
    const steps = data.steps ?? {};
    const cui = stripCui(steps['6']?.cui ?? '');
    await tx.garage.update({ data: { cui }, where: { id: garageId } });
    // Another draft of the account, sent at the same moment, made its owner
    // first.
    await tx.garageMember
      .create({ data: { accountId, garageId, role: 'owner' } })
      .catch((error: unknown) => {
        throw taken(error) ? ownsOne() : error;
      });
    await this.audit.recordMany(tx, [
      {
        action: 'update',
        actorId: accountId,
        actorRole: 'garage',
        field: 'cui',
        garageId,
        newValue: cui,
        subjectId: garageId,
        subjectType: 'garage',
      },
      {
        action: 'create',
        actorId: accountId,
        actorRole: 'garage',
        garageId,
        newValue: { accountId, role: 'owner' },
        subjectId: garageId,
        subjectType: 'garage_member',
      },
    ]);

    await this.writeSteps(tx, garageId, accountId, data, sizes);

    const file = await this.verification.submit(
      tx,
      owner,
      garageId,
      steps['6']?.rarNumber,
    );
    if (holders.length) {
      const cuiWarning = holders.join(', ');
      await tx.verificationFile.update({
        data: { cuiWarning },
        where: { id: file.id },
      });
      await this.audit.record(tx, {
        action: 'update',
        actorId: accountId,
        actorRole: 'garage',
        field: 'cuiWarning',
        garageId,
        // The other holders' names stay on the file, for the admins only.
        internal: true,
        newValue: 'cui_in_use',
        subjectId: file.id,
        subjectType: 'verification_file',
      });
    }
    await this.documents.attach(tx, owner, data, { garageId, id: file.id });
    await this.events.record(tx, {
      audience: { garageId, type: 'verification' },
      kind: 'garage.created',
      payload: { accountId, garageId },
      subjectId: garageId,
    });
    return {
      fileId: file.id,
      garageId,
      status: file.status === 'approved' ? 'approved' : 'submitted',
      warnings,
    };
  }

  // Every step's rows, each through the write use case of its step.
  private async writeSteps(
    tx: Prisma.TransactionClient,
    garageId: string,
    accountId: string,
    data: ListingDraftData,
    sizes: PhotoSize[],
  ) {
    const steps = data.steps ?? {};
    const audit = this.audit;
    // The brands go first with no jobs, then again with the jobs the prices
    // made, so a taken brand's unticked refs find proposed jobs by name.
    await writeGarageBrands(tx, garageId, steps['2'], {
      actorId: accountId,
      audit,
      jobs: [],
    });
    const given = {
      jobs: steps['3']?.jobs ?? [],
      labour: steps['3']?.labour ?? {},
    };
    const priced = await this.prices.saveStarting(
      tx,
      garageId,
      accountId,
      given,
    );
    await writeGarageBrands(tx, garageId, steps['2'], {
      actorId: accountId,
      audit,
      jobs: priced.jobs.map(({ jobTypeId, position }) => ({
        jobTypeId,
        name: given.jobs[position]?.name,
      })),
    });
    await this.mechanics.saveCards(tx, garageId, accountId, steps['4'] ?? {});
    const hours = steps['5'] ?? {};
    if (hours.place) {
      await this.place.write(tx, accountId, garageId, hours.place);
    }
    await writeGarageHours(tx, garageId, hours, localDay(this.now()), {
      actorId: accountId,
      audit,
    });
    await writeGaragePayments(tx, garageId, hours, {
      actorId: accountId,
      audit,
    });
    await this.photos.saveRows(
      tx,
      garageId,
      (data.files ?? []).map(
        (key) => sizes.find((size) => size.key === key) ?? { key },
      ),
      accountId,
    );
    await applySurvey(
      tx,
      { actorId: accountId, answers: data.survey, garageId },
      audit,
    );
  }
}
