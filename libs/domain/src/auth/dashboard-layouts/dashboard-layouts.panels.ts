import type { DashboardPanelDto } from '@motor-fix/contracts';
import type { Role } from '@motor-fix/contracts/capabilities';

// Each served role's section keys in their default order. A section joins
// its list with the story that ships it (performance after numbers, system
// after verification, reported after demand); driver and garage join with
// their own dashboards.
export const PANEL_KEYS = {
  admin: ['numbers', 'verification', 'growth', 'demand', 'log'],
} as const satisfies Partial<Record<Role, readonly string[]>>;

// The section keys of a role served yet, or undefined.
export const panelKeysOf = (role: string): readonly string[] | undefined =>
  Object.hasOwn(PANEL_KEYS, role)
    ? PANEL_KEYS[role as keyof typeof PANEL_KEYS]
    : undefined;

const isPanel = (entry: unknown): entry is DashboardPanelDto =>
  typeof entry === 'object' &&
  entry !== null &&
  typeof (entry as DashboardPanelDto).key === 'string' &&
  typeof (entry as DashboardPanelDto).visible === 'boolean';

// The saved known keys in the saved order, then the list's other keys
// visible in its order; a key the list no longer holds is left out.
export function mergeLayout(
  keys: readonly string[],
  saved: readonly unknown[] | null,
): DashboardPanelDto[] {
  const known = new Set(keys);
  const seen = new Set<string>();
  const panels: DashboardPanelDto[] = [];
  for (const entry of saved ?? []) {
    if (!isPanel(entry) || !known.has(entry.key) || seen.has(entry.key))
      continue;
    seen.add(entry.key);
    panels.push({ key: entry.key, visible: entry.visible });
  }
  for (const key of keys)
    if (!seen.has(key)) panels.push({ key, visible: true });
  return panels;
}

export type PanelsProblem = 'duplicate_key' | 'unknown_key';

// Why a save's panels cannot be kept, or null; keys compare exactly.
export function checkPanels(
  keys: readonly string[],
  panels: readonly DashboardPanelDto[],
): PanelsProblem | null {
  const seen = new Set<string>();
  for (const { key } of panels) {
    if (!keys.includes(key)) return 'unknown_key';
    if (seen.has(key)) return 'duplicate_key';
    seen.add(key);
  }
  return null;
}
