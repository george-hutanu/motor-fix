import {
  CERTIFICATION_MAX,
  CERTIFICATIONS_MAX,
  type FieldProblem,
  type GarageMechanicDto,
  type GarageMechanicsDto,
  isRecord,
  MECHANIC_CARD_NAME_MAX,
  MECHANIC_NAME_MAX,
  MECHANIC_NAME_MIN,
  MECHANICS_MAX,
  type MechanicsSection,
  ROLE_TITLE_MAX,
  SPECIALITY_MAX,
  SPECIALTIES_MAX,
  TAG_MAX,
  YEARS_MAX,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { refusal } from '../../auth/http-refusal';
import type { Actor } from '../../auth/policy';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import type {
  Mechanic,
  Prisma,
  PrismaClient,
} from '../../generated/prisma/client';
import { NotificationsService } from '../../notifications/notifications.service';
import { removeMechanicBlocks } from '../../workshop/time-blocks/time-blocks';
import { featureOn } from '../features/feature-on';
import { assertGarageOwner } from '../garage-brands/garage-brands.service';
import { writeTeamOnProfile } from '../garage-settings/write-team-on-profile';
import { plainText } from '../plain-text';
import {
  isShownOnProfile,
  shownOnProfile,
} from '../public-garages/public-garages';

const byName = new Intl.Collator('ro', { sensitivity: 'base' });

const CARD_SELECT = {
  accountId: true,
  brandIds: true,
  certifications: true,
  id: true,
  invites: {
    orderBy: { createdAt: 'desc' },
    select: {
      createdAt: true,
      email: true,
      expiresAt: true,
      id: true,
      phone: true,
    },
    take: 1,
    where: { status: 'sent' },
  },
  isOwner: true,
  name: true,
  onProfile: true,
  rating: true,
  removedAt: true,
  reviewCount: true,
  roleTitle: true,
  speciality: true,
  specialties: true,
  takesDirectRequests: true,
  years: true,
} satisfies Prisma.MechanicSelect;

type CardRow = Prisma.MechanicGetPayload<{ select: typeof CARD_SELECT }>;

// A card as the team list answers it.
function itemOf(
  row: CardRow,
  futureBookings: number,
  shown: boolean,
): GarageMechanicDto {
  const [invite] = row.invites;
  return {
    brandIds: row.brandIds,
    certifications: row.certifications,
    futureBookings,
    hasAccount: row.accountId !== null,
    id: row.id,
    invite: invite
      ? {
          email: invite.email,
          expiresAt: invite.expiresAt.toISOString(),
          id: invite.id,
          phone: invite.phone,
          sentAt: invite.createdAt.toISOString(),
        }
      : null,
    isOwner: row.isOwner,
    name: row.name,
    onProfile: row.onProfile,
    rating: row.rating === null ? null : row.rating.toFixed(1),
    reviewCount: row.reviewCount,
    roleTitle: row.roleTitle,
    shown,
    speciality: row.speciality,
    specialties: row.specialties,
    takesDirectRequests: row.takesDirectRequests,
    years: row.years,
  };
}

// The confirmed bookings still to come, per card.
async function futureBookingsOf(
  db: Pick<Prisma.TransactionClient, 'booking'>,
  mechanicIds: string[],
) {
  if (mechanicIds.length === 0) return new Map<string, number>();
  const groups = await db.booking.groupBy({
    _count: { _all: true },
    by: ['mechanicId'],
    where: {
      mechanicId: { in: mechanicIds },
      startsAt: { gt: new Date() },
      status: 'confirmed',
    },
  });
  return new Map(
    groups.map((group) => [group.mechanicId ?? '', group._count._all]),
  );
}

// The fields the mechanic fills in on their own card, and their consent to
// appear on the profile: never the owner's.
const MECHANIC_OWNED = ['photo', 'bio', 'languages', 'onProfile'] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Counted in code points, as the table's char_length checks count them.
const lengthOf = (text: string) => [...text].length;

// The card's fields as the owner may write them; `undefined` leaves one as it is.
type CardFields = {
  brandIds?: string[];
  certifications?: string[];
  name?: string;
  roleTitle?: string | null;
  specialties?: string[];
  takesDirectRequests?: boolean;
  years?: number | null;
};

// The history names the switch by its column, as it names the garage's.
const auditField = (key: keyof CardFields) =>
  key === 'takesDirectRequests' ? 'takes_direct_requests' : key;

function tagsOf(
  value: unknown,
  field: string,
  most: number,
  longest: number,
  errors: FieldProblem[],
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== 'string')) {
    errors.push({ code: 'invalid', field });
    return undefined;
  }
  // Each tag holds 1 to `longest` characters once trimmed; the dialog drops
  // empty parts before it sends, so a blank one here is refused.
  const tags = (value as string[]).map((tag) => plainText(tag).trim());
  if (tags.length > most) errors.push({ code: 'too_many', field });
  else if (tags.includes('')) errors.push({ code: 'invalid', field });
  else if (tags.some((tag) => lengthOf(tag) > longest)) {
    errors.push({ code: 'too_long', field });
  }
  return tags;
}

