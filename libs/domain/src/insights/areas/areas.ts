import { CITY_KEY } from '@motor-fix/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';

import file from './areas.json';
import { PRISMA } from '../../auth/prisma';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';

export type AreaKind = 'city' | 'sector';

export interface AreaRecord {
  code: string;
  geometry: { coordinates: unknown[]; type: 'MultiPolygon' | 'Polygon' };
  kind: AreaKind;
  name: string;
}

const SECTOR = /^sector-[1-6]$/;
const NAME_MAX = 80;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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
  return { coordinates, type };
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

// Makes the stored areas match the file by code: inserts and updates, never
// deletes; one transaction, so two API replicas booting together take turns.
@Injectable()
export class AreaLoader {
  private readonly logger = new Logger('AreaLoader');

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async load(areas: readonly AreaRecord[]) {
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
