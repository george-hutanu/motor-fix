import {
  MOBILE_SERVICE_RADIUS_DEFAULT_KM,
  PUBLIC_IMAGE_URL_MINUTES,
  type PublicGarageBrandDto,
  type PublicGarageDto,
  type PublicGaragePhotoDto,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';

import { PRISMA } from '../../auth/prisma';
import { refusal } from '../../auth/sign-up.service';
import { CacheService, cacheKey, type Filled } from '../../cache/cache.service';
import type { PrismaClient } from '../../generated/prisma/client';
import { responseRateOf } from '../../insights/response-stats/response-stats';
import { StorageService } from '../../storage/storage.service';
import { brandAnswerWithFuels } from '../brand-answer';
import {
  PRICE_ROW_SELECT,
  type PriceRow,
  priceListJobs,
  publicPriceRows,
} from '../price-list/price-list';

// The one scope of every read a visitor can reach: spread into the `where`
// of a garage read. A test fails when a public handler's read skips it.
export const publicGarages = () => ({ status: 'approved' as const });

const present = <T extends Record<string, unknown>>(fields: T) =>
  Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== null),
  ) as { [K in keyof T]?: NonNullable<T[K]> };

const notFound = () => refusal(HttpStatus.NOT_FOUND, 'not_found', 'Not found');

// A profile entry lives ten minutes before it is refreshed.
const PROFILE_SECONDS = 600;
const NO_BRAND = '-';

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

type CatalogueBrand = Pick<PublicGarageBrandDto, 'id' | 'name' | 'slug'>;

// The brand in context and whether the garage works on it.
const inContextOf = (
  held: CatalogueBrand,
  rows: { brand: { id: string }; stance: string }[],
): PublicGarageBrandDto => ({
  ...held,
  stance:
    rows.find((r) => r.brand.id === held.id)?.stance === 'works_on'
      ? 'works_on'
      : 'does_not_take',
});

// What the profile shows of the price list: the jobs a request can ask for,
// the labour rate when both ends are set, and each public job's range for the
// brand in context, its own only while the garage takes it, listed as the
// garage ticked them for it.
function priceListOf(
  brands: {
    brand: { id: string };
    jobs: { jobTypeId: string }[];
    stance: string;
  }[],
  labourFromBani: number | null,
  labourToBani: number | null,
  prices: PriceRow[],
  rarActivities: string[],
  brandId: string | undefined,
): Pick<PublicGarageDto, 'jobTypes' | 'labour' | 'prices'> {
  const held = brands.find((row) => row.brand.id === brandId);
  const ticks = held?.jobs.map((job) => job.jobTypeId) ?? [];
  const jobs = priceListJobs(prices, rarActivities);
  return {
    jobTypes: jobs
      .filter((job) => job.public)
      .map(({ jobTypeId, nameEn, nameRo }) => ({
        id: jobTypeId,
        nameEn,
        nameRo,
      })),
    ...(labourFromBani !== null &&
      labourToBani !== null && {
        labour: { fromBani: labourFromBani, toBani: labourToBani },
      }),
    prices: publicPriceRows(
      prices,
      jobs,
      brandId === undefined
        ? undefined
        : { id: brandId, refused: held?.stance !== 'works_on', ticks },
    ),
  };
}

