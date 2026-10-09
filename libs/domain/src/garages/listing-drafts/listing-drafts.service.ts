import {
  type ContinueLinkSentDto,
  DECLARED_NAME_MAX,
  DECLARED_NAME_MIN,
  DOCUMENT_KINDS,
  type DraftDocuments,
  EMAIL_PATTERN,
  isListingDraftData,
  issuedWithinWindow,
  type ListingDraftCreatedDto,
  type ListingDraftData,
  type ListingDraftDto,
  type ListingDraftSavedDto,
} from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import {
  continueLink,
  DRAFT_MAX_BYTES,
  LINKS_PER_HOUR,
} from './listing-drafts';
import {
  hashToken,
  newToken,
} from '../../auth/email-confirmation/email-confirmation';
import { PRISMA } from '../../auth/prisma';
import { refusal } from '../../auth/sign-up.service';
import type {
  ListingDraft,
  Prisma,
  PrismaClient,
} from '../../generated/prisma/client';
import {
  countDeclarationSigned,
  countGarageSignUp,
} from '../../metrics/product-counters';
import type { EmailConfig } from '../../notifications/email-config';
import { NotificationsService } from '../../notifications/notifications.service';
import { INVITE_EMAIL } from '../staff-invite/staff-invite.service';

const HOUR_MS = 60 * 60 * 1000;

interface DraftBody {
  email?: string;
  data: unknown;
  step: number;
  language: 'ro' | 'en';
}

interface LinkSend {
  sentAt?: Date;
  retryAfterSeconds?: number;
}

const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such draft');
const waitRefusal = (code: string, message: string, seconds: number) =>
  new HttpException(
    { code, message, retryAfterSeconds: seconds },
    HttpStatus.TOO_MANY_REQUESTS,
  );

// The address as the DTO leaves it, for callers that do not pass through it.
function checkedEmail(email: string): string {
  const normal = email.trim().toLowerCase();
  if (normal.length < 3 || normal.length > 254 || !EMAIL_PATTERN.test(normal)) {
    throw refusal(
      HttpStatus.BAD_REQUEST,
      'validation_failed',
      'The e-mail address is not valid',
      [{ code: 'email_invalid', field: 'email' }],
    );
  }
  return normal;
}

function checkedData(data: unknown): Prisma.InputJsonObject {
  if (!isListingDraftData(data)) {
    throw refusal(
      HttpStatus.BAD_REQUEST,
      'validation_failed',
      'The draft data is not valid',
    );
  }
  if (data.declaredByName !== undefined) {
    const name = data.declaredByName.trim();
    if (name.length < DECLARED_NAME_MIN || name.length > DECLARED_NAME_MAX) {
      throw refusal(
        HttpStatus.BAD_REQUEST,
        'validation_failed',
        'The declarer name must have 2 to 80 characters',
        [{ code: 'invalid', field: 'declaredByName' }],
      );
    }
    return checkedSize({ ...data, declaredByName: name });
  }
  return checkedSize(data);
}

function checkedSize(data: ListingDraftData): Prisma.InputJsonObject {
  if (Buffer.byteLength(JSON.stringify(data)) > DRAFT_MAX_BYTES) {
    throw refusal(
      HttpStatus.PAYLOAD_TOO_LARGE,
      'draft_too_large',
      'The draft is too large to save',
    );
  }
  return data as Prisma.InputJsonObject;
}

const noSuchPhoto = () =>
  refusal(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'validation_failed',
    'The draft holds no such photo',
    [{ code: 'invalid', field: 'files' }],
  );

const noSuchPage = () =>
  refusal(
    HttpStatus.BAD_REQUEST,
    'validation_failed',
    'The draft holds no such document page',
    [{ code: 'invalid', field: 'documents' }],
  );

const issuedOutside = () =>
  refusal(
    HttpStatus.BAD_REQUEST,
    'validation_failed',
    'The certificate must be issued in the last 30 days',
    [{ code: 'out_of_range', field: 'documents.onrc_certificate.issuedOn' }],
  );

