import type { SearchPoint } from '@motor-fix/contracts';

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
const LENGTH = 5;

// The geohash cell of a point, 5 characters (about 5 by 5 km): each
// character takes 5 bits, halving longitude and latitude in turn.
export function geohash5({ lat, lng }: SearchPoint): string {
  const lats = [-90, 90];
  const lngs = [-180, 180];
  let cell = '';
  let bits = 0;
  let index = 0;
  for (let bit = 0; cell.length < LENGTH; bit++) {
    const [range, value] = bit % 2 === 0 ? [lngs, lng] : [lats, lat];
    const middle = (range[0] + range[1]) / 2;
    const upper = value >= middle;
    index = index * 2 + (upper ? 1 : 0);
    range[upper ? 0 : 1] = middle;
    if (++bits === 5) {
      cell += BASE32[index];
      bits = 0;
      index = 0;
    }
  }
  return cell;
}
