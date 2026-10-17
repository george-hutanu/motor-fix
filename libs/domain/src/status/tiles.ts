import type { Limits } from './thresholds';

export const TILES = [
  'api',
  'search',
  'maps',
  'email',
  'notifications',
  'backup',
] as const;
export type TileKey = (typeof TILES)[number];
export type TileState = 'green' | 'amber' | 'red';

export interface Figures {
  latency_ms?: number;
  failed_share?: number;
  oldest_waiting_s?: number;
  backup_age_h?: number;
}

export type Detail = Record<string, number | string>;

export interface Check {
  state: TileState;
  detail: Detail;
}

export interface TileRow {
  key: TileKey;
  state: TileState;
  since: Date;
  detail: Detail;
  checkedAt: Date;
  pendingState: TileState | null;
  pendingSince: Date | null;
}

// Which limits each figure is held to.
const LIMITS: Record<keyof Figures, [keyof Limits, keyof Limits]> = {
  backup_age_h: ['amber_h', 'red_h'],
  failed_share: ['amber_share', 'red_share'],
  latency_ms: ['amber_ms', 'red_ms'],
  oldest_waiting_s: ['amber_age_s', 'red_age_s'],
};

// A figure at or over a limit has reached it; a failed check (null) is red.
export function stateOf(figures: Figures | null, limits: Limits): TileState {
  if (!figures) return 'red';
  let state: TileState = 'green';
  for (const [figure, [amber, red]] of Object.entries(LIMITS) as [
    keyof Figures,
    [keyof Limits, keyof Limits],
  ][]) {
    const value = figures[figure];
    if (value === undefined) continue;
    const redLimit = limits[red];
    const amberLimit = limits[amber];
    if (redLimit !== undefined && value >= redLimit) return 'red';
    if (amberLimit !== undefined && value >= amberLimit) state = 'amber';
  }
  return state;
}

// A state changes only when two checks in a row agree on it; `since` is the
// first of the two. Every check records its time and figures.
export function nextTile(
  key: TileKey,
  row: TileRow | null,
  check: Check,
  now: Date,
): { row: TileRow; changed: boolean } {
  const checked = { checkedAt: now, detail: check.detail };
  if (!row) {
    return {
      changed: true,
      row: {
        ...checked,
        key,
        pendingSince: null,
        pendingState: null,
        since: now,
        state: check.state,
      },
    };
  }
  if (check.state === row.state) {
    return {
      changed: false,
      row: { ...row, ...checked, pendingSince: null, pendingState: null },
    };
  }
  if (check.state === row.pendingState && row.pendingSince) {
    return {
      changed: true,
      row: {
        ...row,
        ...checked,
        pendingSince: null,
        pendingState: null,
        since: row.pendingSince,
        state: check.state,
      },
    };
  }
  return {
    changed: false,
    row: { ...row, ...checked, pendingSince: now, pendingState: check.state },
  };
}

// The figure and limit a tile went over to reach its state: the red limit for
// red, the amber one for amber. None for green, or for a failed check.
export function limitCrossed(
  figures: Figures | null,
  limits: Limits,
  state: TileState,
): { figure: keyof Figures; limit: number } | null {
  if (!figures || state === 'green') return null;
  for (const [figure, [amber, red]] of Object.entries(LIMITS) as [
    keyof Figures,
    [keyof Limits, keyof Limits],
  ][]) {
    const value = figures[figure];
    const limit = limits[state === 'red' ? red : amber];
    if (value !== undefined && limit !== undefined && value >= limit) {
      return { figure, limit };
    }
  }
  return null;
}
