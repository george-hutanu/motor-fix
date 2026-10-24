import type { GarageProfileDto } from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { capabilitiesOf } from '../../auth/capabilities';
import { type Actor, assertGarage } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { refusal } from '../../auth/sign-up.service';
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
  // cache, with the stored phone added after the read so it never enters
  // the cache.
  async read(actor: Actor, garageId: string): Promise<GarageProfileDto> {
    assertGarage(actor, garageId);
    if (
      !capabilitiesOf(actor.role, actor.permissions).includes('garage.profile')
    ) {
      throw refusal(
        HttpStatus.FORBIDDEN,
        'forbidden',
        "Only the owner reads the garage's profile",
      );
    }
    const row = await this.prisma.garage.findUnique({
      select: { phone: true, slug: true },
      where: { id: garageId },
    });
    if (!row) throw notFound();
    const answer = await this.publicGarages.bySlug(row.slug);
    return { ...answer, phone: row.phone };
  }
}
