const SLOW = ['2g', 'slow-2g'];

// A read ahead runs only on a page in view, without Save-Data and on a
// connection faster than 2g: the profile pre-fetch and the filter warm alike.
export function prefetchAllowed(document: Document): boolean {
  const connection = (
    document.defaultView?.navigator as
      | { connection?: { saveData?: boolean; effectiveType?: string } }
      | undefined
  )?.connection;
  return (
    !connection?.saveData &&
    !SLOW.includes(connection?.effectiveType ?? '') &&
    document.visibilityState === 'visible'
  );
}