function nameOf(value: unknown, errors: FieldProblem[]) {
  const name = typeof value === 'string' ? plainText(value).trim() : '';
  const length = lengthOf(name);
  if (length === 0) errors.push({ code: 'required', field: 'name' });
  else if (length < MECHANIC_NAME_MIN) {
    errors.push({ code: 'too_short', field: 'name' });
  } else if (length > MECHANIC_CARD_NAME_MAX) {
    errors.push({ code: 'too_long', field: 'name' });
  }
  return name;
}

// `null` clears the role; a blank one is no role.
function roleOf(value: unknown, errors: FieldProblem[]) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') {
    errors.push({ code: 'invalid', field: 'roleTitle' });
    return undefined;
  }
  const title = plainText(value).trim();
  if (lengthOf(title) > ROLE_TITLE_MAX) {
    errors.push({ code: 'too_long', field: 'roleTitle' });
  }
  return title || null;
}

function yearsOf(value: unknown, errors: FieldProblem[]) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    errors.push({ code: 'invalid', field: 'years' });
  } else if (value < 0 || value > YEARS_MAX) {
    errors.push({ code: 'out_of_range', field: 'years' });
  } else return value;
  return undefined;
}

function directOf(value: unknown, errors: FieldProblem[]) {
  if (value === undefined || typeof value === 'boolean') return value;
  errors.push({ code: 'invalid', field: 'takesDirectRequests' });
  return undefined;
}

// The ids as the table stores them; whether the garage takes each is judged
// against its brands afterwards.
function brandIdsOf(value: unknown, errors: FieldProblem[]) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) {
    errors.push({ code: 'invalid', field: 'brandIds' });
    return undefined;
  }
  const ids = (value as string[]).map((id) => id.toLowerCase());
  if (new Set(ids).size !== ids.length) {
    errors.push({ code: 'duplicate', field: 'brandIds' });
  }
  return ids;
}

// The body judged against the card's limits, every problem at once. An add
// needs the name; an edit judges only the fields it names.
function fieldsOf(body: Record<string, unknown>, adding: boolean) {
  const errors: FieldProblem[] = [];
  const all: CardFields = {
    brandIds: brandIdsOf(body['brandIds'], errors),
    certifications: tagsOf(
      body['certifications'],
      'certifications',
      CERTIFICATIONS_MAX,
      CERTIFICATION_MAX,
      errors,
    ),
    name:
      adding || body['name'] !== undefined
        ? nameOf(body['name'], errors)
        : undefined,
    roleTitle: roleOf(body['roleTitle'], errors),
    specialties: tagsOf(
      body['specialties'],
      'specialties',
      SPECIALTIES_MAX,
      TAG_MAX,
      errors,
    ),
    // A new card takes direct requests; only a saved one is switched.
    takesDirectRequests: adding
      ? undefined
      : directOf(body['takesDirectRequests'], errors),
    years: yearsOf(body['years'], errors),
  };
  const fields = Object.fromEntries(
    Object.entries(all).filter(([, value]) => value !== undefined),
  ) as CardFields;
  return { errors, fields };
}

const refused = (errors: FieldProblem[]) =>
  refusal(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'validation_failed',
    'The mechanic card cannot be saved',
    errors,
  );

const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such mechanic');

// A card's field as the history shows it: a list as one line.
const shown = (value: unknown) =>
  Array.isArray(value) ? value.join(', ') : value;

const joined = (specialties: string[]) => specialties.join(', ') || null;

