import {
  MOBILE_SERVICE_RADIUS_DEFAULT_KM,
  type PublicGarageBrandDto,
  type PublicGarageDto,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

import {
  generationKey,
  NO_BRAND,
  PROFILE_SECONDS,
  profileKey,
  slugKey,
} from './public-garages.cache';
import { recordProfileCache } from './public-garages.metrics';
import { AUTH_REDIS } from '../../auth/attempts';
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

const CONTROL = /\p{Cc}/u;
const BRAND_MAX = 60;

// A brand value a catalogue slug could be; anything else reads as none.
const brandSlug = (brand: unknown) =>
  typeof brand === 'string' &&
  brand.trim() !== '' &&
  brand.length <= BRAND_MAX &&
  !CONTROL.test(brand)
    ? brand
    : undefined;

// Writes the answer only while the garage's generation is still the one the
// read saw before it went to PostgreSQL: a drop in between wins.
const WRITE = `
if (redis.call('GET', KEYS[3]) or '0') ~= ARGV[1] then return 0 end
redis.call('HSET', KEYS[1], ARGV[2], ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[4], 'NX')
redis.call('SET', KEYS[2], ARGV[5], 'EX', ARGV[4])
return 1`;

@Injectable()
export class PublicGaragesService {
  private readonly logger = new Logger('PublicGarages');
  private redisDown = false;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUTH_REDIS) private readonly redis: Redis,
  ) {}

  // A garage never approved answers exactly as a slug nobody holds.
  async bySlug(slug: string, brand?: unknown): Promise<PublicGarageDto> {
    // PostgreSQL refuses a NUL byte in text; no slug holds a control character.
    if (CONTROL.test(slug)) throw notFound();
    const wanted = brandSlug(brand);
    const cachedId = await this.cache(() => this.redis.get(slugKey(slug)));
    const cached = cachedId && (await this.cached(cachedId, wanted));
    // A slug the garage gave up still points at it until the pointer expires.
    if (cached && cached.slug === slug) {
      recordProfileCache('hit');
      return cached;
    }
    recordProfileCache('miss');
    const id =
      cachedId ??
      (
        await this.prisma.garage.findFirst({
          select: { id: true },
          where: { slug, ...publicGarages() },
        })
      )?.id;
    if (!id) return this.hidden(slug);
    const generation = await this.cache(() =>
      this.redis.get(generationKey(id)),
    );
    const answer = await this.read(slug, wanted);
    if (!answer) return this.hidden(slug);
    if (generation !== undefined && answer.id === id) {
      await this.store(slug, answer, generation ?? '0');
    }
    return answer;
  }

  private async cached(id: string, wanted: string | undefined) {
    const text = await this.cache(() =>
      this.redis.hget(profileKey(id), wanted ?? NO_BRAND),
    );
    if (!text) return undefined;
    return JSON.parse(text) as PublicGarageDto;
  }

  // Stored under the brand the answer carries: an unknown brand reads as none
  // and fills the none field, so made-up brands never grow the hash.
  private store(slug: string, answer: PublicGarageDto, generation: string) {
    return this.cache(() =>
      this.redis.eval(
        WRITE,
        3,
        profileKey(answer.id),
        slugKey(slug),
        generationKey(answer.id),
        generation,
        answer.brand ? answer.brand.slug : NO_BRAND,
        JSON.stringify(answer),
        PROFILE_SECONDS,
        answer.id,
      ),
    );
  }

  private async read(
    slug: string,
    wanted: string | undefined,
  ): Promise<PublicGarageDto | null> {
    const garage = await this.prisma.garage.findFirst({
      select: {
        address: true,
        approvedAt: true,
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
        knownFor: true,
        latitude: true,
        longitude: true,
        name: true,
        paymentCard: true,
        paymentCash: true,
        paymentTransfer: true,
        refusalPhrase: true,
        serviceRadiusKm: true,
        slug: true,
        verificationFiles: {
          orderBy: { decidedAt: 'desc' },
          select: { decidedAt: true },
          take: 1,
          where: { decidedAt: { not: null }, status: 'approved' },
        },
      },
      where: { slug, ...publicGarages() },
    });
    if (!garage) return null;
    const {
      address,
      approvedAt,
      brands,
      businessKind,
      courtesyCarPaid,
      courtesyCarPricePerDayBani,
      facilities,
      id,
      knownFor,
      latitude,
      longitude,
      name,
      paymentCard,
      paymentCash,
      paymentTransfer,
      serviceRadiusKm,
      slug: held,
      verificationFiles,
      ...texts
    } = garage;
    const verifiedAt = verificationFiles[0]?.decidedAt ?? approvedAt;
    const inContext = wanted ? await this.brand(wanted, brands) : undefined;
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
        ? {
            serviceRadiusKm:
              serviceRadiusKm ?? MOBILE_SERVICE_RADIUS_DEFAULT_KM,
          }
        : present({ address, latitude, longitude })),
      ...present({ businessKind }),
      ...(knownFor?.trim() ? { description: knownFor } : {}),
      rating: null,
      reviewCount: 0,
      verifiedAt: verifiedAt?.toISOString() ?? null,
      ...(inContext ? { brand: inContext } : {}),
    };
  }

  // Retired brands answer too: a garage may still hold one.
  private async brand(
    slug: string,
    rows: { brand: { id: string }; stance: string }[],
  ): Promise<PublicGarageBrandDto | undefined> {
    const found = await this.prisma.brand.findUnique({
      select: { id: true, name: true, slug: true },
      where: { slug },
    });
    if (!found) return undefined;
    const row = rows.find((r) => r.brand.id === found.id);
    return {
      ...found,
      stance: row?.stance === 'works_on' ? 'works_on' : 'does_not_take',
    };
  }

  private async hidden(slug: string): Promise<never> {
    const hidden = await this.prisma.garage.findUnique({
      select: { status: true },
      where: { slug },
    });
    if (hidden?.status === 'suspended') {
      throw refusal(HttpStatus.GONE, 'gone', 'This garage is no longer listed');
    }
    throw notFound();
  }

  // Redis only spares PostgreSQL a read: while it fails the answer comes from
  // PostgreSQL, and the first failure of an outage is the one logged.
  private async cache<T>(command: () => Promise<T>): Promise<T | undefined> {
    try {
      const result = await command();
      this.redisDown = false;
      return result;
    } catch (error) {
      if (!this.redisDown) {
        this.logger.warn(`garage profile cache unavailable: ${String(error)}`);
        this.redisDown = true;
      }
      return undefined;
    }
  }
}
