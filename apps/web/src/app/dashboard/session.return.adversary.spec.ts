import { TestBed } from '@angular/core/testing';
import { AuthService, MeService } from '@motor-fix/data-access';

import { Session } from './session';

function session() {
  TestBed.configureTestingModule({
    providers: [
      { provide: MeService, useValue: { meControllerMe: jest.fn() } },
      { provide: AuthService, useValue: {} },
    ],
  });
  return TestBed.inject(Session);
}

beforeEach(() => sessionStorage.clear());
afterEach(() => jest.restoreAllMocks());

describe('the kept return address', () => {
  it.each([
    '/app/driver/cars',
    '/app/driver',
    '/app/driver/cars?x=1&y=%20#frag',
    '/',
    '/a//b',
    '/ro',
  ])('gives back %s once', (url) => {
    const s = session();
    s.keepReturnTo(url);

    expect(s.takeReturnTo()).toBe(url);
    expect(s.takeReturnTo()).toBeNull();
  });

  it.each([
    '//evil.example',
    '//',
    '/\\evil.example',
    '/\\',
    'https://evil.example/app/driver',
    'http://evil.example',
    'javascript:alert(1)',
    'app/driver',
    '',
    ' /app/driver',
    '\\\\evil',
    '\t//evil.example',
    '\n/app',
    'data:text/html,x',
  ])('refuses %j and drops it', (url) => {
    const s = session();
    s.keepReturnTo(url);

    expect(s.takeReturnTo()).toBeNull();
    expect(sessionStorage.getItem('mf-return-to')).toBeNull();
  });

  it('gives null when nothing was kept', () => {
    expect(session().takeReturnTo()).toBeNull();
  });

  it('lets the last writer win', () => {
    const s = session();
    s.keepReturnTo('/app/driver/cars');
    s.keepReturnTo('/app/driver/saved');

    expect(s.takeReturnTo()).toBe('/app/driver/saved');
    expect(s.takeReturnTo()).toBeNull();
  });

  it('forgets a good address when a bad one is written after it', () => {
    const s = session();
    s.keepReturnTo('/app/driver/cars');
    s.keepReturnTo('//evil.example');

    expect(s.takeReturnTo()).toBeNull();
  });

  it('keeps the address whole when it is very long', () => {
    const s = session();
    const url = `/app/driver/cars?q=${'x'.repeat(100_000)}`;
    s.keepReturnTo(url);

    expect(s.takeReturnTo()).toBe(url);
  });

  it('does not throw when storage refuses a write, and gives null', () => {
    const s = session();
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });

    expect(() => s.keepReturnTo('/app/driver/cars')).not.toThrow();
    expect(s.takeReturnTo()).toBeNull();
  });

  it('gives null when storage refuses a read', () => {
    const s = session();
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(s.takeReturnTo()).toBeNull();
  });

  it('gives null when storage refuses the removal', () => {
    const s = session();
    s.keepReturnTo('/app/driver/cars');
    jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(s.takeReturnTo()).toBeNull();
  });
});
