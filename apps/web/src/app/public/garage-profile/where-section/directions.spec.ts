import { directionsHref, platformOf } from './directions';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPOD =
  'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
// iPadOS asks for desktop sites by default and says it is a Mac.
const IPADOS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

// @traces 1366-FR-009
// @traces 1366-FR-013
describe('the platform a browser runs on', () => {
  it.each([
    [IPHONE, 'ios'],
    [IPAD, 'ios'],
    [IPOD, 'ios'],
    [ANDROID, 'android'],
    [DESKTOP, 'computer'],
    [IPADOS_MAC, 'computer'],
    ['', 'computer'],
  ])('reads %p as %p', (agent, platform) => {
    expect(platformOf(agent)).toBe(platform);
  });
});

// @traces 1366-FR-008
// @traces 1366-FR-013
describe('the directions address of each platform', () => {
  const LAT = 44.4352671;
  const LNG = 26.0123456;

  it('sends an Apple device to Apple Maps', () => {
    expect(directionsHref('ios', LAT, LNG)).toBe(
      'https://maps.apple.com/?daddr=44.4352671,26.0123456',
    );
  });

  it('sends an Android device to its maps app by a geo address', () => {
    expect(directionsHref('android', LAT, LNG)).toBe(
      'geo:44.4352671,26.0123456?q=44.4352671,26.0123456',
    );
  });

  it('sends a computer to Google Maps directions', () => {
    expect(directionsHref('computer', LAT, LNG)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=44.4352671,26.0123456',
    );
  });

  it('writes the coordinates in full, as String writes them, never rounded', () => {
    expect(directionsHref('computer', 44.1, 26)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=44.1,26',
    );
    expect(directionsHref('ios', 45.123456789012, 21.98765432101)).toContain(
      'daddr=45.123456789012,21.98765432101',
    );
  });

  it('never writes NaN or undefined', () => {
    for (const platform of ['ios', 'android', 'computer'] as const)
      expect(directionsHref(platform, LAT, LNG)).not.toMatch(/NaN|undefined/);
  });
});