// The live audience of a card: its public pages only while the profile
// shows it.
export const cardAudience = (
  garageId: string,
  card: { id: string; shown: boolean },
) => ({
  garageId,
  mechanicId: card.id,
  public: card.shown,
  type: 'mechanic' as const,
});

// Whether the profile shows the card now, read in the caller's transaction.
export async function isShownNow(
  db: Pick<Prisma.TransactionClient, 'mechanic'>,
  mechanicId: string,
) {
  return (
    (await db.mechanic.count({
      where: { id: mechanicId, ...shownOnProfile() },
    })) > 0
  );
}

// The card's live audience as the profile shows it now.
export async function cardAudienceNow(
  db: Pick<Prisma.TransactionClient, 'mechanic'>,
  garageId: string,
  mechanicId: string,
) {
  return cardAudience(garageId, {
    id: mechanicId,
    shown: await isShownNow(db, mechanicId),
  });
}

// The body of an add or an edit: an object, with none of the fields the
// mechanic fills in, which are refused before any other is judged.
function ownerFields(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) throw refused([{ code: 'invalid', field: 'body' }]);
  // A DTO instance may carry every declared field as undefined.
  if (MECHANIC_OWNED.some((key) => body[key] !== undefined)) {
    throw refusal(
      HttpStatus.FORBIDDEN,
      'mechanic_owned_field',
      'The mechanic fills in the photo, the bio and the languages, and chooses whether to appear on the profile',
    );
  }
  return body;
}

// A card of the garage still on its team, or 404.
async function cardOf(
  db: Pick<Prisma.TransactionClient, 'mechanic'>,
  garageId: string,
  mechanicId: string,
) {
  const card = await db.mechanic.findFirst({
    select: CARD_SELECT,
    where: { garageId, id: mechanicId, removedAt: null },
  });
  if (!card) throw notFound();
  return card;
}

function sectionErrors(mechanics: MechanicsSection['mechanics'] = []) {
  if (!Array.isArray(mechanics) || !mechanics.every(isRecord)) {
    return [{ code: 'invalid', field: 'mechanics' }];
  }
  if (mechanics.length > MECHANICS_MAX) {
    return [{ code: 'too_many', field: 'mechanics' }];
  }
  return mechanics.flatMap((card, i): FieldProblem[] => {
    // Counted in code points, as the table's char_length check counts them.
    const name = [...plainText(card.name).trim()].length;
    const errors: FieldProblem[] = [];
    if (name < MECHANIC_NAME_MIN || name > MECHANIC_NAME_MAX) {
      errors.push({ code: 'length', field: `mechanics[${i}].name` });
    }
    const speciality = card.speciality ?? '';
    if (plainText(speciality) !== speciality) {
      errors.push({ code: 'invalid', field: `mechanics[${i}].speciality` });
    } else if (speciality.trim().length > SPECIALITY_MAX) {
      errors.push({ code: 'length', field: `mechanics[${i}].speciality` });
    }
    return errors;
  });
}

// The section's cards as the table stores them; a refusal writes nothing.
function cardsOf(section: MechanicsSection) {
  const errors = isRecord(section as unknown)
    ? sectionErrors(section.mechanics)
    : [{ code: 'invalid', field: 'section' }];
  if (errors.length > 0) {
    throw refusal(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'validation_failed',
      'The mechanics cannot be saved',
      errors,
    );
  }
  // The section's switch is the garage's: a card stays off the profile until
  // its own mechanic agrees.
  return (section.mechanics ?? []).map((card) => ({
    name: card.name.trim(),
    speciality: card.speciality?.trim() || null,
  }));
}

// Step 4's switch, when the section carries one.
const switchOf = (section: MechanicsSection) =>
  isRecord(section as unknown) && typeof section.onProfile === 'boolean'
    ? section.onProfile
    : undefined;

// The garage's mechanic cards: saved from step 4 when the listing is sent,
// inside the caller's transaction (a refusal writes nothing), and read back
// for the owner's team list. A card has no account until its mechanic
// accepts an invite.
@Injectable()
export class GarageMechanicsService {
  private readonly logger = new Logger(GarageMechanicsService.name);

  constructor(
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    private readonly notifications: NotificationsService,
  ) {}

