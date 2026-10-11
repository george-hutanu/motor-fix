import { sourceOf } from './view-source';

// @traces 143-FR-008
describe('where a profile view came from, given query strings and hashes', () => {
  it.each([
    ['/ro/garages?src=share', 'search'],
    ['/ro?next=/ro/garages', 'home'],
    ['/ro#/ro/garages', 'home'],
    ['/en/garages?q=a?b#c?d', 'search'],
    ['/app/driver/saved?', 'saved'],
    ['/app/driver/saved#', 'saved'],
    ['/en?', 'home'],
  ] as const)('names the page before %s as %s', (previous, source) => {
    expect(sourceOf(previous, null)).toBe(source);
  });

  it.each([
    ['/ro/garages/'],
    ['/app/driver/saved/'],
    ['/ro%2Fgarages'],
    ['/ro\n'],
    ['\n/ro'],
    [' /ro'],
    ['/ro '],
    ['/app/driver/saved/extra'],
    ['/app/driver'],
    ['?/ro'],
    ['#/ro'],
    ['/ro/garages/123?x=/ro'],
  ])('takes %j for a direct visit', (previous) => {
    expect(sourceOf(previous, null)).toBe('profile_direct');
  });

  it('lets the share marker win over the page before', () => {
    expect(sourceOf('/ro/garages', 'share')).toBe('shared_link');
    expect(sourceOf('/app/driver/saved', 'share')).toBe('shared_link');
  });

  it('takes an empty marker for no marker', () => {
    expect(sourceOf('/ro', '')).toBe('home');
  });

  it('takes a missing page and a missing marker for a direct visit', () => {
    expect(sourceOf(undefined, null)).toBe('profile_direct');
  });
});
