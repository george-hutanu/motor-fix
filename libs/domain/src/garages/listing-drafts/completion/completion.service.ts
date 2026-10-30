import {
  askedSteps,
  type CompletionCopyDto,
  type FieldProblem,
  isListingDraftData,
  type ListingDraftData,
  type ListingSubmittedDto,
  normaliseRarNumber,
  stripCui,
  VERIFICATION_REASON_CODES,
} from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import { copyOf, heldOf } from './completion.copy';
import { AUDIT_PORT, type AuditPort } from '../../../audit/audit.port';
import { newToken } from '../../../auth/email-confirmation/email-confirmation';
import { refusal } from '../../../auth/http-refusal';
import type { Actor } from '../../../auth/policy';
import { PRISMA } from '../../../auth/prisma';
import { taken } from '../../../auth/sign-up.service';
import { localDay } from '../../../bucharest';
import { EVENT_PORT, type EventPort } from '../../../events/event.port';
import type {
  Prisma,
  PrismaClient,
  VerificationFile,
} from '../../../generated/prisma/client';
import { countCompletionOpened } from '../../../metrics/product-counters';
import { GarageDetailsService } from '../../details/garage-details.service';
import { LegalDocumentsService } from '../../documents/legal-documents/legal-documents.service';
import { writeGarageBrands } from '../../garage-brands/write-garage-brands';
import { writeGarageHours } from '../../garage-hours';
import { writeGaragePayments } from '../../garage-settings/write-garage-payments';
import { GarageMechanicsService } from '../../mechanics/garage-mechanics.service';
import { GaragePhotosService } from '../../photos/garage-photos.service';
import type { PhotoSize } from '../../photos/listing-photos/listing-photos.service';
import { GaragePlaceService } from '../../place/garage-place.service';
import { GaragePricesService } from '../../prices/garage-prices/garage-prices.service';
import {
  newestFirst,
  VerificationService,
} from '../../verification/verification.service';

const KEPT_BROWSER_KEYS = 4;

const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No file to complete');
const forbidden = () =>
  refusal(HttpStatus.FORBIDDEN, 'forbidden', 'Only the owner completes it');

const refused = (currentStatus: string) =>
  new HttpException(
    {
      code: 'verification_transition_refused',
      currentStatus,
      message: 'The file asks for nothing more',
    },
    HttpStatus.CONFLICT,
  );

// The decisions a copy answers: a request for more, sent back on the same
// file, and a rejection, answered with a new file after it.
const CORRECTABLE: readonly string[] = ['more_requested', 'rejected'];

// What the form starts from: the items a request for more names, or the
// reason a rejection gave, one it does not know read as other.
const askedItems = (file: VerificationFile): string[] =>
  file.status === 'rejected'
    ? [
        VERIFICATION_REASON_CODES.find((code) => code === file.reasonCode) ??
          'other',
      ]
    : file.requestedItems;

// Equal whatever order the keys were saved in.
function same(a: unknown, b: unknown): boolean {
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value)
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([key, inner]) => [key, sorted(inner)]),
    );
  };
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}

type Steps = NonNullable<ListingDraftData['steps']>;

// What the sending read before its transaction.
export interface Sending {
  holders: string[];
  sizes: PhotoSize[];
  warnings: FieldProblem[];
}

