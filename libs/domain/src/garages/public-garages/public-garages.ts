import {
  MOBILE_SERVICE_RADIUS_DEFAULT_KM,
  PUBLIC_IMAGE_URL_MINUTES,
  type PublicGarageBrandDto,
  type PublicGarageDto,
  type PublicGaragePhotoDto,
} from '@motor-fix/contracts';
import type { SearchPoint } from '@motor-fix/contracts/search-place';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';

import { PRISMA } from '../../auth/prisma';
import { refusal } from '../../auth/sign-up.service';
import { CacheService, cacheKey, type Filled } from '../../cache/cache.service';
import {
  type BusinessKind,
  type GarageBrandStance,
  Prisma,
  type PrismaClient,
} from '../../generated/prisma/client';
import { responseRateOf } from '../../insights/response-stats/response-stats';
import { areaSql, kmOf } from '../../search/area/area-sql';
import { StorageService } from '../../storage/storage.service';
import { brandAnswerWithFuels } from '../brand-answer';
import {
  type PriceRow,
  priceListJobs,
  publicPriceRows,
} from '../price-list/price-list';

// The one scope of every read a visitor or driver can reach: spread into the
// `where` of a Prisma garage read, or put in the `WHERE` of a raw one under
// the alias the query gives `garage`. A test fails when such a read skips it.
// The alias is spliced as written: pass a literal, never a value.
export const publicGarages = () => ({ status: 'approved' as const });
export const publicGaragesSql = (alias = 'garage') =>
  Prisma.sql`${Prisma.raw(alias)}.status = 'approved'`;

type BrandRow = {
  brand: { id: string; name: string; popularity: number | null; slug: string };
  diesel: boolean;
  electric: boolean;
  hybrid: boolean;
  jobs: { jobTypeId: string }[];
  petrol: boolean;
  stance: GarageBrandStance;
};

type PhotoRow = {
  fileKey: string;
  height: number | null;
  id: string;
  width: number | null;
};

// What the profile's one statement returns; `brands`, `photos` and `prices`
// are null for a garage not listed, whose row only tells 404 from 410.
type ProfileRow = {
  address: string | null;
  approved_at: Date | null;
  brand_note: string | null;
  brands: BrandRow[] | null;
  business_kind: BusinessKind | null;
  courtesy_car: boolean;
  courtesy_car_paid: boolean;
  courtesy_car_price_per_day_bani: number | null;
  id: string;
  known_for: string | null;
  labour_from_bani: number | null;
  labour_to_bani: number | null;
  last_checked_on: string | null;
  latitude: number | null;
  lifetime_requests: number | null;
  listed: boolean;
  longitude: number | null;
  name: string;
  payment_card: boolean;
  payment_cash: boolean;
  payment_transfer: boolean;
  photos: PhotoRow[] | null;
  // JSON carries the time as text.
  prices: (Omit<PriceRow, 'updatedAt'> & { updatedAt: string })[] | null;
  rar_activities: string[];
  rate: number | null;
  rating: number | null;
  refusal_phrase: string | null;
  review_count: number;
  service_radius_km: number | null;
  slug: string;
  status: string;
};

const present = <T extends Record<string, unknown>>(fields: T) =>
  Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== null),
  ) as { [K in keyof T]?: NonNullable<T[K]> };

const notFound = () => refusal(HttpStatus.NOT_FOUND, 'not_found', 'Not found');

// A profile entry lives ten minutes before it is refreshed.
const PROFILE_SECONDS = 600;
export const NO_BRAND = '-';

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

// The courtesy car, when the garage lists one.
const courtesyCarOf = (row: ProfileRow) =>
  row.courtesy_car
    ? {
        courtesyCar: {
          paid: row.courtesy_car_paid,
          ...present({ pricePerDayBani: row.courtesy_car_price_per_day_bani }),
        },
      }
    : {};

// A mobile mechanic is shown by the area it serves: its position is the
// owner's seat, so it never leaves with the garage.
const placeOf = (row: ProfileRow) =>
  row.business_kind === 'mobile'
    ? {
        serviceRadiusKm:
          row.service_radius_km ?? MOBILE_SERVICE_RADIUS_DEFAULT_KM,
      }
    : present({
        address: row.address,
        latitude: row.latitude,
        longitude: row.longitude,
      });

