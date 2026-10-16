export type PanelKey =
  | 'active_request'
  | 'live'
  | 'quotes'
  | 'cars'
  | 'mileage'
  | 'spend'
  | 'history'
  | 'saved';

export interface PanelEntry {
  key: PanelKey;
  released: boolean;
  wide: boolean;
}

// One entry of a saved layout; its key may name a panel that no longer exists.
export interface LayoutEntry {
  hidden: boolean;
  key: string;
}

// The driver's panels in their default order. A panel whose flag is off is
// never drawn, whatever a saved layout says.
export const DRIVER_PANELS: readonly PanelEntry[] = [
  { key: 'active_request', released: true, wide: true },
  { key: 'live', released: false, wide: false },
  { key: 'quotes', released: true, wide: false },
  { key: 'cars', released: true, wide: false },
  { key: 'mileage', released: false, wide: false },
  { key: 'spend', released: false, wide: false },
  { key: 'history', released: true, wide: true },
  { key: 'saved', released: true, wide: true },
];

const RELEASED = DRIVER_PANELS.filter((p) => p.released).map((p) => p.key);

// A saved layout over the registry: its order and hidden panels win, and a
// released panel it does not name goes right after the nearest panel before
// it in the default order that is drawn, or first.
export function panelsToDraw(
  layout: readonly LayoutEntry[] | null,
): PanelKey[] {
  const named = new Set<string>();
  const drawn: PanelKey[] = [];
  for (const { hidden, key } of layout ?? []) {
    if (named.has(key) || !RELEASED.includes(key as PanelKey)) continue;
    named.add(key);
    if (!hidden) drawn.push(key as PanelKey);
  }
  RELEASED.forEach((key, i) => {
    if (named.has(key)) return;
    const before = RELEASED.slice(0, i).findLast((k) => drawn.includes(k));
    drawn.splice(before === undefined ? 0 : drawn.indexOf(before) + 1, 0, key);
  });
  return drawn;
}
