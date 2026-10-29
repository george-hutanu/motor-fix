import type { GarageProfileDto } from '@motor-fix/contracts';
import { capabilitiesOf } from '@motor-fix/contracts/capabilities';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { refusal } from '../../auth/http-refusal';
import { type Actor, assertGarage } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import type { PrismaClient } from '../../generated/prisma/client';
import { notFound } from '../garage-brands/garage-brands.service';
import { PublicGaragesService } from '../public-garages/public-garages';

@Injectable()
export class GarageProfileService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly publicGarages: PublicGaragesService,
  ) {}

  // Anyone outside the garage is told there is no such garage; its staff
  // without the profile capability are told no, before the garage's own
  // state is given away. The answer is the public one, read through its
  // cache, with the stored phone and the change stamp added after the read
  // so neither enters the cache.
  async read(actor: Actor, garageId: string): Promise<GarageProfileDto> {
    assertGarage(actor, garageId);
    if (
      !capabilitiesOf(actor.role, actor.permissions).includes('garage.profile')
    ) {
      throw refusal(
        HttpStatus.FORBIDDEN,
        'forbidden',
        "Your role does not read the garage's profile",
      );
    }
    return this.answer(garageId);
  }

  // The answer alone, for a caller that has checked the actor; `fresh` reads
  // past the public cache, so a save answers what it just wrote.
  async answer(garageId: string, fresh = false): Promise<GarageProfileDto> {
    const row = await this.prisma.garage.findUnique({
      select: { phone: true, profileVersion: true, slug: true },
      where: { id: garageId },
    });
    if (!row) throw notFound();
    const answer = fresh
      ? await this.publicGarages.fresh(row.slug)
      : await this.publicGarages.bySlug(row.slug);
    return {
      ...answer,
      phone: row.phone,
      version: String(row.profileVersion),
    };
  }
}
