import {
  type AdminStatusDto,
  allClearSentence,
  STALE_AFTER_MS,
  type StatusTileDto,
  type StatusTileView,
  statusTexts,
  TILES,
  type TileKey,
} from '@motor-fix/contracts';

import type { Detail } from './tiles';
import type { PrismaClient } from '../generated/prisma/client';

interface Answered extends StatusTileView {
  checkedAt: Date | null;
}

// A tile with no check for three minutes, or none at all, reads red from its
// last check: the panel must never show a stale green.
function answer(
  key: TileKey,
  row:
    | {
        state: Answered['state'];
        since: Date;
        detail: unknown;
        checkedAt: Date;
      }
    | undefined,
  now: Date,
): Answered {
  if (!row)
    return {
      checkedAt: null,
      detail: {},
      key,
      since: null,
      stale: true,
      state: 'red',
    };
  const detail = { ...(row.detail as Detail) };
  if (row.checkedAt.getTime() <= now.getTime() - STALE_AFTER_MS)
    return {
      checkedAt: row.checkedAt,
      detail,
      key,
      since: row.checkedAt,
      stale: true,
      state: 'red',
    };
  return {
    checkedAt: row.checkedAt,
    detail,
    key,
    since: row.since,
    stale: false,
    state: row.state,
  };
}

const RANK = { amber: 1, green: 2, red: 0 } as const;

// Red before amber, the oldest first, a tile never checked last, then the
// panel order.
function problemsOf(tiles: Answered[]): Answered[] {
  return tiles
    .filter((tile) => tile.state !== 'green')
    .sort(
      (a, b) =>
        RANK[a.state] - RANK[b.state] ||
        (a.since?.getTime() ?? Number.POSITIVE_INFINITY) -
          (b.since?.getTime() ?? Number.POSITIVE_INFINITY) ||
        TILES.indexOf(a.key) - TILES.indexOf(b.key),
    );
}

export async function readStatus(
  prisma: PrismaClient,
  now: Date,
): Promise<AdminStatusDto> {
  const rows = await prisma.statusTile.findMany();
  const tiles = TILES.map((key) =>
    answer(
      key,
      rows.find((row) => row.key === key),
      now,
    ),
  );
  const problems = problemsOf(tiles);
  const sentences = problems.flatMap((tile) => {
    const { sentence } = statusTexts(tile, now);
    return sentence ? [sentence] : [];
  });
  const said = sentences.length > 0 ? sentences : [allClearSentence];
  return {
    problems: problems.map((tile) => tile.key),
    sentences: {
      en: said.map((s) => s.en),
      ro: said.map((s) => s.ro),
    },
    tiles: tiles.map(
      (tile): StatusTileDto => ({
        checkedAt: tile.checkedAt?.toISOString() ?? null,
        detail: tile.detail,
        key: tile.key,
        short: statusTexts(tile, now).short,
        since: tile.since?.toISOString() ?? null,
        stale: tile.stale,
        state: tile.state,
      }),
    ),
  };
}
