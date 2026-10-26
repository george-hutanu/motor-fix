export type Platform = 'ios' | 'android' | 'computer';

// The device a user agent names, by the maps app it opens directions in. An
// iPad asking for desktop sites says it is a Mac and gets the computer's.
export function platformOf(userAgent: string): Platform {
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'ios';
  if (/Android/.test(userAgent)) return 'android';
  return 'computer';
}

// Directions to a point in the platform's maps app, the coordinates written
// in full as String writes them.
export function directionsHref(
  platform: Platform,
  lat: number,
  lng: number,
): string {
  const at = `${String(lat)},${String(lng)}`;
  if (platform === 'ios') return `https://maps.apple.com/?daddr=${at}`;
  if (platform === 'android') return `geo:${at}?q=${at}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${at}`;
}
