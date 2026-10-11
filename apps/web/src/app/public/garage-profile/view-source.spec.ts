import { sourceOf } from './view-source';

// @traces 143-FR-008
describe('where a profile view came from', () => {
  it('names a shared link by the address it was opened with', () => {
    expect(sourceOf('/ro/garages', 'share')).toBe('shared_link');
    expect(sourceOf(undefined, 'share')).toBe('shared_link');
  });

  it.each([
    ['/ro', 'home'],
    ['/en', 'home'],
    ['/ro?x=1', 'home'],
    ['/ro/garages', 'search'],
    ['/en/garages?brand=dacia', 'search'],
    ['/app/driver/saved', 'saved'],
  ] as const)('names the page before %s as %s', (previous, source) => {
    expect(sourceOf(previous, null)).toBe(source);
  });

  it.each([
    [undefined],
    ['/ro/garages/service-auto-militari'],
    ['/ro/terms'],
    ['/app/driver'],
    ['/app/driver/saved/extra'],
    ['/romania'],
  ])('falls back to a direct visit after %s', (previous) => {
    expect(sourceOf(previous, null)).toBe('profile_direct');
  });

  it('ignores any other value of the share marker', () => {
    expect(sourceOf('/ro', 'twitter')).toBe('home');
    expect(sourceOf(undefined, '')).toBe('profile_direct');
  });
});
