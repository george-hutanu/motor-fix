import {
  BUSINESS_KINDS,
  type DetailsSection,
  type FieldProblem,
  isRecord,
  isRomanianPhone,
  KNOWN_FOR_MAX,
  MOBILE_LEGAL_FORMS,
  NAME_MAX,
  NAME_MIN,
  normalisePhone,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { refusal } from '../../auth/http-refusal';
import { taken } from '../../auth/sign-up.service';
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

// The section checked and normalised as the garage stores it.
function valuesOf(section: DetailsSection) {
  if (!isRecord(section as unknown))
    throw refuse([{ code: 'invalid', field: 'section' }]);
  const errors = sectionErrors(section);
  if (errors.length > 0) throw refuse(errors);
  const businessKind = section.businessKind as NonNullable<
    DetailsSection['businessKind']
  >;
  return {
    businessKind,
    knownFor: (section.knownFor as string).trim(),
    mobileLegalForm:
      businessKind === 'mobile' ? (section.mobileLegalForm ?? null) : null,
    name: (section.name as string).trim(),
    phone: normalisePhone(section.phone as string) as string,
  };
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
    const { name, ...rest } = valuesOf(section);
    const slug = await this.slugOf(tx, name);
    const values = { ...rest, name, slug, status: 'draft' as const };
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

  // Step 1 sent again over a live garage: only the fields that differ are
  // written, one history entry each; a new name takes a new slug.
  async update(
    tx: Prisma.TransactionClient,
    actorId: string,
    garageId: string,
    section: DetailsSection,
  ): Promise<void> {
    const after = valuesOf(section);
    const garage = await tx.garage.findUniqueOrThrow({
      where: { id: garageId },
    });
    const before = {
      businessKind: garage.businessKind,
      knownFor: garage.knownFor,
      mobileLegalForm: garage.mobileLegalForm,
      name: garage.name,
      phone: garage.phone,
    };
    const changed = (Object.keys(after) as (keyof typeof after)[]).filter(
      (field) => before[field] !== after[field],
    );
    if (changed.length === 0) return;
    const slug =
      after.name === garage.name
        ? garage.slug
        : await this.slugOf(tx, after.name, garageId);
    await tx.garage
      .update({ data: { ...after, slug }, where: { id: garageId } })
      .catch((error: unknown) => {
        if (!taken(error)) throw error;
        throw refuse([{ code: 'duplicate', field: 'name' }]);
      });
    const { name, phone, knownFor, businessKind, mobileLegalForm } = after;
    await this.audit.recordChanges(
      tx,
      {
        actorId,
        actorRole: 'garage',
        garageId,
        subjectId: garageId,
        subjectType: 'garage',
      },
      before,
      { businessKind, knownFor, mobileLegalForm, name, phone },
    );
  }

  // A slug free for the name, the garage's own left out.
  private async slugOf(
    tx: Prisma.TransactionClient,
    name: string,
    garageId?: string,
  ) {
    const slug = await uniqueSlug(name, (candidates) =>
      tx.garage
        .findMany({
          select: { slug: true },
          where: {
            slug: { in: candidates },
            ...(garageId && { id: { not: garageId } }),
          },
        })
        .then((rows) => rows.map((row) => row.slug)),
    );
    if (!slug) throw refuse([{ code: 'duplicate', field: 'name' }]);
    return slug;
  }
}
