import {
  type FieldProblem,
  type GarageMechanicsDto,
  MECHANIC_NAME_MAX,
  MECHANIC_NAME_MIN,
  MECHANICS_MAX,
  type MechanicsSection,
  SPECIALITY_MAX,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { refusal } from '../../auth/http-refusal';
import type { Actor } from '../../auth/policy';
import type { Mechanic, Prisma } from '../../generated/prisma/client';
import { featureOn } from '../features/feature-on';
import { assertGarageOwner } from '../garage-brands/garage-brands.service';
import { isRecord, plainText } from '../plain-text';

const byName = new Intl.Collator('ro', { sensitivity: 'base' });

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
  return (section.mechanics ?? []).map((card) => ({
    name: card.name.trim(),
    onProfile: section.onProfile ?? false,
    speciality: card.speciality?.trim() || null,
  }));
}

// The garage's mechanic cards: saved from step 4 when the listing is sent,
// inside the caller's transaction (a refusal writes nothing), and read back
// for the owner's team list. A card has no account until its mechanic
// accepts an invite.
@Injectable()
export class GarageMechanicsService {
  constructor(@Inject(AUDIT_PORT) private readonly audit: AuditPort) {}

  // The owner's own card stays out (the owner is not "the team"), and so do
  // the cards of deleted accounts. Who may read is checked before the switch,
  // so staff and strangers never learn whether the team is on.
  async list(
    db: Pick<Prisma.TransactionClient, 'garageFeature' | 'mechanic'>,
    actor: Actor,
    garageId: string,
  ): Promise<GarageMechanicsDto> {
    assertGarageOwner(actor, garageId);
    if (!(await featureOn(db, garageId, 'team_mechanics'))) {
      throw refusal(
        HttpStatus.NOT_FOUND,
        'feature_off',
        'This garage does not take mechanics',
      );
    }
    const rows = await db.mechanic.findMany({
      select: {
        accountId: true,
        id: true,
        name: true,
        onProfile: true,
        rating: true,
        reviewCount: true,
        speciality: true,
      },
      // A plain NOT on the nullable column would drop the account-less cards.
      where: {
        garageId,
        OR: [{ accountId: null }, { accountId: { not: actor.accountId } }],
        removedAt: null,
      },
    });
    rows.sort(
      (a, b) =>
        byName.compare(a.name, b.name) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    return {
      items: rows.map(({ accountId, rating, ...row }) => ({
        ...row,
        hasAccount: accountId !== null,
        rating: rating === null ? null : rating.toFixed(1),
      })),
    };
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
    // A removed card is out of the team: never matched, kept, or deleted.
    const rows = await tx.mechanic.findMany({
      where: { garageId, removedAt: null },
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
  }

  // One stored card against the section's card of the same name, if any.
  private async settle(
    tx: Prisma.TransactionClient,
    change: { actorId: string; actorRole: 'garage'; garageId: string },
    row: Mechanic,
    card: ReturnType<typeof cardsOf>[number] | undefined,
  ) {
    if (card) {
      const before = { onProfile: row.onProfile, speciality: row.speciality };
      const after = { onProfile: card.onProfile, speciality: card.speciality };
      if (JSON.stringify(before) === JSON.stringify(after)) return;
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
