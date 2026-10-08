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
import type { Prisma } from '../../generated/prisma/client';
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
    const errors = sectionErrors(section.mechanics);
    if (errors.length > 0) {
      throw refusal(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'validation_failed',
        'The mechanics cannot be saved',
        errors,
      );
    }
    const ids: string[] = [];
    for (const card of section.mechanics ?? []) {
      const values = {
        name: card.name.trim(),
        onProfile: section.onProfile ?? false,
        speciality: card.speciality?.trim() || null,
      };
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
      ids.push(row.id);
    }
    return { ids };
  }
}
