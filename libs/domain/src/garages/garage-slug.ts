import { slugOf as brandSlugOf } from '../catalogue/brands';

const BATCH = 20;
// Past a thousand taken numbers the name is not worth another query.
const BATCHES = 50;

// The brands' rule (lower case, accents dropped, non-letters as one hyphen),
// with a word left when the name holds no letter at all.
export const slugOf = (name: string): string => brandSlugOf(name) || 'service';

// The name's slug, or the first of slug-2, slug-3… that `taken` does not
// return, or nothing once all of them are; `taken` answers which of the
// candidates are already used.
export async function uniqueSlug(
  name: string,
  taken: (candidates: string[]) => Promise<string[]>,
): Promise<string | undefined> {
  const base = slugOf(name);
  for (let from = 1; from <= BATCH * BATCHES; from += BATCH) {
    const candidates = Array.from({ length: BATCH }, (_, i) =>
      from + i === 1 ? base : `${base}-${from + i}`,
    );
    const used = new Set(await taken(candidates));
    const free = candidates.find((candidate) => !used.has(candidate));
    if (free) return free;
  }
  return undefined;
}
