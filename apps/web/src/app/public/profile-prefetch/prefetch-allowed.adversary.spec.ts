import { prefetchAllowed } from './prefetch-allowed';

const doc = (
  connection: Record<string, unknown> | undefined | null,
  visibilityState: string = 'visible',
  view = true,
) =>
  ({
    defaultView: view ? { navigator: { connection } } : null,
    visibilityState,
  }) as unknown as Document;

describe('when a read ahead is allowed', () => {
  it('allows a visible page with no connection information', () => {
    expect(prefetchAllowed(doc(undefined))).toBe(true);
  });

  it('allows a visible page with a null connection', () => {
    expect(prefetchAllowed(doc(null))).toBe(true);
  });

  it('allows 3g and 4g', () => {
    expect(prefetchAllowed(doc({ effectiveType: '3g' }))).toBe(true);
    expect(prefetchAllowed(doc({ effectiveType: '4g' }))).toBe(true);
  });

  it.each(['2g', 'slow-2g'])('refuses %s', (effectiveType) => {
    expect(prefetchAllowed(doc({ effectiveType }))).toBe(false);
  });

  it('refuses Save-Data even on 4g', () => {
    expect(prefetchAllowed(doc({ effectiveType: '4g', saveData: true }))).toBe(
      false,
    );
  });

  it.each(['hidden', 'prerender', 'unloaded'])(
    'refuses a page that is %s',
    (state) => {
      expect(prefetchAllowed(doc({ effectiveType: '4g' }, state))).toBe(false);
    },
  );

  it('allows a visible document with no window', () => {
    expect(prefetchAllowed(doc(undefined, 'visible', false))).toBe(true);
  });
});
