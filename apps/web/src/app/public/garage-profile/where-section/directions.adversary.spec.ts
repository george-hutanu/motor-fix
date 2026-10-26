import { directionsHref, platformOf } from './directions';

// @traces 1366-FR-009
describe('the platform of odd user agents', () => {
  it.each([
    [undefined as unknown as string, 'computer'],
    [null as unknown as string, 'computer'],
    ['   ', 'computer'],
    ['Mozilla/5.0 (X11; Linux x86_64) Chrome/129.0 Safari/537.36', 'computer'],
    ['Mozilla/5.0 (CrOS x86_64 14541.0.0) Chrome/129', 'computer'],
    ['Mozilla/5.0 (Linux; Android 14; SM-S918B) Chrome/129 Mobile', 'android'],
    ['Mozilla/5.0 (Linux; U; Android 4.4.2; en-us) Version/4.0', 'android'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'ios'],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0',
      'computer',
    ],
  ])('reads %p as %p', (agent, platform) => {
    expect(platformOf(agent)).toBe(platform);
  });

  it('reads a very long user agent without hanging, as a computer', () => {
    expect(platformOf(`${'x'.repeat(200_000)} Windows NT`)).toBe('computer');
  });

  it('reads a user agent with an Android token far down a long string', () => {
    expect(platformOf(`${'x '.repeat(5000)}Android 14`)).toBe('android');
  });
});

// @traces 1366-FR-008
describe('directions addresses at the edge of the written form', () => {
  it.each([
    ['ios', 'https://maps.apple.com/?daddr=-33.5,-70.25'],
    ['android', 'geo:-33.5,-70.25?q=-33.5,-70.25'],
    [
      'computer',
      'https://www.google.com/maps/dir/?api=1&destination=-33.5,-70.25',
    ],
  ] as const)('writes negative coordinates for %s as they are', (p, href) => {
    expect(directionsHref(p, -33.5, -70.25)).toBe(href);
  });

  it('writes zero as 0 on every platform', () => {
    expect(directionsHref('ios', 0, 0)).toBe(
      'https://maps.apple.com/?daddr=0,0',
    );
    expect(directionsHref('android', 0, 0)).toBe('geo:0,0?q=0,0');
  });

  it('writes a very small coordinate as String writes it', () => {
    expect(directionsHref('android', 1e-7, 2.5e-7)).toBe(
      `geo:${String(1e-7)},${String(2.5e-7)}?q=${String(1e-7)},${String(2.5e-7)}`,
    );
  });

  it('writes seventeen significant digits unrounded', () => {
    expect(
      directionsHref('computer', 44.12345678901234, 26.98765432109876),
    ).toContain('destination=44.12345678901234,26.98765432109876');
  });

  it('gives the same address for the same call twice', () => {
    expect(directionsHref('ios', 44.4, 26.1)).toBe(
      directionsHref('ios', 44.4, 26.1),
    );
  });

  it('uses a comma between the numbers and a dot inside them, never a locale separator', () => {
    expect(directionsHref('android', 44.5, 26.5)).toBe(
      'geo:44.5,26.5?q=44.5,26.5',
    );
  });
});
