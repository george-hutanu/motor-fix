import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { PublicGarageDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import {
  PhotoViewer,
  type ViewerLabels,
  type ViewerPhoto,
} from '@motor-fix/ui-cockpit';

// The garage's photos on its profile: the first one large, the rest as tiles,
// each opening the full-screen view. A photo whose address has expired is read
// again once through the profile; a second failure shows the placeholder.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.aria-label]': 'label()' },
  imports: [PhotoViewer],
  selector: 'section[mf-photos-section]',
  styleUrl: './photos-section.css',
  templateUrl: './photos-section.html',
})
export class PhotosSection {
  readonly garage = input.required<PublicGarageDto>();
  readonly reread = output();

  private readonly i18n = inject(I18n);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly viewer = viewChild(PhotoViewer);

  protected readonly label = computed(() =>
    this.i18n.t('public.garageProfile.photos.label'),
  );
  protected readonly tiles = computed(() => {
    const { name, photos } = this.garage();
    return photos.map((photo, i) => ({
      alt: this.i18n.t('public.garageProfile.photos.alt', {
        garage: name,
        n: i + 1,
        total: photos.length,
      }),
      id: photo.id,
      src: i === 0 ? photo.displayUrl : photo.thumbnailUrl,
    }));
  });

  // Keyed by address, so a re-read with fresh addresses loads them again.
  protected readonly loaded = signal(new Set<string>());
  protected readonly broken = signal(new Set<string>());
  private readonly retried = linkedSignal({
    computation: () => new Set<string>(),
    source: this.garage,
  });
  private readonly failed = linkedSignal({
    computation: () => new Set<string>(),
    source: this.garage,
  });

  protected readonly photos = computed<ViewerPhoto[]>(() => {
    const failed = this.failed();
    return this.garage().photos.map((photo, i) => ({
      alt: this.tiles()[i]?.alt ?? '',
      displayUrl: photo.displayUrl,
      failed: failed.has(photo.id),
      id: photo.id,
    }));
  });
  protected readonly labels = computed<ViewerLabels>(() => ({
    close: this.i18n.t('public.garageProfile.photos.close'),
    counter: (n, total) =>
      this.i18n.t('public.garageProfile.photos.counter', { n, total }),
    next: this.i18n.t('public.garageProfile.photos.next'),
    previous: this.i18n.t('public.garageProfile.photos.previous'),
  }));

  protected open(index: number, tile: HTMLElement): void {
    this.viewer()?.open(
      index,
      tile,
      () =>
        this.host.nativeElement.querySelector<HTMLElement>('button.tile') ??
        undefined,
    );
  }

  protected mark(
    set: typeof this.loaded | typeof this.broken,
    src: string,
  ): void {
    set.update((seen) => new Set(seen).add(src));
  }

  protected viewFailed(id: string): void {
    if (!this.retried().has(id)) {
      this.retried.update((ids) => new Set(ids).add(id));
      this.reread.emit();
    } else {
      this.failed.update((ids) => new Set(ids).add(id));
    }
  }
}
