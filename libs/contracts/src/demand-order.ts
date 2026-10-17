// The two orders of the admin's demand brands, shared by the read and the
// view's toggle so both rank a brand the same way.
export type DemandOrder = 'searches' | 'requests';

interface DemandBrand {
  readonly name: string;
  readonly requests: number;
  readonly searches: number;
}

// Plain code-point order; `<` would compare UTF-16 units and put an astral
// character before U+E000..U+FFFF.
export function byCodePoint(a: string, b: string) {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = (x[i].codePointAt(0) ?? 0) - (y[i].codePointAt(0) ?? 0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

// The chosen figure first, the other one next, then the name; a new list.
export function orderBrands<T extends DemandBrand>(
  brands: readonly T[],
  by: DemandOrder,
): T[] {
  const other = by === 'searches' ? 'requests' : 'searches';
  return [...brands].sort(
    (a, b) =>
      b[by] - a[by] || b[other] - a[other] || byCodePoint(a.name, b.name),
  );
}