// The calendar date the 30-day rule is judged against on the server.
const bucharestDate = (at: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(at);

// A save orders the photos the draft holds and nothing more: a key only a
// confirm added may come in, and one it left out (an older copy of the form)
// stays, at the end. Only the photo delete takes a key out.
function heldFiles(held: string[], data: ListingDraftData): string[] {
  const sent = [...new Set(data.files ?? [])];
  if (sent.some((key) => !held.includes(key))) throw noSuchPhoto();
  return [...sent, ...held.filter((key) => !sent.includes(key))];
}

// The same rule per document kind; a kind the save omits keeps its stored
// entry. An issue date set or changed must fall in the window, while a
// stored one is kept as it ages.
function heldDocuments(
  held: DraftDocuments,
  sent: DraftDocuments,
  today: string,
): DraftDocuments {
  const next = { ...held };
  for (const kind of DOCUMENT_KINDS) {
    const entry = sent[kind];
    if (!entry) continue;
    const stored = held[kind];
    const keys = stored?.pages ?? [];
    if (entry.pages.some((key) => !keys.includes(key))) throw noSuchPage();
    const { issuedOn } = entry;
    if (
      issuedOn !== undefined &&
      issuedOn !== stored?.issuedOn &&
      !issuedWithinWindow(issuedOn, today)
    )
      throw issuedOutside();
    next[kind] = {
      ...entry,
      pages: [
        ...entry.pages,
        ...keys.filter((key) => !entry.pages.includes(key)),
      ],
    };
  }
  return next;
}

// The time of the tick is the server's: set by the save that adds it, kept
// by one that keeps it, gone with it. The browser only says whether it is on.
function declaredAt(stored: string | undefined, ticked: boolean, at: Date) {
  if (!ticked) return undefined;
  return stored ?? at.toISOString();
}

async function withHeldKeys(
  tx: Prisma.TransactionClient,
  id: string,
  data: Prisma.InputJsonObject,
  at: Date,
): Promise<{ data: Prisma.InputJsonObject; signed: boolean }> {
  await tx.$queryRaw`SELECT id FROM listing_draft WHERE id = ${id}::uuid FOR UPDATE`;
  const row = await tx.listingDraft.findUniqueOrThrow({ where: { id } });
  const stored = isListingDraftData(row.data) ? row.data : {};
  const sent = data as ListingDraftData;
  const files = heldFiles(stored.files ?? [], sent);
  const documents = heldDocuments(
    stored.documents ?? {},
    sent.documents ?? {},
    bucharestDate(at),
  );
  const { declaredAt: ticked, ...rest } = data;
  const declared = declaredAt(stored.declaredAt, Boolean(ticked), at);
  return {
    data: {
      ...rest,
      ...(files.length > 0 && { files }),
      ...(Object.keys(documents).length > 0 && { documents }),
      ...(declared && { declaredAt: declared }),
    },
    signed: declared !== undefined && stored.declaredAt === undefined,
  };
}

const saved = (draft: ListingDraft): ListingDraftSavedDto => ({
  email: draft.email,
  id: draft.id,
  language: draft.language === 'en' ? 'en' : 'ro',
  status: draft.status,
  step: draft.step,
  updatedAt: draft.updatedAt.toISOString(),
});

const linkResult = (send: LinkSend) => ({
  linkSent: send.sentAt !== undefined,
  ...(send.retryAfterSeconds !== undefined && {
    retryAfterSeconds: send.retryAfterSeconds,
  }),
});

// A visitor's unfinished listing, kept against the e-mail they gave and
// reached only by a key: the browser's own, or one a link e-mail carried.
// Only the keys' hashes are stored.
@Injectable()
export class ListingDraftsService {
  now = () => new Date();
  private readonly logger = new Logger('ListingDraftsService');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    @Inject(INVITE_EMAIL) private readonly config: EmailConfig,
  ) {}

  async create(
    body: DraftBody & { email: string },
  ): Promise<ListingDraftCreatedDto> {
    const email = checkedEmail(body.email);
    const data = checkedData(body.data);
    // A new draft holds no photo or page yet: only a confirm adds one.
    if ((data as ListingDraftData).files?.length) throw noSuchPhoto();
    if (Object.keys((data as ListingDraftData).documents ?? {}).length)
      throw noSuchPage();
    const webUrl = this.webUrl();
    const browser = newToken();
    const at = this.now();
    const { declaredAt: sentAt, ...rest } = data;
    const declared = declaredAt(undefined, Boolean(sentAt), at);
    const draft = await this.prisma.listingDraft.create({
      data: {
        data: { ...rest, ...(declared && { declaredAt: declared }) },
        email,
        language: body.language,
        step: body.step,
        tokens: {
          create: { hash: browser.hash, kind: 'browser', sentAt: at },
        },
        updatedAt: at,
      },
    });
    // The one garage onboarding action today; it moves to the use case that
    // creates a garage account once there is one.
    countGarageSignUp();
    if (declared) countDeclarationSigned();
    const send = await this.issueSaved(draft, webUrl);
    return { ...saved(draft), token: browser.token, ...linkResult(send) };
  }

  async current(token: string | undefined): Promise<ListingDraftDto> {
    const draft = await this.byToken(token);
    return {
      ...saved(draft),
      data: draft.data as ListingDraftDto['data'],
    };
  }

  // The data replaces what was there, whole. A new address revokes every
  // key the draft had, so the old inbox no longer opens it.
  async save(
    id: string,
    token: string | undefined,
    body: DraftBody,
  ): Promise<ListingDraftSavedDto> {
    const draft = await this.open(id, token);
    const data = checkedData(body.data);
    const email =
      body.email === undefined ? draft.email : checkedEmail(body.email);
    const moved = email !== draft.email;
    const webUrl = moved ? this.webUrl() : '';
    const browser = newToken();
    const at = this.now();
    let signed = false;
    const next = await this.prisma.$transaction(async (tx) => {
      if (moved) {
        // The hour's links stay counted, under hashes no key matches, so a
        // new address never buys more e-mails.
        const counted = {
          draftId: id,
          kind: 'link' as const,
          sentAt: { gt: new Date(at.getTime() - HOUR_MS) },
        };
        await tx.listingDraftToken.deleteMany({
          where: { draftId: id, NOT: counted },
        });
        const links = await tx.listingDraftToken.findMany({ where: counted });
        for (const link of links) {
          await tx.listingDraftToken.update({
            data: { hash: newToken().hash },
            where: { hash: link.hash },
          });
        }
        await tx.listingDraftToken.create({
          data: {
            draftId: id,
            hash: browser.hash,
            kind: 'browser',
            sentAt: at,
          },
        });
      }
      const held = await withHeldKeys(tx, id, data, at);
      signed = held.signed;
      return tx.listingDraft.update({
        data: {
          data: held.data,
          email,
          language: body.language,
          step: body.step,
          updatedAt: at,
        },
        where: { id },
      });
    });
    if (signed) countDeclarationSigned();
    if (!moved) return saved(next);
    const send = await this.issueSaved(next, webUrl);
    return { ...saved(next), token: browser.token, ...linkResult(send) };
  }

  async sendLink(
    id: string,
    token: string | undefined,
  ): Promise<ContinueLinkSentDto> {
    const draft = await this.open(id, token);
    const send = await this.issueLink(draft, this.webUrl());
    if (!send.sentAt) {
      throw waitRefusal(
        'link_already_sent',
        'Several links went out this hour; try again later',
        send.retryAfterSeconds ?? 1,
      );
    }
    return { sentAt: send.sentAt.toISOString() };
  }

  // A new link token and its e-mail, unless the past hour already had its
  // share of links. The draft's row lock makes two sends at once count
  // one after the other.
  private async issueLink(
    draft: ListingDraft,
    webUrl: string,
  ): Promise<LinkSend> {
    const at = this.now();
    const issued = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM listing_draft WHERE id = ${draft.id}::uuid FOR UPDATE`;
      const recent = await tx.listingDraftToken.findMany({
        orderBy: { sentAt: 'desc' },
        select: { sentAt: true },
        take: LINKS_PER_HOUR,
        where: {
          draftId: draft.id,
          kind: 'link',
          sentAt: { gt: new Date(at.getTime() - HOUR_MS) },
        },
      });
      const oldest = recent[LINKS_PER_HOUR - 1];
      if (oldest) {
        const wait = oldest.sentAt.getTime() + HOUR_MS - at.getTime();
        return { retryAfterSeconds: Math.max(1, Math.ceil(wait / 1000)) };
      }
      const link = newToken();
      await tx.listingDraftToken.create({
        data: { draftId: draft.id, hash: link.hash, kind: 'link', sentAt: at },
      });
      return { token: link.token };
    });
    if (!issued.token) return { retryAfterSeconds: issued.retryAfterSeconds };
    await this.notifications.sendToDraft(
      'LISTING_CONTINUE_LINK',
      draft.id,
      continueLink(webUrl, draft.language === 'en' ? 'en' : 'ro', issued.token),
    );
    return { sentAt: at };
  }

  // The draft is kept even when its link e-mail cannot be queued: the
  // answer says no link went, and the button can ask for one again.
  private async issueSaved(
    draft: ListingDraft,
    webUrl: string,
  ): Promise<LinkSend> {
    try {
      return await this.issueLink(draft, webUrl);
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'unknown';
      this.logger.error(`listing draft link failed for ${draft.id}: ${reason}`);
      return {};
    }
  }

  // The draft a key opens, which must be the one named and still open.
  async open(id: string, token: string | undefined) {
    const draft = await this.byToken(token);
    if (draft.id !== id) throw notFound();
    if (draft.status === 'submitted') {
      throw refusal(
        HttpStatus.CONFLICT,
        'draft_submitted',
        'This listing was already sent',
      );
    }
    return draft;
  }

  private async byToken(token: string | undefined): Promise<ListingDraft> {
    if (!token) throw notFound();
    const row = await this.prisma.listingDraftToken.findUnique({
      include: { draft: true },
      where: { hash: hashToken(token) },
    });
    if (!row) throw notFound();
    return row.draft;
  }

  // A link needs an absolute address; without one nothing is stored.
  private webUrl(): string {
    if (!this.config.webUrl) throw new Error('PUBLIC_WEB_URL is not set');
    return this.config.webUrl;
  }
}
