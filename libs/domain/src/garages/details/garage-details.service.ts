import {
  BUSINESS_KINDS,
  type DetailsSection,
  type FieldProblem,
  isRomanianPhone,
  KNOWN_FOR_MAX,
  MOBILE_LEGAL_FORMS,
  NAME_MAX,
  NAME_MIN,
  normalisePhone,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { refusal, taken } from '../../auth/sign-up.service';
import type { Prisma } from '../../generated/prisma/client';
import { uniqueSlug } from '../garage-slug';
import { plainText } from '../plain-text';

const refuse = (errors: FieldProblem[]) =>
  refusal(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'validation_failed',
    'The garage cannot be created',
    errors,
  );

const within = (text: string, min: number, max: number) =>
  text.length >= min && text.length <= max;

const isOneOf = (values: readonly string[], value: unknown) =>
  values.includes(value as string);

function phoneProblem(given: unknown) {
  const phone = plainText(given);
  if (!phone.trim()) return 'required';
  const normalised = normalisePhone(phone);
  return normalised && isRomanianPhone(normalised) ? undefined : 'romanian';
}

// The section's field errors, in the form's order.
function sectionErrors(section: DetailsSection) {
  const errors: FieldProblem[] = [];
  if (!within(plainText(section.name).trim(), NAME_MIN, NAME_MAX)) {
    errors.push({ code: 'length', field: 'name' });
  }
  const phone = phoneProblem(section.phone);
  if (phone) errors.push({ code: phone, field: 'phone' });
  // Left out is missing; given but blank or too long is the wrong length.
  if (section.knownFor === undefined) {
    errors.push({ code: 'required', field: 'knownFor' });
  } else if (!within(plainText(section.knownFor).trim(), 1, KNOWN_FOR_MAX)) {
    errors.push({ code: 'length', field: 'knownFor' });
  }
  if (!section.businessKind) {
    errors.push({ code: 'required', field: 'businessKind' });
  } else if (!isOneOf(BUSINESS_KINDS, section.businessKind)) {
    errors.push({ code: 'invalid', field: 'businessKind' });
  } else if (section.businessKind === 'mobile' && !section.mobileLegalForm) {
    errors.push({ code: 'required', field: 'mobileLegalForm' });
  }
  if (
    section.mobileLegalForm !== undefined &&
    !isOneOf(MOBILE_LEGAL_FORMS, section.mobileLegalForm)
  ) {
    errors.push({ code: 'invalid', field: 'mobileLegalForm' });
  }
  return errors;
}

// Creates the garage from step 1 when the listing is sent, inside the
// caller's transaction; a refusal writes nothing. The garage stays a draft
// and is announced to nobody until it is approved.
@Injectable()
export class GarageDetailsService {
  constructor(@Inject(AUDIT_PORT) private readonly audit: AuditPort) {}

  async create(
    tx: Prisma.TransactionClient,
    actorId: string,
    section: DetailsSection,
  ): Promise<{ id: string; slug: string }> {
    const errors = sectionErrors(section);
    if (errors.length > 0) throw refuse(errors);
    const name = (section.name as string).trim();
    const businessKind = section.businessKind as NonNullable<
      DetailsSection['businessKind']
    >;
    const slug = await uniqueSlug(name, (candidates) =>
      tx.garage
        .findMany({
          select: { slug: true },
          where: { slug: { in: candidates } },
        })
        .then((rows) => rows.map((row) => row.slug)),
    );
    if (!slug) throw refuse([{ code: 'duplicate', field: 'name' }]);
    const values = {
      businessKind,
      knownFor: (section.knownFor as string).trim(),
      mobileLegalForm:
        businessKind === 'mobile' ? (section.mobileLegalForm ?? null) : null,
      name,
      phone: normalisePhone(section.phone as string) as string,
      slug,
      status: 'draft' as const,
    };
    const garage = await tx.garage
      .create({ data: values })
      .catch((error: unknown) => {
        // A concurrent sending took the slug after it was read as free.
        if (!taken(error)) throw error;
        throw refuse([{ code: 'duplicate', field: 'name' }]);
      });
    await this.audit.record(tx, {
      action: 'create',
      actorId,
      actorRole: 'garage',
      garageId: garage.id,
      newValue: values,
      subjectId: garage.id,
      subjectType: 'garage',
    });
    return { id: garage.id, slug: values.slug };
  }
}
