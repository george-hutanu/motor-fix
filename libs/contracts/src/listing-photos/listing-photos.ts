import type { ListingDraftData } from '../listing-sections';

export const PHOTOS_MAX = 20;

// What the sending story asks of step 5's photos: one confirmed upload, a
// stored file key; a blank or odd entry is none.
export const hasConfirmedPhoto = (data: ListingDraftData | undefined) => {
  const files: unknown = data?.files;
  return (
    Array.isArray(files) &&
    files.some((key) => typeof key === 'string' && key.trim() !== '')
  );
};
