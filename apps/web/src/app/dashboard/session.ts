import { Injectable, inject, signal } from '@angular/core';
import { type MeDto, MeService } from '@motor-fix/data-access';

// The signed-in account, held in memory only. Without an access token the
// answer is 401 and nobody is signed in; setting `current` to null signs out.
@Injectable({ providedIn: 'root' })
export class Session {
  private readonly api = inject(MeService);
  readonly current = signal<MeDto | null>(null);
  private loading: Promise<MeDto | null> | null = null;

  async load(): Promise<MeDto | null> {
    const known = this.current();
    if (known) return known;
    this.loading ??= this.api
      .meControllerMe()
      .catch(() => null)
      .then((me) => {
        this.current.set(me);
        this.loading = null;
        return me;
      });
    return this.loading;
  }
}