@Injectable()
export class PublicGaragesService {
  private readonly logger = new Logger('PublicGarages');
  private storageDown = false;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly cache: CacheService,
    private readonly storage: StorageService,
  ) {}

  // A garage never approved answers exactly as a slug nobody holds. The
  // distance from a place is added to the cached answer per read, so the
  // entry never holds a distance or the place it was measured from.
  async bySlug(
    slug: string,
    brand?: unknown,
    point?: SearchPoint,
  ): Promise<PublicGarageDto> {
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
    // A mobile mechanic is shown by its area, never by how far its seat is.
    if (!point || answer.businessKind === 'mobile') return answer;
    const distanceKm = await this.distanceKm(answer.id, point);
    return distanceKm === undefined ? answer : { ...answer, distanceKm };
  }

  // Kilometres from the place to a listed garage, on the search's rule;
  // none for a garage without a position.
  private async distanceKm(id: string, point: SearchPoint) {
    const area = areaSql({ point });
    const [row] = await this.prisma.$queryRaw<{ metres: number | null }[]>`
      SELECT ${area.distance} AS metres
      FROM garage
      WHERE garage.id = ${id}::uuid AND ${publicGaragesSql()}`;
    return typeof row?.metres === 'number' ? kmOf(row.metres) : undefined;
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
    const row = await this.read(slug);
    if (!row) return { negative: true, value: null };
    if (row.listed) {
      return {
        tags: [`garage:${row.id}`],
        value: await this.answerOf(row, held),
      };
    }
    if (row.status === 'suspended') {
      throw refusal(HttpStatus.GONE, 'gone', 'This garage is no longer listed');
    }
    throw notFound();
  }

  // The whole profile in one statement: the garage, its brands with their
  // fuels and job ticks, photos, price rows, courtesy car, response figures
  // and day of last check. Outside the scope only the status comes back.
  private async read(slug: string): Promise<ProfileRow | undefined> {
    const [row] = await this.prisma.$queryRaw<ProfileRow[]>`
      SELECT g.id, g.slug, g.name, g.status::text AS status, s.listed,
        g.address, g.approved_at, g.brand_note, g.refusal_phrase,
        g.business_kind::text AS business_kind, g.courtesy_car_paid,
        g.courtesy_car_price_per_day_bani, g.known_for, g.labour_from_bani,
        g.labour_to_bani, g.latitude, g.longitude, g.payment_card,
        g.payment_cash, g.payment_transfer, g.rar_activities,
        g.rating::float8 AS rating, g.review_count, g.service_radius_km,
        rs.lifetime_requests, rs.rate,
        EXISTS (
          SELECT 1 FROM garage_facility f
          WHERE f.garage_id = g.id AND f.facility = 'courtesy_car'
        ) AS courtesy_car,
        to_char(g.last_checked_on, 'YYYY-MM-DD') AS last_checked_on,
        d.brands, d.photos, d.prices
      FROM garage g
      CROSS JOIN LATERAL (SELECT ${publicGaragesSql('g')} AS listed) s
      LEFT JOIN garage_response_stats rs ON rs.garage_id = g.id
      LEFT JOIN LATERAL (
        SELECT
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'brand', jsonb_build_object('id', b.id, 'name', b.name,
                'popularity', b.popularity, 'slug', b.slug),
              'diesel', gb.diesel, 'electric', gb.electric,
              'hybrid', gb.hybrid, 'petrol', gb.petrol,
              'stance', gb.stance::text,
              'jobs', COALESCE((
                SELECT jsonb_agg(jsonb_build_object('jobTypeId', j.job_type_id)
                  ORDER BY j.job_type_id)
                FROM garage_brand_job j
                WHERE j.garage_id = gb.garage_id AND j.brand_id = gb.brand_id
              ), '[]'::jsonb)
            ) ORDER BY b.popularity NULLS LAST, b.name, b.id)
            FROM garage_brand gb JOIN brand b ON b.id = gb.brand_id
            WHERE gb.garage_id = g.id
          ), '[]'::jsonb) AS brands,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object('fileKey', ph.file_key,
              'height', ph.height, 'id', ph.id, 'width', ph.width)
              ORDER BY ph.position, ph.id)
            FROM garage_photo ph WHERE ph.garage_id = g.id
          ), '[]'::jsonb) AS photos,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', p.id, 'brandId', p.brand_id,
              'brand', CASE WHEN pb.id IS NULL THEN NULL ELSE
                jsonb_build_object('name', pb.name, 'popularity', pb.popularity)
              END,
              'visible', p.visible, 'fromBani', p.from_bani,
              'toBani', p.to_bani, 'durationMinutes', p.duration_minutes,
              'position', p.position, 'updatedAt', p.updated_at,
              'jobType', jsonb_build_object('id', jt.id,
                'nameRo', jt.name_ro, 'nameEn', jt.name_en,
                'status', jt.status::text, 'rarActivity', jt.rar_activity)
            ) ORDER BY p.position, p.id)
            FROM garage_price p
            JOIN job_type jt ON jt.id = p.job_type_id
            LEFT JOIN brand pb ON pb.id = p.brand_id
            WHERE p.garage_id = g.id
          ), '[]'::jsonb) AS prices
        WHERE s.listed
      ) d ON TRUE
      WHERE g.slug = ${slug}`;
    return row;
  }

  private async answerOf(
    row: ProfileRow,
    wanted: CatalogueBrand | null,
  ): Promise<PublicGarageDto> {
    const brands = row.brands ?? [];
    const prices: PriceRow[] = (row.prices ?? []).map((price) => ({
      ...price,
      updatedAt: new Date(price.updatedAt),
    }));
    // A stored day parses as its UTC midnight, the same day in Bucharest.
    const verifiedAt = row.last_checked_on
      ? new Date(row.last_checked_on)
      : row.approved_at;
    const inContext = wanted ? inContextOf(wanted, brands) : undefined;
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      ...brandAnswerWithFuels(brands, {
        brandNote: row.brand_note,
        refusalPhrase: row.refusal_phrase,
      }),
      ...priceListOf(
        brands,
        row.labour_from_bani,
        row.labour_to_bani,
        prices,
        row.rar_activities,
        inContext?.id,
      ),
      paymentMethods: {
        card: row.payment_card,
        cash: row.payment_cash,
        transfer: row.payment_transfer,
      },
      photos: await this.photos(row.photos ?? []),
      ...courtesyCarOf(row),
      ...placeOf(row),
      ...present({ businessKind: row.business_kind }),
      ...(row.known_for?.trim() ? { description: row.known_for } : {}),
      rating: row.rating,
      responseRate: responseRateOf(
        row.lifetime_requests === null
          ? null
          : { lifetimeRequests: row.lifetime_requests, rate: row.rate },
      ),
      reviewCount: row.review_count,
      verifiedAt: verifiedAt?.toISOString() ?? null,
      ...(inContext ? { brand: inContext } : {}),
    };
  }

  // A row the worker has sized has its copies. An unsized one is asked of its
  // thumbnail, which also carries the size; without one it is not ready yet.
  // The admin's verification file signs the gallery the same way.
  async photos(rows: PhotoRow[]): Promise<PublicGaragePhotoDto[]> {
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
