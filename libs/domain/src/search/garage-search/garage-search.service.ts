import {
  bboxOf,
  FACILITIES,
  type GarageSearchPageDto,
  type ListedGarageDto,
  nearOf,
  SEARCH_IDS_MAX,
  type SearchBbox,
  type SearchPoint,
} from '@motor-fix/contracts';
import { MOBILE_SERVICE_RADIUS_DEFAULT_KM } from '@motor-fix/contracts/place-section';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { GarageSearchCache } from './garage-search.cache';
import { PRISMA } from '../../auth/prisma';
import { refusal } from '../../auth/sign-up.service';
import { brandAnswer } from '../../garages/brand-answer';
import {
  publicGarages,
  publicGaragesSql,
} from '../../garages/public-garages/public-garages';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import { countSearch } from '../../metrics/product-counters';
import { type AreaSql, areaSql, within } from '../area/area-sql';
import { type AreaRow, inAreaOf, placed } from '../area/search-area';
import { SearchLogService } from '../search-log/search-log.service';

const PAGE = SEARCH_IDS_MAX;
const GROUPS = ['works_on', 'other'] as const;

// Unsigned on purpose: it only says where the next page starts, and a
// tampered one is refused or reads a page the visitor could read anyway.
// It carries the last garage's id, not its name: a name has no length limit
// and the query caps the cursor at 256 characters. It carries the rating and
// review count the last garage had when its page was answered, so a review
// landing between two pages moves no page boundary. A page of a box names
// the box, so it never pages on another box or the search around the place.
interface Cursor {
  b: string;
  c: number;
  g: (typeof GROUPS)[number];
  i: string;
  r: string | null;
  x?: string;
}

interface After extends Cursor {
  name: string;
}

// Every garage after the boundary in the order of a group.
function beyond({ c, i, name, r }: After): Prisma.Sql {
  const later = Prisma.sql`(garage.name > ${name}
    OR (garage.name = ${name} AND garage.id > ${i}::uuid))`;
  if (r === null) return Prisma.sql`garage.rating IS NULL AND ${later}`;
  return Prisma.sql`(garage.rating IS NULL
    OR garage.rating < ${r}::numeric
    OR (garage.rating = ${r}::numeric AND garage.review_count < ${c})
    OR (garage.rating = ${r}::numeric AND garage.review_count = ${c}
      AND ${later}))`;
}

// A rating as the garage table holds it: 1.0 to 5.0, one decimal.
const RATING = /^(?:[1-4]\.\d|5\.0)$/;
// review_count is a PostgreSQL integer.
const INT4_MAX = 2_147_483_647;

const invalidCursor = () =>
  refusal(
    HttpStatus.BAD_REQUEST,
    'invalid_cursor',
    'cursor is not a page of this search',
  );

function decode(cursor: string, brandId: string, box?: string): Cursor {
  let parsed: Partial<Cursor>;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString());
  } catch {
    throw invalidCursor();
  }
  const { b, c, g, i, r, x } = parsed ?? {};
  if (
    b !== brandId ||
    !GROUPS.includes(g as Cursor['g']) ||
    !isUUID(i) ||
    x !== box ||
    !(r === null || (typeof r === 'string' && RATING.test(r))) ||
    !Number.isSafeInteger(c) ||
    (c as number) < 0 ||
    (c as number) > INT4_MAX
  ) {
    throw invalidCursor();
  }
  return parsed as Cursor;
}

// Where the page after the one ending on `last` starts.
const cursorAfter = (
  brandId: string,
  last: ListedGarageDto,
  box: string | undefined,
) =>
  Buffer.from(
    JSON.stringify({
      b: brandId,
      c: last.reviewCount,
      g: last.stance === 'works_on' ? 'works_on' : 'other',
      i: last.id,
      r: last.rating === null ? null : last.rating.toFixed(1),
      ...(box && { x: box }),
    } satisfies Cursor),
  ).toString('base64url');

// The brand by its catalogue id, or by its slug as the address bar holds it.
export type BrandKey = string | { slug: string };

export async function brandOf(prisma: PrismaClient, key: BrandKey) {
  const brand = await prisma.brand.findUnique({
    select: { id: true, name: true, slug: true },
    where: typeof key === 'string' ? { id: key } : key,
  });
  if (!brand) throw refusal(HttpStatus.NOT_FOUND, 'not_found', 'Not found');
  return brand;
}

export type Group = (typeof GROUPS)[number];

// The garages that take the brand; the rest of a search is the other group.
const takes = (brandId: string) => Prisma.sql`EXISTS (
  SELECT 1 FROM garage_brand gb
  WHERE gb.garage_id = garage.id AND gb.brand_id = ${brandId}::uuid
    AND gb.stance = 'works_on')`;

