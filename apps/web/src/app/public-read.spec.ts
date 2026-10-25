import { HttpContext, HttpRequest } from '@angular/common/http';

import {
  freshPublicRead,
  PUBLIC_READ,
  publicRead,
  transferCacheFilter,
} from './public-read';

const get = (context: HttpContext) =>
  new HttpRequest('GET', '/api/v1/reviews/garage/g-1?page=1', { context });

describe('the transfer cache filter', () => {
  it('leaves a public read and a plain read to the transfer cache', () => {
    expect(transferCacheFilter(get(publicRead()))).toBe(true);
    expect(transferCacheFilter(get(new HttpContext()))).toBe(true);
  });

  it('keeps a fresh read out of it, so the server render’s answer never stands in for a re-read', () => {
    expect(transferCacheFilter(get(freshPublicRead()))).toBe(false);
  });

  it('sends a fresh read without the token, as any public read', () => {
    expect(freshPublicRead().get(PUBLIC_READ)).toBe(true);
  });
});