// The listing form reopened over a live garage, to answer the admins'
// request for more: one open copy per file, bound to it, sent back over the
// garage it copies.
@Injectable()
export class CompletionService {
  private readonly logger = new Logger('Completion');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly details: GarageDetailsService,
    private readonly prices: GaragePricesService,
    private readonly mechanics: GarageMechanicsService,
    private readonly place: GaragePlaceService,
    private readonly photos: GaragePhotosService,
    private readonly documents: LegalDocumentsService,
    private readonly verification: VerificationService,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
  ) {}

  async open(actor: Actor): Promise<CompletionCopyDto> {
    const file = await this.askingFile(actor);
    const copy =
      (await this.openCopy(file.id)) ?? (await this.create(actor, file));
    await this.dropOldKeys(copy.id);
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
      data: isListingDraftData(copy.data) ? copy.data : {},
      edited: copy.updatedAt > copy.createdAt,
      email: copy.email,
      held: await heldOf(this.prisma, file.id),
      id: copy.id,
      language: copy.language,
      requestedItems: askedItems(file),
      status: copy.status,
      step: copy.step,
      token: key.token,
      updatedAt: copy.updatedAt.toISOString(),
    };
  }

  // Each page load gets a key of its own; the newest few stay, enough for
  // the owner's other open tabs.
  private async dropOldKeys(draftId: string) {
    const kept = await this.prisma.listingDraftToken.findMany({
      orderBy: { sentAt: 'desc' },
      select: { hash: true },
      take: KEPT_BROWSER_KEYS - 1,
      where: { draftId, kind: 'browser' },
    });
    await this.prisma.listingDraftToken.deleteMany({
      where: {
        draftId,
        hash: { notIn: kept.map((token) => token.hash) },
        kind: 'browser',
      },
    });
  }

  // The garage's newest file, which must ask for more or be rejected.
  private async askingFile(actor: Actor): Promise<VerificationFile> {
    if (!actor.garageId) throw notFound();
    if (actor.role !== 'garage') throw forbidden();
    const file = await this.prisma.verificationFile.findFirst({
      orderBy: newestFirst,
      where: { garageId: actor.garageId },
    });
    if (!file) throw notFound();
    if (!CORRECTABLE.includes(file.status)) throw refused(file.status);
    return file;
  }

  // The copy's file, locked, which must still ask the actor's garage for
  // more, or be its newest file and rejected.
  async fileFor(
    tx: Prisma.TransactionClient,
    actor: Actor,
    fileId: string,
  ): Promise<VerificationFile> {
    await tx.$queryRaw`SELECT id FROM verification_file WHERE id = ${fileId}::uuid FOR UPDATE`;
    const file = await tx.verificationFile.findUniqueOrThrow({
      where: { id: fileId },
    });
    if (actor.garageId !== file.garageId) throw notFound();
    if (actor.role !== 'garage') throw forbidden();
    if (!CORRECTABLE.includes(file.status)) throw refused(file.status);
    if (file.status === 'rejected') {
      const newest = await this.newestOf(tx, file.garageId);
      if (newest.id !== file.id) throw refused(newest.status);
    }
    return file;
  }

  private newestOf(tx: Prisma.TransactionClient, garageId: string) {
    return tx.verificationFile.findFirstOrThrow({
      orderBy: newestFirst,
      where: { garageId },
    });
  }

  // The copy written back over its garage, then the file sent back for
  // verification, or a new file sent after a rejected one, which stays as
  // the decision left it. The survey stays as the first sending left it.
  async resend(
    tx: Prisma.TransactionClient,
    actor: Actor,
    file: VerificationFile,
    data: ListingDraftData,
    { holders, sizes, warnings }: Sending,
  ): Promise<{ dropped: string[]; sent: ListingSubmittedDto }> {
    const { cuiChanged, dropped } = await this.writeGarage(
      tx,
      actor.accountId,
      file.garageId,
      data,
      sizes,
    );
    const others = cuiChanged ? holders : [];
    const sent =
      file.status === 'rejected'
        ? await this.sendAfter(tx, actor, file, data, others)
        : await this.sendBack(tx, actor, file, data, others);
    const held = new Set(
      (await heldOf(tx, sent.id)).map(
        (document) => `documents.${document.kind}`,
      ),
    );
    return {
      dropped,
      sent: {
        fileId: sent.id,
        garageId: file.garageId,
        status: sent.status === 'approved' ? 'approved' : 'submitted',
        warnings: warnings.filter(
          (warning) =>
            warning.code !== 'document_missing' || !held.has(warning.field),
        ),
      },
    };
  }

  // A request for more: the copy's documents replace the file's own, then
  // the file goes back for verification.
  private async sendBack(
    tx: Prisma.TransactionClient,
    actor: Actor,
    file: VerificationFile,
    data: ListingDraftData,
    holders: string[],
  ) {
    await this.fileFields(tx, actor, file, data, holders);
    await this.documents.replace(tx, actor, data.documents, file);
    return this.verification.resend(tx, actor, file.id);
  }

  // A rejection: a new file through the submit transition, holding the
  // copy's documents and the rejected file's others.
  private async sendAfter(
    tx: Prisma.TransactionClient,
    actor: Actor,
    file: VerificationFile,
    data: ListingDraftData,
    holders: string[],
  ) {
    const next = await this.verification.submit(
      tx,
      actor,
      file.garageId,
      data.steps?.['6']?.rarNumber,
    );
    await this.fileFields(tx, actor, next, data, holders);
    await this.documents.carry(tx, actor, file, next, data.documents);
    return next;
  }

  // The refusal a sent copy answers a new key with: the garage's newest
  // file has moved on.
  async movedOn(fileId: string): Promise<HttpException> {
    const file = await this.prisma.verificationFile.findUniqueOrThrow({
      where: { id: fileId },
    });
    return refused((await this.newestOf(this.prisma, file.garageId)).status);
  }

  // Each step through its own writer, and only where it differs from the
  // garage; answers whether the CUI changed and the photo keys let go of.
  private async writeGarage(
    tx: Prisma.TransactionClient,
    accountId: string,
    garageId: string,
    data: ListingDraftData,
    sizes: PhotoSize[],
  ): Promise<{ cuiChanged: boolean; dropped: string[] }> {
    // The garage's row before any card's, the order a mechanic's week save
    // takes them in, so the two cannot deadlock.
    await tx.$queryRaw`SELECT id FROM garage WHERE id = ${garageId}::uuid FOR UPDATE`;
    const live = await copyOf(tx, garageId);
    const steps = data.steps ?? {};
    const was = live.steps ?? {};
    await this.details.update(tx, accountId, garageId, steps['1'] ?? {});
    const cuiChanged = await this.writeCui(
      tx,
      accountId,
      garageId,
      steps['6']?.cui,
      was['6']?.cui,
    );
    await this.writeOffer(tx, accountId, garageId, steps, was);
    await this.mechanics.saveAgain(tx, garageId, accountId, steps['4'] ?? {});
    await this.writeHours(tx, accountId, garageId, steps['5'] ?? {}, was['5']);
    const files = data.files ?? [];
    if (!same(files, live.files)) {
      await this.photos.saveRows(
        tx,
        garageId,
        files.map((key) => sizes.find((size) => size.key === key) ?? { key }),
        accountId,
      );
    }
    const dropped = (live.files ?? []).filter((key) => !files.includes(key));
    return { cuiChanged, dropped };
  }

  private async writeCui(
    tx: Prisma.TransactionClient,
    actorId: string,
    garageId: string,
    given: string | undefined,
    stored: string | undefined,
  ): Promise<boolean> {
    const cui = stripCui(given ?? '');
    if (cui === (stored ?? '')) return false;
    await tx.garage.update({ data: { cui }, where: { id: garageId } });
    await this.audit.recordChanges(
      tx,
      {
        actorId,
        actorRole: 'garage',
        garageId,
        subjectId: garageId,
        subjectType: 'garage',
      },
      { cui: stored ?? null },
      { cui },
    );
    return true;
  }

  // The prices, then the brands with the jobs those prices list.
  private async writeOffer(
    tx: Prisma.TransactionClient,
    actorId: string,
    garageId: string,
    steps: Steps,
    was: Steps,
  ) {
    const given = {
      jobs: steps['3']?.jobs ?? [],
      labour: steps['3']?.labour ?? {},
    };
    const priced = await this.prices.saveAgain(
      tx,
      garageId,
      actorId,
      given,
      steps['2']?.brands
        ?.filter((brand) => brand.stance === 'works_on')
        .map((brand) => brand.brandId),
    );
    if (same(steps['2'], was['2']) && same(steps['3'], was['3'])) return;
    await writeGarageBrands(tx, garageId, steps['2'], {
      actorId,
      audit: this.audit,
      jobs: priced.jobs.map(({ jobTypeId, position }) => ({
        jobTypeId,
        name: given.jobs[position]?.name,
      })),
    });
  }

  private async writeHours(
    tx: Prisma.TransactionClient,
    actorId: string,
    garageId: string,
    hours: NonNullable<Steps['5']>,
    was: Steps['5'],
  ) {
    if (hours.place && !same(hours.place, was?.place)) {
      await this.place.write(tx, actorId, garageId, hours.place);
    }
    if (same(hours, was)) return;
    const by = { actorId, audit: this.audit };
    const clipped = await writeGarageHours(
      tx,
      garageId,
      hours,
      localDay(new Date()),
      { ...by, events: this.events },
    );
    if (clipped.length > 0) {
      this.logger.log(
        `garage ${garageId} hours clipped ${clipped.length} mechanic cards: ${clipped.join(', ')}`,
      );
    }
    await writeGaragePayments(tx, garageId, hours, by);
  }

  // What the file itself holds of the listing: the RAR number, the
  // declaration, and the other holders of a CUI changed now.
  private async fileFields(
    tx: Prisma.TransactionClient,
    actor: Actor,
    file: VerificationFile,
    data: ListingDraftData,
    holders: string[],
  ) {
    const change = {
      actorId: actor.accountId,
      actorRole: 'garage' as const,
      garageId: file.garageId,
      subjectId: file.id,
      subjectType: 'verification_file',
    };
    const rar = data.steps?.['6']?.rarNumber;
    const before = {
      declaredAt: file.declaredAt?.toISOString() ?? null,
      declaredByName: file.declaredByName,
      rarNumber: file.rarNumber,
    };
    const after = {
      declaredAt: data.declaredAt ?? null,
      declaredByName: data.declaredByName ?? null,
      rarNumber: rar ? normaliseRarNumber(rar) : null,
    };
    if (!same(before, after)) {
      await tx.verificationFile.update({
        data: {
          ...after,
          declaredAt: after.declaredAt ? new Date(after.declaredAt) : null,
        },
        where: { id: file.id },
      });
      await this.audit.recordChanges(tx, change, before, after);
    }
    if (holders.length === 0) return;
    await tx.verificationFile.update({
      data: { cuiWarning: holders.join(', ') },
      where: { id: file.id },
    });
    await this.audit.record(tx, {
      ...change,
      action: 'update',
      field: 'cuiWarning',
      // The other holders' names stay on the file, for the admins only.
      internal: true,
      newValue: 'cui_in_use',
    });
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
          step: askedSteps(askedItems(file))[0] as number,
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