// The public garages of each group, in the area when there is one: the
// counts and total of a search, in one statement.
export async function countGroups(
  prisma: PrismaClient,
  brandId: string,
  area?: AreaSql,
) {
  const [row] = await prisma.$queryRaw<{ other: number; works_on: number }[]>`
    SELECT
      COUNT(*) FILTER (WHERE ${takes(brandId)})::int AS works_on,
      COUNT(*) FILTER (WHERE NOT ${takes(brandId)})::int AS other
    FROM garage
    WHERE ${publicGaragesSql()} AND ${within(area)}`;
  return {
    counts: { doesNotTake: row.other, worksOn: row.works_on },
    total: row.works_on + row.other,
  };
}

// A group's public garages in its order: rating high to low with the
// unrated last, more reviews first, then name and id (an unrated garage has
// no reviews, garage_rating_reviewed). In the area when there is one, after
// the boundary or among the ids when given; each with its place in the area.
// garage_list_order_idx holds the order of the approved garages, so a page
// with no area reads the index instead of sorting every garage.
export function groupPageSql(
  brandId: string,
  group: Group,
  area: AreaSql | undefined,
  { after, ids, take }: GroupPageOptions,
) {
  return Prisma.sql`
    SELECT
      garage.id,
      ${area ? area.distance : Prisma.sql`NULL::float8`} AS distance_m,
      garage.latitude,
      garage.longitude,
      garage.business_kind IS NOT DISTINCT FROM 'mobile' AS mobile
    FROM garage
    WHERE ${publicGaragesSql()} AND ${within(area)}
      AND ${group === 'works_on' ? takes(brandId) : Prisma.sql`NOT ${takes(brandId)}`}
      ${after ? Prisma.sql`AND ${beyond(after)}` : Prisma.empty}
      ${ids ? Prisma.sql`AND garage.id = ANY(${ids}::uuid[])` : Prisma.empty}
    ORDER BY garage.rating DESC NULLS LAST, garage.review_count DESC,
      garage.name, garage.id
    LIMIT ${take}`;
}

interface GroupPageOptions {
  after?: After;
  ids?: string[];
  take: number;
}

export function groupPage(
  prisma: PrismaClient,
  brandId: string,
  group: Group,
  area: AreaSql | undefined,
  options: GroupPageOptions,
) {
  return prisma.$queryRaw<AreaRow[]>(
    groupPageSql(brandId, group, area, options),
  );
}

// The rows of a page, read back in their order: the public ones among them.
export async function inOrder<T extends { id: string }>(
  rows: AreaRow[],
  read: (ids: string[]) => Promise<T[]>,
): Promise<T[]> {
  if (rows.length === 0) return [];
  const found = new Map(
    (await read(rows.map((row) => row.id))).map((item) => [item.id, item]),
  );
  return rows.flatMap((row) => found.get(row.id) ?? []);
}

const CARD = {
  brandNote: true,
  brands: {
    select: {
      brand: {
        select: { id: true, name: true, popularity: true, slug: true },
      },
      stance: true,
    },
  },
  businessKind: true,
  cityName: true,
  facilities: { select: { facility: true }, where: { status: 'listed' } },
  id: true,
  labourFromBani: true,
  name: true,
  rating: true,
  refusalPhrase: true,
  reviewCount: true,
  serviceRadiusKm: true,
  slug: true,
} satisfies Prisma.GarageSelect;

type CardRow = Prisma.GarageGetPayload<{ select: typeof CARD }>;

// What a card shows. A mobile mechanic's city would tell where its seat is,
// so it gets its area instead.
function cardOf(
  brandId: string,
  {
    brandNote,
    brands,
    cityName,
    facilities,
    labourFromBani,
    rating,
    refusalPhrase,
    serviceRadiusKm,
    ...garage
  }: CardRow,
): ListedGarageDto {
  const mobile = garage.businessKind === 'mobile';
  const listed = new Set(facilities.map((row) => row.facility));
  return {
    ...garage,
    stance:
      brands.find((row) => row.brand.id === brandId)?.stance ?? 'unstated',
    ...brandAnswer(brands, { brandNote, refusalPhrase }),
    facilities: FACILITIES.filter((facility) => listed.has(facility)),
    labourFromLei:
      labourFromBani === null ? null : Math.round(labourFromBani / 100),
    rating: rating === null ? null : rating.toNumber(),
    ...(mobile
      ? { serviceRadiusKm: serviceRadiusKm ?? MOBILE_SERVICE_RADIUS_DEFAULT_KM }
      : cityName !== null && { city: cityName }),
  };
}

