// One brand in the row. A brand from the driver's cars has no slug until a
// popular or searched brand of the same id lends it one.
export type Chip = { id: string; name: string; slug?: string };

export const ROW = 8;

// The driver's own brands in the account's order, then the current brand
// when neither list holds it, then the popular ones: each brand once, at
// most 8, and the current one never cut.
export function chipRow(
  current: Chip | undefined,
  own: readonly Chip[],
  popular: readonly Chip[],
): Chip[] {
  const slugs = new Map<string, string>();
  for (const chip of [current, ...popular]) {
    if (chip?.slug) slugs.set(chip.id, chip.slug);
  }
  const build = (lead: Chip | undefined) => {
    const row = new Map<string, Chip>();
    const add = (chip: Chip) => {
      if (row.size >= ROW || row.has(chip.id) || !chip.name) return;
      const slug = chip.slug ?? slugs.get(chip.id);
      row.set(chip.id, slug ? { ...chip, slug } : chip);
    };
    // The own brands leave the current one its slot.
    for (const chip of own) {
      if (lead && row.size === ROW - 1 && chip.id !== lead.id) break;
      add(chip);
    }
    if (lead) add(lead);
    for (const chip of popular) add(chip);
    return [...row.values()];
  };
  const listed =
    !current ||
    own.some((c) => c.id === current.id) ||
    popular.some((c) => c.id === current.id);
  const row = build(listed ? undefined : current);
  // A popular current brand the own brands pushed past the eighth chip.
  return current && !row.some((c) => c.id === current.id)
    ? build(current)
    : row;
}
