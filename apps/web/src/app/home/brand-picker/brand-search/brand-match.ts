import { fold } from '@motor-fix/contracts';
import type { BrandDto } from '@motor-fix/data-access';

const SHOWN = 8;

// A brand matches when its name, or a word of it, starts with the text, so
// "alfa r" and "romeo" both find Alfa Romeo but "lfa" finds nothing.
export function matches(brands: readonly BrandDto[], text: string) {
  const query = fold(text.trim());
  if (query === '') return [];
  return brands
    .filter((brand) => {
      const name = fold(brand.name);
      return (
        name.startsWith(query) ||
        name.split(/[\s-]+/).some((word) => word.startsWith(query))
      );
    })
    .slice(0, SHOWN);
}
