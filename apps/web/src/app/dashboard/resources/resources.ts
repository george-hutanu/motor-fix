import {
  computed,
  effect,
  Injectable,
  inject,
  type Signal,
  signal,
  untracked,
  type WritableSignal,
} from '@angular/core';
import type { EventKind } from '@motor-fix/contracts';
import type {
  ActiveRequestAnswerDto,
  CarDto,
  GarageRequestListDto,
  RequestListDto,
} from '@motor-fix/data-access';

import { type LiveView, liveView } from '../../live/view';
import { Live } from '../live';
import { reuse } from '../live-in-place/live-in-place';
import { Session } from '../session';

// What the dashboard keeps of each read between two visits. A garage list is
// null for a session that may not read the garage's requests.
export interface Held {
  activeRequest: ActiveRequestAnswerDto;
  cars: CarDto[];
  garageClosed: GarageRequestListDto | null;
  garageQuoted: GarageRequestListDto | null;
  garageWaiting: GarageRequestListDto | null;
  requests: RequestListDto;
}

// How long a held value is shown with no read when its view opens again (ms).
const STALE_FOR: Record<keyof Held, number> = {
  activeRequest: 30_000,
  cars: 300_000,
  garageClosed: 30_000,
  garageQuoted: 30_000,
  garageWaiting: 30_000,
  requests: 30_000,
};

interface Slot<T> {
  // The account and role it was read for.
  owner: string;
  value: T;
  // When it was last read whole.
  at: number;
}

type Slots = { [K in keyof Held]: WritableSignal<Slot<Held[K]> | undefined> };

// The dashboard's reads, kept in the page's memory only, per account and role:
// a view opened again shows the last value at once and reads again only once
// it is older than its type's stale time. Nothing of one account is shown to,
// or kept for, the next.
@Injectable({ providedIn: 'root' })
export class Resources {
  private readonly live$ = inject(Live);
  private readonly session = inject(Session);
  // The key Live's tab lock uses too: a role switch is another owner.
  private readonly owner = computed(() => {
    const me = this.session.current();
    return me ? `${me.id}:${me.role}` : null;
  });
  private readonly slots: Slots = {
    activeRequest: signal(undefined),
    cars: signal(undefined),
    garageClosed: signal(undefined),
    garageQuoted: signal(undefined),
    garageWaiting: signal(undefined),
    requests: signal(undefined),
  };
  // The read each type's views opened on, joined by a view opening meanwhile
  // for the same owner.
  private readonly opening = new Map<
    keyof Held,
    { owner: string | null; answer: Promise<unknown> }
  >();
  // Counts the owner's changes, so a read that began before a sign-out and
  // answers after the same account signed in again is still dropped.
  private generation = 0;
  private seen = untracked(this.owner);

  constructor() {
    // A value is hidden from another owner at once; this frees it too.
    effect(() => {
      const owner = this.owner();
      this.stamp();
      untracked(() => {
        for (const slot of Object.values(this.slots))
          if (slot() && slot()?.owner !== owner) slot.set(undefined);
      });
    });
  }

  // A view of the type, as liveResource gives it (re-read on these event
  // kinds, a resync, a reload and 60 s after a failed read), that shows the
  // held value and skips its opening read while that value is fresh. Call it in
  // an injection context.
  live<K extends keyof Held>(
    type: K,
    load: () => Promise<Held[K]>,
    kinds: readonly EventKind[],
  ): LiveView<Held[K]> {
    const value = this.value(type);
    let opening = true;
    const read = (): Promise<Held[K]> => {
      const first = opening;
      opening = false;
      const held = this.held(type);
      const age = held ? Date.now() - held.at : -1;
      // A negative age is a clock set back: stale, not fresh until it catches up.
      if (first && held && age >= 0 && age < STALE_FOR[type])
        return Promise.resolve(held.value);
      const joined = this.opening.get(type);
      if (first && joined?.owner === this.owner())
        return joined.answer as Promise<Held[K]>;
      const answer = this.read(type, load);
      if (!first) return answer;
      const entry = { answer, owner: this.owner() };
      this.opening.set(type, entry);
      const done = () => {
        if (this.opening.get(type) === entry) this.opening.delete(type);
      };
      answer.then(done, done);
      return answer;
    };
    const view = liveView(read, {
      changes: this.live$.on(kinds),
      goneOn: [404],
      initial: value(),
      resync: this.live$.resync,
      retryAfter: 60_000,
    });
    return {
      ...view,
      isLoading: computed(() => view.isLoading() && value() === undefined),
      value,
    };
  }

  // A change the person made, shown at once by every view of the type; the
  // value keeps its age. Nothing changes while nothing is held for them.
  update<K extends keyof Held>(type: K, change: (value: Held[K]) => Held[K]) {
    const held = this.held(type);
    if (held) this.slots[type].set({ ...held, value: change(held.value) });
  }

  private async read<K extends keyof Held>(
    type: K,
    load: () => Promise<Held[K]>,
  ): Promise<Held[K]> {
    const owner = this.owner();
    const generation = this.stamp();
    const next = await load();
    // An owner change since the start, seen by the effect or here, moved the
    // count; every sign-in waits on the network, so the effect sees a sign-out
    // between it and the next sign-in of the same account.
    if (owner !== null && generation === this.stamp()) {
      const slot = this.slots[type] as WritableSignal<
        Slot<Held[K]> | undefined
      >;
      slot.set({
        at: Date.now(),
        owner,
        value: reuse(this.held(type)?.value, next),
      });
    }
    return next;
  }

  // The owner's change count, brought up to date with the owner first.
  private stamp(): number {
    const owner = untracked(this.owner);
    if (owner !== this.seen) {
      this.generation++;
      this.seen = owner;
    }
    return this.generation;
  }

  private held<K extends keyof Held>(type: K): Slot<Held[K]> | undefined {
    const held = this.slots[type]();
    return held && held.owner === this.owner() ? held : undefined;
  }

  private value<K extends keyof Held>(type: K): Signal<Held[K] | undefined> {
    return computed(() => this.held(type)?.value);
  }
}