@Injectable()
export class PublicGaragesService {
  private readonly logger = new Logger('PublicGarages');
  private storageDown = false;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly cache: CacheService,
    private readonly storage: StorageService,
  ) {}

  // A garage never approved answers exactly as a slug nobody holds.
  async bySlug(slug: string, brand?: unknown): Promise<PublicGarageDto> {
    // PostgreSQL refuses a NUL byte in text; no slug holds a control character.
    if (CONTROL.test(slug)) throw notFound();
    const wanted = brandSlug(brand);
    const held = wanted ? await this.held(wanted) : null;
    const answer = await this.cache.read<PublicGarageDto | null>({
      key: cacheKey('profile', slug, held?.slug ?? NO_BRAND),
      read: () => this.fill(slug, held),
      soft: PROFILE_SECONDS,
    });
    if (!answer) throw notFound();
    return answer;
  }

  // The catalogue brand a slug names, retired ones too, read through the
  // cache: a brand nobody holds is remembered 60 seconds as none, so its
  // profile reads find the no-brand entry and never grow the cache.
  private held(slug: string) {
    return this.cache.read<CatalogueBrand | null>({
      key: cacheKey('brands', slug),
      read: async () => {
        const found = await this.prisma.brand.findUnique({
          select: { id: true, name: true, slug: true },
          where: { slug },
        });
        return found ? { value: found } : { negative: true, value: null };
      },
      soft: PROFILE_SECONDS,
    });
  }

  // A slug nobody holds is remembered as not found; a garage not listed is
  // refused uncached, so its approval or its restore shows on the next read.
  private async fill(
    slug: string,
    held: CatalogueBrand | null,
  ): Promise<Filled<PublicGarageDto | null>> {
    const answer = await this.read(slug, held);
    if (answer) return { tags: [`garage:${answer.id}`], value: answer };
    const hidden = await this.prisma.garage.findUnique({
      select: { status: true },
      where: { slug },
    });
    if (hidden?.status === 'suspended') {
      throw refusal(HttpStatus.GONE, 'gone', 'This garage is no longer listed');
    }
    if (hidden) throw notFound();
    return { negative: true, value: null };
  }

  private async read(
    slug: string,
    wanted: CatalogueBrand | null,
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
            jobs: { select: { jobTypeId: true } },
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
        labourFromBani: true,
        labourToBani: true,
        latitude: true,
        longitude: true,
        name: true,
        paymentCard: true,
        paymentCash: true,
        paymentTransfer: true,
        photos: {
          orderBy: { position: 'asc' },
          select: { fileKey: true, height: true, id: true, width: true },
        },
        // The jobs a request from the profile can ask for: the public ones
        // of the price list, as the price list rule decides.
        prices: { select: PRICE_ROW_SELECT },
        rarActivities: true,
        rating: true,
        refusalPhrase: true,
        responseStats: { select: { lifetimeRequests: true, rate: true } },
        reviewCount: true,
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
      labourFromBani,
      labourToBani,
      latitude,
      longitude,
      name,
      paymentCard,
      paymentCash,
      paymentTransfer,
      photos,
      prices,
      rarActivities,
      rating,
      responseStats,
      reviewCount,
      serviceRadiusKm,
      slug: held,
      verificationFiles,
      ...texts
    } = garage;
    const verifiedAt = verificationFiles[0]?.decidedAt ?? approvedAt;
    const inContext = wanted ? inContextOf(wanted, brands) : undefined;
    return {
      id,
      name,
      slug: held,
      ...brandAnswerWithFuels(brands, texts),
      ...priceListOf(
        brands,
        labourFromBani,
        labourToBani,
        prices,
        rarActivities,
        inContext?.id,
      ),
      paymentMethods: {
        card: paymentCard,
        cash: paymentCash,
        transfer: paymentTransfer,
      },
      photos: await this.photos(photos),
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
      rating: rating === null ? null : rating.toNumber(),
      responseRate: responseRateOf(responseStats),
      reviewCount,
      verifiedAt: verifiedAt?.toISOString() ?? null,
      ...(inContext ? { brand: inContext } : {}),
    };
  }

  // A row the worker has sized has its copies. An unsized one is asked of its
  // thumbnail, which also carries the size; without one it is not ready yet.
  // The admin's verification file signs the gallery the same way.
  async photos(
    rows: {
      fileKey: string;
      height: number | null;
      id: string;
      width: number | null;
    }[],
  ): Promise<PublicGaragePhotoDto[]> {
    const answered = await Promise.all(
      rows.map(async ({ fileKey, id, ...size }) => {
        const thumb = this.storage.derivedKey(fileKey, 'thumb');
        let { height, width } = size;
        if (width === null) {
          const meta = await this.storage.metadataOf(thumb).then(
            (found) => {
              this.storageDown = false;
              return found;
            },
            (error) => {
              if (!this.storageDown) {
                this.logger.warn(`photo copies unreadable: ${String(error)}`);
                this.storageDown = true;
              }
              return null;
            },
          );
          if (!meta) return null;
          width = Number(meta['width']) || null;
          height = Number(meta['height']) || null;
        }
        const [thumbnailUrl, displayUrl] = await Promise.all(
          [thumb, this.storage.derivedKey(fileKey, 'display')].map((key) =>
            this.storage.createDownloadUrl(
              key,
              undefined,
              'inline',
              PUBLIC_IMAGE_URL_MINUTES,
            ),
          ),
        );
        return { displayUrl, id, thumbnailUrl, ...present({ height, width }) };
      }),
    );
    return answered.filter((photo) => photo !== null);
  }
}
