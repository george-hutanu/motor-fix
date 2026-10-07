import type { PublicGarageDto } from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { brandAnswer } from './brand-answer';
import { PRISMA } from '../auth/prisma';
import { refusal } from '../auth/sign-up.service';
import type { PrismaClient } from '../generated/prisma/client';

// The one scope of every read a visitor can reach: spread into the `where`
// of a garage read. A test fails when a public handler's read skips it.
export const publicGarages = () => ({ status: 'approved' as const });

const notFound = () => refusal(HttpStatus.NOT_FOUND, 'not_found', 'Not found');

@Injectable()
export class PublicGaragesService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  // A garage never approved answers exactly as a slug nobody holds.
  async bySlug(slug: string): Promise<PublicGarageDto> {
    // PostgreSQL refuses a NUL byte in text; no slug holds a control character.
    if (/\p{Cc}/u.test(slug)) throw notFound();
    const garage = await this.prisma.garage.findFirst({
      select: {
        brandNote: true,
        brands: {
          select: {
            brand: {
              select: { id: true, name: true, popularity: true, slug: true },
            },
            stance: true,
          },
        },
        id: true,
        name: true,
        refusalPhrase: true,
        slug: true,
      },
      where: { slug, ...publicGarages() },
    });
    if (garage) {
      const { brands, id, name, slug: held, ...texts } = garage;
      return { id, name, slug: held, ...brandAnswer(brands, texts) };
    }
    const hidden = await this.prisma.garage.findUnique({
      select: { status: true },
      where: { slug },
    });
    if (hidden?.status === 'suspended') {
      throw refusal(HttpStatus.GONE, 'gone', 'This garage is no longer listed');
    }
    throw notFound();
  }
}
