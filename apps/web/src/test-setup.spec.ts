import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import { Component, Injectable, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

// A spec file renders a page per test in one jsdom document; once a test
// ends, its page must be free to go. jsdom's selector cache and the call
// records of module-level mocks kept every page: list-your-garage.spec grew
// past 750 MB by its 163rd test and timed out on a loaded machine.
setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

@Injectable({ providedIn: 'root' })
class Wording {
  readonly words = signal('a page');
}

@Component({
  selector: 'mf-probe',
  template: '<p>{{ wording.words() }}</p>',
})
class Probe {
  readonly wording = inject(Wording);
}

// Module-level, as the specs' service doubles are.
const shown = jest.fn();

async function render() {
  const fixture = TestBed.createComponent(Probe);
  await fixture.whenStable();
  const page = fixture.nativeElement as HTMLElement;
  shown(page);
  return { fixture, page };
}

let earlier: WeakRef<object>[] = [];

describe('the test setup', () => {
  it('renders a page and reads it', async () => {
    const { fixture, page } = await render();
    earlier = [
      new WeakRef(fixture.componentInstance),
      new WeakRef(TestBed.inject(Wording)),
      new WeakRef(page),
    ];
    expect(page.querySelector('p')?.textContent).toBe('a page');
    expect(shown).toHaveBeenCalledWith(page);
  });

  it("lets the earlier test's page and services go once it has ended", async () => {
    const { page } = await render();
    expect(page.querySelector('p')?.textContent).toBe('a page');
    // A turn of the event loop lets the earlier test's teardown finish.
    await new Promise((resolve) => setTimeout(resolve, 0));
    gc();

    expect(earlier.map((ref) => ref.deref() === undefined)).toEqual([
      true,
      true,
      true,
    ]);
  });
});
