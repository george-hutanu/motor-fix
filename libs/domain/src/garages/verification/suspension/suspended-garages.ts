import type {
  AdminGaragesDto,
  RarVerdict,
  SuspendedGarageRowDto,
  SuspensionCause,
} from '@motor-fix/contracts';

import type { Prisma } from '../../../generated/prisma/client';
import { garageArea } from '../verification.service';

const VERDICTS: Record<string, RarVerdict> = {
  expirat: 'expired',
  retras: 'withdrawn',
  suspendat: 'suspended',
};

// A failed re-check's verdict: the first of the three words its reason names.
// The suspension stores no verdict of its own, so the reason is the record.
export function rarVerdict(
  cause: SuspensionCause,
  reason: string,
): RarVerdict | undefined {
  if (cause !== 'recheck_failed') return undefined;
  const word = /expirat|suspendat|retras/i.exec(reason)?.[0].toLowerCase();
  return word ? VERDICTS[word] : undefined;
}

export async function countGarages(db: Prisma.TransactionClient) {
  const [listed, suspended] = await Promise.all([
    db.garage.count({ where: { status: 'approved' } }),
    db.garage.count({ where: { status: 'suspended' } }),
  ]);
  return { listed, suspended };
}

type Row = {
  id: string;
  name: string;
  businessKind: string | null;
  cityName: string | null;
  serviceRadiusKm: number | null;
  fileId: string | null;
  cause: SuspensionCause | null;
  reason: string | null;
  fromTime: Date | null;
  cancelledBookings: number | null;
};

// Every suspended garage with its open suspension, the most recent first; a
// garage with none comes last, by its name.
export async function suspendedGarages(
  db: Prisma.TransactionClient,
  { limit, offset }: { limit: number; offset: number },
): Promise<AdminGaragesDto> {
  const [rows, total] = await Promise.all([
    db.$queryRaw<Row[]>`
      SELECT g.id, g.name, g.business_kind::text AS "businessKind",
        g.city_name AS "cityName", g.service_radius_km AS "serviceRadiusKm",
        (SELECT v.id FROM verification_file v WHERE v.garage_id = g.id
          ORDER BY v.created_at DESC, v.id DESC LIMIT 1) AS "fileId",
        s.cause::text AS cause, s.reason, s.from_time AS "fromTime",
        CASE WHEN s.id IS NULL THEN NULL ELSE (
          SELECT count(*)::int FROM booking b
          WHERE b.garage_id = g.id AND b.cancel_reason = 'garage_suspended'
            AND b.cancelled_at >= s.from_time
        ) END AS "cancelledBookings"
      FROM garage g
      LEFT JOIN LATERAL (
        SELECT id, cause, reason, from_time FROM garage_suspension
        WHERE garage_id = g.id AND until_time IS NULL
        ORDER BY from_time DESC, id DESC LIMIT 1
      ) s ON true
      WHERE g.status = 'suspended'
      ORDER BY s.from_time DESC NULLS LAST,
        CASE WHEN s.id IS NULL THEN g.name END ASC, g.id ASC
      OFFSET ${offset} LIMIT ${limit}`,
    db.garage.count({ where: { status: 'suspended' } }),
  ]);
  return { items: rows.map(row), total };
}

function row(r: Row): SuspendedGarageRowDto {
  const area = garageArea(r);
  const open =
    r.cause !== null && r.reason !== null && r.fromTime !== null
      ? {
          cancelledBookings: r.cancelledBookings ?? 0,
          cause: r.cause,
          fromTime: r.fromTime.toISOString(),
          reason: r.reason,
        }
      : undefined;
  const verdict = open && rarVerdict(open.cause, open.reason);
  return {
    id: r.id,
    name: r.name,
    ...(r.fileId && { fileId: r.fileId }),
    ...(area && { area }),
    ...open,
    ...(verdict && { rarVerdict: verdict }),
  };
}
