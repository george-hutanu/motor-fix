import {
  ADDRESS_MAX,
  type FieldProblem,
  inRomania,
  MOBILE_SERVICE_RADIUS_DEFAULT_KM,
  type PlaceSection,
  radiusAllowed,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { refusal } from '../../auth/sign-up.service';
import type { Prisma } from '../../generated/prisma/client';
import { plainText } from '../plain-text';

const refuse = (errors: FieldProblem[]) =>
  refusal(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'validation_failed',
    'The garage cannot be created',
    errors,
  );

const isCoordinate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function sectionErrors(section: PlaceSection) {
  const errors: FieldProblem[] = [];
  const address = plainText(section.address).trim();
  if (!address) errors.push({ code: 'required', field: 'address' });
  else if (address.length > ADDRESS_MAX)
    errors.push({ code: 'length', field: 'address' });
  const { lat, lng } = section;
  if (!isCoordinate(lat) || !isCoordinate(lng))
    errors.push({ code: 'required', field: 'location' });
  else if (!inRomania(lat, lng))
    errors.push({ code: 'romania', field: 'location' });
  if (section.radiusKm !== undefined && !radiusAllowed(section.radiusKm))
    errors.push({ code: 'range', field: 'radiusKm' });
  return errors;
}

// Writes step 5's place on the garage when the listing is sent, inside the
// caller's transaction; a refusal writes nothing. A mobile mechanic's address
// is its registered seat, kept apart from the public address.
@Injectable()
export class GaragePlaceService {
  constructor(@Inject(AUDIT_PORT) private readonly audit: AuditPort) {}

  async write(
    tx: Prisma.TransactionClient,
    actorId: string,
    garageId: string,
    section: PlaceSection,
  ): Promise<void> {
    const { businessKind, latitude, longitude, ...held } =
      await tx.garage.findUniqueOrThrow({
        select: {
          address: true,
          businessKind: true,
          latitude: true,
          longitude: true,
          seatAddress: true,
          serviceRadiusKm: true,
        },
        where: { id: garageId },
      });
    const mobile = businessKind === 'mobile';
    const errors = sectionErrors(section);
    if (errors.length > 0) throw refuse(errors);
    const address = plainText(section.address).trim();
    const lat = section.lat as number;
    const lng = section.lng as number;
    const serviceRadiusKm = mobile
      ? (section.radiusKm ?? MOBILE_SERVICE_RADIUS_DEFAULT_KM)
      : null;
    await tx.garage.update({
      data: {
        address: mobile ? null : address,
        latitude: lat,
        longitude: lng,
        seatAddress: mobile ? address : null,
        serviceRadiusKm,
      },
      where: { id: garageId },
    });
    await this.audit.recordChanges(
      tx,
      {
        actorId,
        actorRole: 'garage',
        garageId,
        subjectId: garageId,
        subjectType: 'garage',
      },
      {
        ...held,
        location: latitude === null ? null : { lat: latitude, lng: longitude },
      },
      mobile
        ? { location: { lat, lng }, seatAddress: address, serviceRadiusKm }
        : { address, location: { lat, lng } },
    );
  }
}
