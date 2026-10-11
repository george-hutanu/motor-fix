import { sourceOf } from './view-source';

// @traces 143-FR-008
describe('where a profile view came from, given awkward addresses', () => {
  it.each([
    ['/ro#top', 'home'],
    ['/en?utm=x#y', 'home'],
    ['/ro/garages#map', 'search'],
    ['/ro/garages?x=1#y', 'search'],
    ['/app/driver/saved?tab=1', 'saved'],
  ] as const)('names the page before %s as %s', (previous, source) => {
    expect(sourceOf(previous, null)).toBe(source);
  });

  it.each([
    [''],
    ['https://example.com/ro'],
    ['https://example.com/ro/garages'],
    ['//ro'],
    ['/ro/garagesx'],
    ['/RO'],
    ['/de'],
    ['/ro/'],
    ['/ro/garages/..'],
    ['javascript:alert(1)'],
  ])('falls back to a direct visit after %j', (previous) => {
    expect(sourceOf(previous, null)).toBe('profile_direct');
  });

  it.each(['Share', 'SHARE', 'share ', ' share', 'share=1', 'shared_link'])(
    'does not take %j for the share marker',
    (marker) => {
      expect(sourceOf(undefined, marker)).toBe('profile_direct');
    },
  );

  it('gives the same answer twice', () => {
    expect(sourceOf('/ro', null)).toBe(sourceOf('/ro', null));
  });
});
