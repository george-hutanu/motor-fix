import { CITY_KEY } from '@motor-fix/contracts';
import { isRecord } from '@motor-fix/contracts/is-record';
import { Inject, Injectable, Logger } from '@nestjs/common';

import file from './areas.json';
import { PRISMA } from '../../auth/prisma';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';

type AreaKind = 'city' | 'sector';

export interface AreaRecord {
  code: string;
  geometry: { coordinates: unknown[]; type: 'MultiPolygon' | 'Polygon' };
  kind: AreaKind;
  name: string;
}

const SECTOR = /^sector-[1-6]$/;
const NAME_MAX = 80;

const filled = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

function refuse(why: string): never {
  throw new Error(`areas file: ${why}`);
}

const validCode = (kind: AreaKind, code: unknown): code is string =>
  typeof code === 'string' &&
  (kind === 'sector'
    ? SECTOR.test(code)
    : CITY_KEY.test(code) && !code.startsWith('sector-'));

function outlineOf(
  code: string,
  geometry: Record<string, unknown>,
): AreaRecord['geometry'] {
  const type = geometry['type'];
  const coordinates = geometry['coordinates'];
  if (type !== 'Polygon' && type !== 'MultiPolygon')
    refuse(`${code} is a ${String(type)}, not an outline`);
  if (
    !Array.isArray(coordinates) ||
    coordinates.length === 0 ||
    coordinates.some((part) => !Array.isArray(part) || part.length === 0)
  )
    refuse(`${code} has an empty outline`);
  const polygons = type === 'Polygon' ? [coordinates] : coordinates;
  if (
    !polygons.every((rings) => Array.isArray(rings) && rings.every(closedRing))
  )
    refuse(`${code} has a ring that is not closed or has under 4 points`);
  return { coordinates, type };
}

const isPosition = (p: unknown): p is number[] =>
  Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite);

// A GeoJSON linear ring: at least 4 positions, the last the first.
function closedRing(ring: unknown): boolean {
  if (!Array.isArray(ring) || ring.length < 4 || !ring.every(isPosition))
    return false;
  const [first, last] = [ring[0], ring[ring.length - 1]];
  return first[0] === last[0] && first[1] === last[1];
}

function areaOfFeature(feature: unknown, i: number): AreaRecord {
  const properties = isRecord(feature) ? feature['properties'] : undefined;
  const geometry = isRecord(feature) ? feature['geometry'] : undefined;
  if (!isRecord(properties) || !isRecord(geometry))
    refuse(`feature ${i} has no properties or geometry`);
  const { code, kind, name } = properties;
  if (kind !== 'city' && kind !== 'sector')
    refuse(`feature ${i} has the kind ${String(kind)}`);
  if (!validCode(kind, code))
    refuse(`feature ${i} has the code ${String(code)}`);
  if (!filled(name) || name.length > NAME_MAX)
    refuse(`${code} has no name of 1 to ${NAME_MAX} characters`);
  return { code, geometry: outlineOf(code, geometry), kind, name };
}

// The outlines of the București sectors and the county seats, as the build
// team ships them: a file that breaks a rule stops the API before it serves.
export function readAreas(source: unknown): AreaRecord[] {
  if (!isRecord(source)) refuse('not an object');
  if (!filled(source['source'])) refuse('no source');
  if (!filled(source['licence'])) refuse('no licence');
  const features = source['features'];
  if (!Array.isArray(features) || features.length === 0) refuse('no features');
  const areas = features.map(areaOfFeature);
  const codes = areas.map((area) => area.code);
  const twice = codes.find((code, i) => codes.indexOf(code) !== i);
  if (twice !== undefined) refuse(`the code ${twice} twice`);
  return areas;
}

export const AREAS: readonly AreaRecord[] = readAreas(file);

// The code of the first area by code whose outline holds the geography
// `point`, else `unknown`: a point in no area, or none at all.
export const areaOf = (point: Prisma.Sql) =>
  Prisma.sql`COALESCE((SELECT a.code FROM area a WHERE ST_Intersects(a.outline, ${point}) ORDER BY a.code LIMIT 1), 'unknown')`;

// The centre of a search's five-character cell, null without one or for a
// value that is not a geohash, which ST_PointFromGeoHash would fail on.
export const cellCentre = (cell: Prisma.Sql) =>
  Prisma.sql`CASE WHEN ${cell} ~ '^[0-9b-hjkmnp-z]{1,12}$' THEN ST_PointFromGeoHash(${cell})::geography ELSE NULL::geography END`;

// Makes the stored areas match the file by code: inserts and updates, never
// deletes; one transaction, so two API replicas booting together take turns.
@Injectable()
export class AreaLoader {
  private readonly logger = new Logger('AreaLoader');

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async load(areas: readonly AreaRecord[]) {
    // An outline PostGIS would store without complaint is refused before any write.
    for (const { code, geometry } of areas) outlineOf(code, { ...geometry });
    const changed = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('area_loader'))`;
        let n = 0;
        for (const { code, geometry, kind, name } of areas)
          n += await tx.$executeRaw`
            INSERT INTO area (code, name, kind, outline, updated_at)
            VALUES (${code}, ${name}, ${kind},
              ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), 4326))::geography,
              now())
            ON CONFLICT (code) DO UPDATE SET
              name = EXCLUDED.name, kind = EXCLUDED.kind,
              outline = EXCLUDED.outline, updated_at = EXCLUDED.updated_at
            WHERE (area.name, area.kind) IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.kind)
              OR NOT ST_Equals(area.outline::geometry, EXCLUDED.outline::geometry)`;
        return n;
      },
      // 47 outlines of a few hundred points each.
      { timeout: 30_000 },
    );
    this.logger.log(`areas loaded: ${changed} changed`);
    return { changed };
  }
}
