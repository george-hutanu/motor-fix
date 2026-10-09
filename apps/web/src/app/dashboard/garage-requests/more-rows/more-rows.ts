import {
  afterNextRender,
  afterRenderEffect,
  DestroyRef,
  type ElementRef,
  effect,
  Injector,
  inject,
  type Signal,
  signal,
  untracked,
} from '@angular/core';

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

// The rows after a list's first page: the next page each time `end` comes into
// view. A re-read of the first page reads the further pages again, as many
// rows as were shown, so a scrolled list keeps its depth. Call it in an
// injection context.
export function moreRows<T>(
  first: Signal<unknown>,
  nextCursor: Signal<string | null | undefined>,
  page: (cursor: string) => Promise<Page<T>>,
  end: Signal<ElementRef<HTMLElement> | undefined>,
): Signal<readonly T[]> {
  const more = signal<readonly T[]>([]);
  const injector = inject(Injector);
  // Where the next page starts: undefined until the first page is read.
  let cursor: string | null | undefined;
  let reading = false;
  // Watches the end again once the new rows are drawn, so an end still in view asks once more.
  let watchAgain: () => void = () => undefined;

  // At least `count` rows from `from` on; undefined when a newer read began.
  const upTo = async (from: string, count: number) => {
    let next: string | null = from;
    const items: T[] = [];
    while (next && items.length < count) {
      const read = await page(next);
      if (cursor !== from) return undefined;
      // A page with no rows ends the list, whatever cursor it names.
      if (!read.items.length) return { items, nextCursor: null };
      items.push(...read.items);
      next = read.nextCursor;
    }
    return { items, nextCursor: next };
  };

  const again = async (from: string | null | undefined) => {
    const shown = more().length;
    cursor = from;
    if (!shown || !from) {
      more.set([]);
      return;
    }
    try {
      const read = await upTo(from, shown);
      if (cursor !== from || !read) return;
      more.set(read.items);
      cursor = read.nextCursor;
    } catch {
      // The rows shown stay; the next re-read or scroll asks again.
    }
  };

  const step = async () => {
    const from = cursor;
    if (!from || reading) return;
    reading = true;
    try {
      const read = await page(from);
      if (cursor !== from) return;
      more.update((rows) => [...rows, ...read.items]);
      cursor = read.nextCursor;
      afterNextRender(() => watchAgain(), { injector });
    } catch {
      // The next time the end comes into view asks again.
    } finally {
      reading = false;
    }
  };

  effect(() => {
    first();
    const from = nextCursor();
    untracked(() => void again(from));
  });
  if (typeof IntersectionObserver === 'undefined') return more.asReadonly();
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) void step();
  });
  let watched: HTMLElement | undefined;
  afterRenderEffect(() => {
    const element = end()?.nativeElement;
    if (element === watched) return;
    if (watched) observer.unobserve(watched);
    if (element) observer.observe(element);
    watched = element;
  });
  watchAgain = () => {
    if (!watched) return;
    observer.unobserve(watched);
    observer.observe(watched);
  };
  inject(DestroyRef).onDestroy(() => observer.disconnect());
  return more.asReadonly();
}
