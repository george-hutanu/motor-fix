import type { PublicGarageDto } from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { PRISMA } from '../../auth/prisma';
import { refusal } from '../../auth/sign-up.service';
import type { PrismaClient } from '../../generated/prisma/client';
import { brandAnswerWithFuels } from '../brand-answer';

// The one scope of every read a visitor can reach: spread into the `where`
// of a garage read. A test fails when a public handler's read skips it.
export const publicGarages = () => ({ status: 'approved' as const });

const present = <T extends Record<string, unknown>>(fields: T) =>
  Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== null),
  ) as { [K in keyof T]?: NonNullable<T[K]> };

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
        address: true,
        brandNote: true,
        brands: {
          select: {
            brand: {
              select: { id: true, name: true, popularity: true, slug: true },
            },
            diesel: true,
            electric: true,
            hybrid: true,
            petrol: true,
            stance: true,
          },
        },
        businessKind: true,
        courtesyCarPaid: true,
        courtesyCarPricePerDayBani: true,
        facilities: {
          select: { facility: true },
          where: { facility: 'courtesy_car' },
        },
        id: true,
        latitude: true,
        longitude: true,
        name: true,
        paymentCard: true,
        paymentCash: true,
        paymentTransfer: true,
        refusalPhrase: true,
        serviceRadiusKm: true,
        slug: true,
      },
      where: { slug, ...publicGarages() },
    });
    if (garage) {
      const {
        address,
        brands,
        businessKind,
        courtesyCarPaid,
        courtesyCarPricePerDayBani,
        facilities,
        id,
        latitude,
        longitude,
        name,
        paymentCard,
        paymentCash,
        paymentTransfer,
        serviceRadiusKm,
        slug: held,
        ...texts
      } = garage;
      return {
        id,
        name,
        slug: held,
        ...brandAnswerWithFuels(brands, texts),
        paymentMethods: {
          card: paymentCard,
          cash: paymentCash,
          transfer: paymentTransfer,
        },
        ...(facilities.length > 0 && {
          courtesyCar: {
            paid: courtesyCarPaid,
            ...present({ pricePerDayBani: courtesyCarPricePerDayBani }),
          },
        }),
        // A mobile mechanic is shown by the area it serves: its position is
        // the owner's seat, so it never leaves with the garage.
        ...(businessKind === 'mobile'
          ? present({ serviceRadiusKm })
          : present({ address, latitude, longitude })),
      };
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
