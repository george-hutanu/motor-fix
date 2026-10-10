import type { ProfileViewDto } from '@motor-fix/data-access';

type Source = NonNullable<ProfileViewDto['source']>;

const PAGES: readonly [RegExp, Source][] = [
  [/^\/(ro|en)$/, 'home'],
  [/^\/(ro|en)\/garages$/, 'search'],
  [/^\/app\/driver\/saved$/, 'saved'],
];

// Where a profile view came from: a shared link carries its marker in the
// address it was opened with, anything else is named by the page before it.
export function sourceOf(
  previous: string | undefined,
  marker: string | null,
): Source {
  if (marker === 'share') return 'shared_link';
  const path = previous?.split(/[?#]/)[0] ?? '';
  return PAGES.find(([page]) => page.test(path))?.[1] ?? 'profile_direct';
}
