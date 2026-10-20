import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { I18n } from '@motor-fix/i18n';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';

import { HowItWorks } from './how-it-works';

const reduced = signal(false);
let fixture: ComponentFixture<HowItWorks>;
let observers: {
  callback: IntersectionObserverCallback;
  target?: Element;
  disconnected: number;
}[];
const scroll = jest.fn();

class FakeObserver {
  constructor(callback: IntersectionObserverCallback) {
    observers.push({ callback, disconnected: 0 });
  }
  observe(target: Element) {
    observers[observers.length - 1].target = target;
  }
  disconnect() {
    observers[observers.length - 1].disconnected += 1;
  }
  unobserve() {}
}

beforeEach(() => {
  reduced.set(false);
  observers = [];
  scroll.mockClear();
  Element.prototype.scrollIntoView = scroll;
  Object.assign(window, { IntersectionObserver: FakeObserver });
});

afterEach(() => {
  jest.useRealTimers();
});

async function render(address?: string) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ children: [], path: '**' }]),
      { provide: REDUCED_MOTION, useValue: reduced },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  await i18n.use('ro');
  if (address) await TestBed.inject(Router).navigateByUrl(address);
  fixture = TestBed.createComponent(HowItWorks);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const figure = (root: HTMLElement) =>
  root.querySelector('.counter .figure')?.textContent?.trim();
const see = (isIntersecting: boolean, at = 0) =>
  observers[at].callback(
    [{ isIntersecting, target: observers[at].target } as never],
    {} as never,
  );

// @traces 228-FR-002
describe('the jump to how MotorFix works under other fragments', () => {
  it.each([
    '/ro#other',
    '/ro#how-it-works-2',
    '/ro#HOW-IT-WORKS',
    '/ro#',
    '/ro?x=how-it-works',
  ])('does not scroll or take focus for %s', async (address) => {
    const root = await render(address);

    expect(scroll).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(
      root.querySelector('section#how-it-works'),
    );
  });

  it('does not scroll for a navigation to another fragment on the page', async () => {
    await render('/ro');

    await TestBed.inject(Router).navigate(['/ro'], { fragment: 'cars' });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(scroll).not.toHaveBeenCalled();
  });

  it('scrolls once per visit to the fragment, not twice', async () => {
    await render('/ro#how-it-works');

    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('stops listening to navigation after it is destroyed', async () => {
    await render('/ro');
    fixture.destroy();

    await TestBed.inject(Router).navigate(['/ro'], {
      fragment: 'how-it-works',
      onSameUrlNavigation: 'reload',
    });

    expect(scroll).not.toHaveBeenCalled();
  });
});

// @traces 228-FR-002
describe('the jump to how MotorFix works while Home is still growing', () => {
  let resized: ((height: number) => void)[];
  let unobserved: number;

  beforeEach(() => {
    resized = [];
    unobserved = 0;
    Object.assign(window, {
      ResizeObserver: class {
        private off = false;
        constructor(callback: ResizeObserverCallback) {
          resized.push((height) => {
            if (this.off) return;
            callback([{ contentRect: { height } } as never], this as never);
          });
        }
        observe() {}
        disconnect() {
          this.off = true;
          unobserved += 1;
        }
        unobserve() {}
      },
    });
  });
  afterEach(() => {
    delete (window as { ResizeObserver?: unknown }).ResizeObserver;
  });

  it('scrolls to the section again as the page grows under it', async () => {
    await render('/ro#how-it-works');
    expect(scroll).toHaveBeenCalledTimes(1);

    resized[0](900);
    resized[0](2700);

    expect(scroll).toHaveBeenCalledTimes(3);
  });

  it('does not scroll again for a page that did not grow', async () => {
    await render('/ro#how-it-works');

    resized[0](900);
    resized[0](900);
    resized[0](600);

    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it.each(['wheel', 'touchstart', 'keydown', 'pointerdown'])(
    'leaves the page where the person takes it after a %s',
    async (type) => {
      await render('/ro#how-it-works');

      window.dispatchEvent(new Event(type));
      resized[0]?.(2700);

      expect(scroll).toHaveBeenCalledTimes(1);
      expect(unobserved).toBeGreaterThan(0);
    },
  );

  it('stops following three seconds after the jump', async () => {
    const timers = jest.spyOn(window, 'setTimeout');
    await render('/ro#how-it-works');
    const [settle] = timers.mock.calls.find(([, ms]) => ms === 3000) ?? [];
    timers.mockRestore();

    expect(settle).toBeInstanceOf(Function);
    (settle as () => void)();
    resized[0](2700);

    expect(scroll).toHaveBeenCalledTimes(1);
    expect(unobserved).toBeGreaterThan(0);
  });

  it('stops following once the page is left', async () => {
    await render('/ro#how-it-works');
    fixture.destroy();

    resized[0]?.(2700);

    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('does not follow the page for another fragment', async () => {
    await render('/ro#other');

    expect(resized).toEqual([]);
  });
});

// @traces 228-FR-006
describe('the hourly rate counter under odd timing', () => {
  it('does not start rolling for an entry that is not in view', async () => {
    jest.useFakeTimers();
    const root = await render();

    see(false);
    jest.advanceTimersByTime(2000);
    fixture.detectChanges();

    expect(figure(root)).toBe('0');
  });

  it('stops watching the section as soon as it has been seen', async () => {
    jest.useFakeTimers();
    await render();

    see(true);

    expect(observers).toHaveLength(1);
    expect(observers[0].disconnected).toBeGreaterThan(0);
  });

  it('never goes down or past 180 while rolling', async () => {
    jest.useFakeTimers();
    const root = await render();

    see(true);
    let last = 0;
    for (let i = 0; i < 100; i += 1) {
      jest.advanceTimersByTime(20);
      fixture.detectChanges();
      const now = Number(figure(root));
      expect(now).toBeGreaterThanOrEqual(last);
      expect(now).toBeLessThanOrEqual(180);
      last = now;
    }
    expect(last).toBe(180);
  });

  it('stops changing the figure once the page is left mid-roll', async () => {
    jest.useFakeTimers();
    const root = await render();

    see(true);
    jest.advanceTimersByTime(300);
    fixture.detectChanges();
    const frozen = figure(root);
    fixture.destroy();
    jest.advanceTimersByTime(2000);

    expect(figure(root)).toBe(frozen);
    expect(observers[0].disconnected).toBeGreaterThan(0);
  });

  it('settles on 180 when reduced motion turns on while it rolls', async () => {
    jest.useFakeTimers();
    const root = await render();

    see(true);
    jest.advanceTimersByTime(200);
    reduced.set(true);
    jest.advanceTimersByTime(100);
    fixture.detectChanges();

    expect(figure(root)).toBe('180');
  });

  it('keeps 180 in the accessible name whatever the figure shows mid-roll', async () => {
    jest.useFakeTimers();
    const root = await render();

    see(true);
    jest.advanceTimersByTime(100);
    fixture.detectChanges();

    expect(root.querySelector('.counter')?.getAttribute('aria-label')).toBe(
      '180 lei pe oră la Service Dobre',
    );
  });
});