@Injectable()
export class GarageSearchService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly cache: GarageSearchCache,
    private readonly searchLog: SearchLogService,
  ) {}

  // A page, from the cache when the same search was read in the last 60
  // seconds. `log` marks a new search: its row is written after the answer,
  // which never waits for it. A box is the map moved over the same search,
  // never a new one: neither logged nor counted, and the radius plays no part.
  async forBrand(
    key: BrandKey,
    cursor?: string,
    point?: SearchPoint,
    radiusKm?: number,
    log = false,
    bbox?: SearchBbox,
  ): Promise<GarageSearchPageDto> {
    const brand = await brandOf(this.prisma, key);
    const box = bbox && bboxOf(bbox);
    const page = await this.cache.entry(
      {
        bbox: box,
        brandId: brand.id,
        cursor,
        kind: 'page',
        near: point && nearOf(point),
        radiusKm: bbox ? undefined : radiusKm,
      },
      () => this.searched(brand, cursor, point, radiusKm, bbox),
    );
    if (bbox) return page;
    countFirstPage(cursor, page.items.length);
    // Left to the next turn of the event loop: the answer goes out first.
    if (log) {
      setImmediate(() => this.searchLog.record({ brandId: brand.id, point }));
    }
    return page;
  }

  private async searched(
    brand: GarageSearchPageDto['brand'],
    cursor?: string,
    point?: SearchPoint,
    radiusKm?: number,
    bbox?: SearchBbox,
  ): Promise<GarageSearchPageDto> {
    const brandId = brand.id;
    const box = bbox && bboxOf(bbox);
    const after =
      cursor === undefined
        ? undefined
        : await this.after(decode(cursor, brandId, box));
    const area = areaOf(point, radiusKm, bbox);
    const found = await countGroups(this.prisma, brandId, area);
    const rows: AreaRow[] = [];
    if (after?.g !== 'other') {
      rows.push(
        ...(await groupPage(this.prisma, brandId, 'works_on', area, {
          after,
          take: PAGE + 1,
        })),
      );
    }
    if (rows.length <= PAGE) {
      rows.push(
        ...(await groupPage(this.prisma, brandId, 'other', area, {
          after: after?.g === 'other' ? after : undefined,
          take: PAGE + 1 - rows.length,
        })),
      );
    }
    const items = await this.cards(brandId, rows.slice(0, PAGE), area);
    const last = items.at(-1);
    return {
      brand,
      ...found,
      items,
      nextCursor:
        rows.length > PAGE && last ? cursorAfter(brandId, last, box) : null,
    };
  }

  // The cards a page already shows, read again: the public ones among the
  // ids, in the search's order and with its counts. Not a search of its own,
  // so it is never counted.
  async byIds(
    key: BrandKey,
    ids: string[],
    point?: SearchPoint,
    radiusKm?: number,
    bbox?: SearchBbox,
  ): Promise<GarageSearchPageDto> {
    const brand = await brandOf(this.prisma, key);
    const area = areaOf(point, radiusKm, bbox);
    const among = { ids, take: ids.length };
    const [found, takers, others] = await Promise.all([
      countGroups(this.prisma, brand.id, area),
      groupPage(this.prisma, brand.id, 'works_on', area, among),
      groupPage(this.prisma, brand.id, 'other', area, among),
    ]);
    return {
      brand,
      ...found,
      items: await this.cards(brand.id, [...takers, ...others], area),
      nextCursor: null,
    };
  }

  // The boundary's name, by id: a garage suspended since the last page
  // still marks where the next one starts, and is never listed again. Its
  // rating and review count are the cursor's, as its page showed them.
  private async after(cursor: Cursor): Promise<After> {
    const last = await this.prisma.garage.findUnique({
      select: { name: true },
      where: { id: cursor.i },
    });
    if (!last) throw invalidCursor();
    return { ...cursor, ...last };
  }

  // The cards of a page's rows, by their ids only, in the page's order.
  private async cards(
    brandId: string,
    rows: AreaRow[],
    area: AreaSql | undefined,
  ): Promise<ListedGarageDto[]> {
    const garages = await inOrder(rows, (ids) =>
      this.prisma.garage.findMany({
        select: CARD,
        where: { id: { in: ids }, ...publicGarages() },
      }),
    );
    const at = area && inAreaOf(rows);
    return garages.map((garage) => placed(cardOf(brandId, garage), at));
  }
}

// The area of a search with a place or a box; none reads all of Romania.
const areaOf = (
  point: SearchPoint | undefined,
  radiusKm?: number,
  bbox?: SearchBbox,
) => (point || bbox ? areaSql({ bbox, point, radiusKm }) : undefined);

// One search per first page; the pages after it are the same search.
function countFirstPage(cursor: string | undefined, found: number) {
  if (cursor === undefined) countSearch(found > 0 ? 'results' : 'none');
}
