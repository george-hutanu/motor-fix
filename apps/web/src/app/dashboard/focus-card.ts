import {
  afterRenderEffect,
  ElementRef,
  inject,
  type Signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';

// A view opened at one of its cards (`/app/driver/cars/<id>`, from the bell):
// once the list has loaded, the card the address names scrolls into view and
// takes the focus. Once per address, so a live re-read never moves the page;
// a card no longer listed leaves the view at the top. Call it from the view's
// constructor; `attribute` is the one each card carries with its id.
export function focusCard(
  attribute: 'data-car' | 'data-request',
  loaded: Signal<unknown>,
): void {
  const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  const url = toSignal(inject(ActivatedRoute).url, { initialValue: [] });
  const reduced = inject(REDUCED_MOTION);
  let done: string | undefined;
  afterRenderEffect(() => {
    const segments = url();
    if (!loaded()) return;
    const address = segments.map((s) => s.path).join('/');
    if (address === done) return;
    done = address;
    const id = segments.at(-1)?.path;
    if (!id) return;
    const card = Array.from(
      host.querySelectorAll<HTMLElement>(`[${attribute}]`),
    ).find((el) => el.getAttribute(attribute) === id);
    if (!card) return;
    card.scrollIntoView({
      behavior: reduced() ? 'auto' : 'smooth',
      block: 'center',
    });
    card.focus({ preventScroll: true });
  });
}