  // The owner's own row first, then the team by name; the cards of deleted
  // accounts stay out. Who may read is checked before the switch, so staff
  // and strangers never learn whether the team is on.
  async list(
    db: Pick<
      Prisma.TransactionClient,
      'booking' | 'garage' | 'garageBrand' | 'garageFeature' | 'mechanic'
    >,
    actor: Actor,
    garageId: string,
  ): Promise<GarageMechanicsDto> {
    await this.access(db, actor, garageId);
    // The team feature is on past `access`.
    const garage = await db.garage.findUniqueOrThrow({
      select: { status: true, teamOnProfile: true },
      where: { id: garageId },
    });
    const team = { ...garage, teamMechanics: true };
    const rows = await db.mechanic.findMany({
      select: CARD_SELECT,
      where: { garageId, removedAt: null },
    });
    rows.sort(
      (a, b) =>
        Number(b.isOwner) - Number(a.isOwner) ||
        byName.compare(a.name, b.name) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    const [future, brands] = await Promise.all([
      futureBookingsOf(
        db,
        rows.map((row) => row.id),
      ),
      db.garageBrand.findMany({
        select: { brand: { select: { id: true, name: true } } },
        where: { garageId, stance: 'works_on' },
      }),
    ]);
    return {
      brands: brands
        .map(({ brand }) => ({ id: brand.id, name: brand.name }))
        .sort((a, b) => byName.compare(a.name, b.name)),
      items: rows.map((row) =>
        itemOf(row, future.get(row.id) ?? 0, isShownOnProfile(row, team)),
      ),
      teamOnProfile: garage.teamOnProfile,
    };
  }

  // The owner adds a card with no account; its mechanic joins it later
  // through an invite.
  async add(
    db: PrismaClient,
    actor: Actor,
    garageId: string,
    body: unknown,
  ): Promise<GarageMechanicDto> {
    await this.access(db, actor, garageId);
    const given = ownerFields(body);
    const { errors, fields } = fieldsOf(given, true);
    await this.judgeBrands(db, garageId, fields, errors);
    if (errors.length > 0) throw refused(errors);
    const values = {
      brandIds: fields.brandIds ?? [],
      certifications: fields.certifications ?? [],
      name: fields.name as string,
      roleTitle: fields.roleTitle ?? null,
      speciality: joined(fields.specialties ?? []),
      specialties: fields.specialties ?? [],
      years: fields.years ?? null,
    };
    const row = await db.$transaction(async (tx) => {
      const created = await tx.mechanic.create({
        // A new card is off the profile until its mechanic joins.
        data: { ...values, garageId, onProfile: false },
        select: CARD_SELECT,
      });
      await this.audit.record(tx, {
        action: 'create',
        actorId: actor.accountId,
        actorRole: actor.role,
        garageId,
        newValue: { ...values, speciality: undefined },
        subjectId: created.id,
        subjectType: 'mechanic',
      });
      await this.events.record(tx, {
        audience: await cardAudienceNow(tx, garageId, created.id),
        kind: 'mechanic.added',
        payload: { garageId, mechanicId: created.id },
        subjectId: created.id,
      });
      return created;
    });
    // A new card has no account yet, so the profile never shows it.
    return itemOf(row, 0, false);
  }

  // Only the fields the patch names change, the owner's own row included; a
  // patch that changes nothing writes nothing.
  async edit(
    db: PrismaClient,
    actor: Actor,
    garageId: string,
    mechanicId: string,
    body: unknown,
  ): Promise<GarageMechanicDto> {
    await this.access(db, actor, garageId);
    const card = await cardOf(db, garageId, mechanicId);
    const given = ownerFields(body);
    const { errors, fields } = fieldsOf(given, false);
    await this.judgeBrands(db, garageId, fields, errors);
    if (errors.length > 0) throw refused(errors);
    const changed = (Object.keys(fields) as (keyof CardFields)[]).filter(
      (key) => JSON.stringify(fields[key]) !== JSON.stringify(card[key]),
    );
    if (changed.length === 0) {
      return itemOf(
        card,
        await this.futureOf(db, card.id),
        await isShownNow(db, card.id),
      );
    }
    const data: Prisma.MechanicUpdateManyMutationInput = {};
    for (const key of changed) Object.assign(data, { [key]: fields[key] });
    if (changed.includes('specialties')) {
      data.speciality = joined(fields.specialties ?? []);
    }
    const { row, shown: shownNow } = await db.$transaction(async (tx) => {
      // A remove that committed since the read leaves nothing to edit.
      const { count } = await tx.mechanic.updateMany({
        data,
        where: { id: card.id, removedAt: null },
      });
      if (count === 0) throw notFound();
      const updated = await tx.mechanic.findUniqueOrThrow({
        select: CARD_SELECT,
        where: { id: card.id },
      });
      await this.audit.recordChanges(
        tx,
        {
          actorId: actor.accountId,
          actorRole: actor.role,
          garageId,
          subjectId: card.id,
          subjectType: 'mechanic',
        },
        Object.fromEntries(
          changed.map((key) => [auditField(key), shown(card[key])]),
        ),
        Object.fromEntries(
          changed.map((key) => [auditField(key), shown(fields[key])]),
        ),
      );
      const audience = await cardAudienceNow(tx, garageId, card.id);
      await this.events.record(tx, {
        audience,
        kind: 'mechanic.updated',
        payload: { fields: changed, garageId, mechanicId: card.id },
        subjectId: card.id,
      });
      return { row: updated, shown: audience.public };
    });
    return itemOf(row, await this.futureOf(db, card.id), shownNow);
  }

  // The card leaves the team: detached from its account and off the profile,
  // kept for its reviews, jobs and bookings. The garage's open mechanic
  // invites to the account go with it, and the account is told.
  async remove(
    db: PrismaClient,
    actor: Actor,
    garageId: string,
    mechanicId: string,
  ): Promise<void> {
    await this.access(db, actor, garageId);
    const card = await cardOf(db, garageId, mechanicId);
    if (card.isOwner) {
      throw refusal(
        HttpStatus.CONFLICT,
        'owner_row',
        "The owner's own row cannot be removed",
      );
    }
    const garage = await db.$transaction(async (tx) => {
      // Whether its public pages showed it, read before it leaves.
      const audience = await cardAudienceNow(tx, garageId, card.id);
      // Two removes race to here; only the first finds the card on the team.
      const { count } = await tx.mechanic.updateMany({
        data: { accountId: null, onProfile: false, removedAt: new Date() },
        where: { id: card.id, removedAt: null },
      });
      if (count === 0) throw notFound();
      const email = card.accountId
        ? (
            await tx.account.findUniqueOrThrow({
              select: { email: true },
              where: { id: card.accountId },
            })
          ).email
        : null;
      await tx.staffInvite.updateMany({
        data: { status: 'revoked' },
        where: {
          garageId,
          kind: 'mechanic',
          OR: [
            { mechanicId: card.id },
            ...(email
              ? [{ email: { equals: email, mode: 'insensitive' as const } }]
              : []),
          ],
          status: 'sent',
        },
      });
      await this.audit.record(tx, {
        action: 'delete',
        actorId: actor.accountId,
        actorRole: actor.role,
        garageId,
        oldValue: { hasAccount: card.accountId !== null, name: card.name },
        subjectId: card.id,
        subjectType: 'mechanic',
      });
      await removeMechanicBlocks(
        tx,
        { audit: this.audit, events: this.events },
        { actorId: actor.accountId, garageId, mechanicId: card.id },
      );
      // A card the profile showed until now: its public pages hear of it.
      await this.events.record(tx, {
        audience,
        kind: 'mechanic.removed',
        payload: { garageId, mechanicId: card.id },
        subjectId: card.id,
      });
      return tx.garage.findUniqueOrThrow({
        select: { name: true },
        where: { id: garageId },
      });
    });
    if (card.accountId) await this.tellRemoved(card, garageId, garage.name);
  }

  // The removed account hears it left the team; a failure undoes nothing.
  private async tellRemoved(card: CardRow, garageId: string, garage: string) {
    try {
      await this.notifications.notify({
        eventId: `mechanic.removed:${card.id}`,
        garageId,
        kind: 'STAFF_REMOVED',
        params: { garage },
        recipients: [card.accountId as string],
        subjectId: card.id,
      });
    } catch (error) {
      this.logger.error(
        `mechanic ${card.id} account not told of its removal: ${(error as Error).message}`,
      );
    }
  }

  // Who may read or write is checked before the switch.
  async access(
    db: Pick<Prisma.TransactionClient, 'garageFeature'>,
    actor: Actor,
    garageId: string,
  ) {
    assertGarageOwner(actor, garageId);
    if (!(await featureOn(db, garageId, 'team_mechanics'))) {
      throw refusal(
        HttpStatus.NOT_FOUND,
        'feature_off',
        'This garage does not take mechanics',
      );
    }
  }

  // Each brand must be one the garage works on.
  private async judgeBrands(
    db: Pick<Prisma.TransactionClient, 'garageBrand'>,
    garageId: string,
    fields: CardFields,
    errors: FieldProblem[],
  ) {
    const ids = fields.brandIds ?? [];
    if (ids.length === 0 || errors.some((e) => e.field === 'brandIds')) return;
    const taken = await db.garageBrand.findMany({
      select: { brandId: true },
      where: {
        brandId: { in: ids.filter((id) => UUID.test(id)) },
        garageId,
        stance: 'works_on',
      },
    });
    const known = new Set(taken.map((row) => row.brandId));
    if (ids.some((id) => !known.has(id))) {
      errors.push({ code: 'not_taken', field: 'brandIds' });
    }
  }

  private async futureOf(
    db: Pick<Prisma.TransactionClient, 'booking'>,
    id: string,
  ) {
    return (await futureBookingsOf(db, [id])).get(id) ?? 0;
  }

  async saveCards(
    tx: Prisma.TransactionClient,
    garageId: string,
    actorId: string,
    section: MechanicsSection,
  ): Promise<{ ids: string[] }> {
    const ids: string[] = [];
    for (const values of cardsOf(section)) {
      ids.push(await this.create(tx, garageId, actorId, values));
    }
    // The garage is being created: no public page hears of it yet.
    const on = switchOf(section);
    if (on !== undefined) {
      await writeTeamOnProfile(
        tx,
        { actorId, actorRole: 'garage', garageId },
        on,
        { audit: this.audit },
      );
    }
    return { ids };
  }

  // Step 4 sent again over a live garage: the cards matched by name, so a
  // kept card keeps its row. A card holding an account stays even when left
  // out: it is a member of the team now.
  async saveAgain(
    tx: Prisma.TransactionClient,
    garageId: string,
    actorId: string,
    section: MechanicsSection,
  ): Promise<void> {
    const given = cardsOf(section);
    // A removed card is out of the team, and the owner's row is no card of
    // the step: neither is ever matched, kept, or deleted.
    const rows = await tx.mechanic.findMany({
      where: { garageId, isOwner: false, removedAt: null },
    });
    const change = { actorId, actorRole: 'garage' as const, garageId };
    for (const row of rows) {
      const card = given.find((values) => values.name === row.name);
      await this.settle(tx, change, row, card);
    }
    for (const values of given) {
      if (rows.some((row) => row.name === values.name)) continue;
      await this.create(tx, garageId, actorId, values);
    }
    const on = switchOf(section);
    if (on !== undefined) {
      await writeTeamOnProfile(tx, change, on, {
        audit: this.audit,
        events: this.events,
      });
    }
  }

  // One stored card against the section's card of the same name, if any.
  private async settle(
    tx: Prisma.TransactionClient,
    change: { actorId: string; actorRole: 'garage'; garageId: string },
    row: Mechanic,
    card: ReturnType<typeof cardsOf>[number] | undefined,
  ) {
    if (card) {
      const before = { speciality: row.speciality };
      const after = { speciality: card.speciality };
      if (before.speciality === after.speciality) return;
      await tx.mechanic.update({ data: after, where: { id: row.id } });
      await this.audit.recordChanges(
        tx,
        { ...change, subjectId: row.id, subjectType: 'mechanic' },
        before,
        after,
      );
      return;
    }
    if (row.accountId) return;
    await tx.mechanic.delete({ where: { id: row.id } });
    await this.audit.record(tx, {
      ...change,
      action: 'delete',
      oldValue: {
        name: row.name,
        onProfile: row.onProfile,
        speciality: row.speciality,
      },
      subjectId: row.id,
      subjectType: 'mechanic',
    });
  }

  private async create(
    tx: Prisma.TransactionClient,
    garageId: string,
    actorId: string,
    values: ReturnType<typeof cardsOf>[number],
  ) {
    const row = await tx.mechanic.create({ data: { ...values, garageId } });
    await this.audit.record(tx, {
      action: 'create',
      actorId,
      actorRole: 'garage',
      garageId,
      newValue: values,
      subjectId: row.id,
      subjectType: 'mechanic',
    });
    return row.id;
  }
}
