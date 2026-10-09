import { CITY_KEY, LOCALITY_MAX } from '@motor-fix/contracts';

const BUCHAREST = { key: 'bucuresti', name: 'București' };
// The capital's six sectors and its English name are one city.
const BUCHAREST_NAMES = /^(bucuresti|bucharest|sector(ul)? [1-6])$/;

const plain = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// The city a look-up's locality names, or null when it names none; never a
// reason to refuse the address it came with.
export function cityOf(
  locality: unknown,
): { key: string; name: string } | null {
  if (typeof locality !== 'string') return null;
  const name = locality.trim().replace(/\s+/g, ' ');
  if (!name || name.length > LOCALITY_MAX) return null;
  if (BUCHAREST_NAMES.test(plain(name))) return BUCHAREST;
  const key = plain(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return CITY_KEY.test(key) ? { key, name } : null;
}
