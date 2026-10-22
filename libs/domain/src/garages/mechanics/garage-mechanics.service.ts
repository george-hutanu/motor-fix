import {
  type FieldProblem,
  MECHANIC_NAME_MAX,
  MECHANIC_NAME_MIN,
  MECHANICS_MAX,
  type MechanicsSection,
  SPECIALITY_MAX,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { refusal } from '../../auth/sign-up.service';
import type { Mechanic, Prisma } from '../../generated/prisma/client';
import { isRecord, plainText } from '../plain-text';

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
  const errors = sectionErrors(section.mechanics);
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

// Saves the step-4 mechanic cards when the listing is sent, inside the
// caller's transaction; a refusal writes nothing. A card has no account
// until the mechanic is invited (another story).
@Injectable()
export class GarageMechanicsService {
  constructor(@Inject(AUDIT_PORT) private readonly audit: AuditPort) {}

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
    const rows = await tx.mechanic.findMany({ where: { garageId } });
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
