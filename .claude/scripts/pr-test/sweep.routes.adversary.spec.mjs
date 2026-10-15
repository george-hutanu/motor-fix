// @traces 1230-FR-002 1230-FR-003 1230-FR-004 1230-FR-005 1230-FR-011
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROUTE_PATTERN, contextCookies, dropExpected, matrix, parseRoute, routeProblem } from './sweep.mjs';

const WORKFLOW = join(import.meta.dirname, '..', '..', '..', '.github', 'workflows', 'pr-qa.yml');

describe('route rule: what is accepted', () => {
  for (const route of [
    '/',
    '/results?brand=dacia',
    '/results?brand=dacia&sort=near',
    '/results?q=100%25',
    '/:lang',
    '/:lang/',
    '/:lang/list-your-garage',
    '/:lang/x:404',
    '/:lang/x?y=1',
    '/app',
    '/apple-pay',
    '/app/driver@driver',
    '/app/driver@driver:401',
    '/app/driver?tab=2@driver',
    '/cockpit:404',
  ])
    it(`accepts ${route}`, () => assert.equal(routeProblem(route), null));
});

describe('route rule: what is refused', () => {
  for (const [route, why] of [
    ['/app/driver', /@role/],
    ['/app/', /@role/],
    ['/app/driver:401', /@role/],
    ['/app/driver?tab=2', /@role/],
    ['/a b', /a b/],
    ['/a;rm', /rm/],
    ['/a$(x)', /x/],
    ['/a`x`', /x/],
    ['/a#frag', /frag/],
    ['/café', /caf/],
    ['/a\nb', /a/],
    ['', /./],
    ['results', /results/],
    ['/x/:lang', /:lang/],
    ['/a:b', /a:b/],
    ['/:langx', /:langx/],
    ['/:lang/:lang', /:lang/],
    ['/a:404:404', /404/],
    ['/a,/b', /a,\/b/],
  ])
    it(`refuses ${JSON.stringify(route)} with a line naming it`, () => {
      const p = routeProblem(route);
      assert.equal(typeof p, 'string');
      assert.ok(!p.includes('\n') || route.includes('\n'), p);
      assert.match(p, why);
    });
});

describe('route rule and the workflow stay equal', () => {
  const yml = readFileSync(WORKFLOW, 'utf8');
  const bash = /\[\[ "\$ROUTES" =~ (\^\/[^ ]*\$) \]\]/.exec(yml)?.[1];
  it('reads the bash pattern from the workflow', () => assert.ok(bash, 'routes check not found'));
  it('gives the same verdict as the workflow pattern on a hostile corpus', () => {
    const re = new RegExp(bash.replace(/\\&/g, '&'));
    const corpus = ['/', '/a?b=c&d=e', '/a%20b', '/a b', '/a;b', '/a|b', '/a$b', '/a\\b', '/a#b', '/a"b', "/a'b", '/a(b)', '/a<b', '/a*b', '/a!b', '/a~b', '/a+b', '/aé', '/a,/b', '/:lang/x:404', ''];
    for (const s of corpus) assert.equal(ROUTE_PATTERN.test(s), re.test(s), JSON.stringify(s));
  });
  it('refuses a newline that a multiline match could slip past', () => {
    assert.equal(ROUTE_PATTERN.test('/a\n/b'), false);
    assert.equal(ROUTE_PATTERN.test('/a\n'), false);
  });
});

describe('parseRoute', () => {
  it('reads a leading :lang and still a trailing status', () => {
    assert.deepEqual(parseRoute('/:lang/x:404'), { path: '/:lang/x', role: null, expect: 404, lang: true });
  });
  it('reads :lang alone and with a trailing slash', () => {
    assert.equal(parseRoute('/:lang').path, '/:lang');
    assert.equal(parseRoute('/:lang').lang, true);
    assert.equal(parseRoute('/:lang/').path, '/:lang/');
  });
  it('keeps the query in the path and reads a role and a status after it', () => {
    assert.deepEqual(parseRoute('/results?brand=dacia@driver:401'), { path: '/results?brand=dacia', role: 'driver', expect: 401, lang: false });
  });
  it('does not take a path starting like :lang for a language segment', () => {
    assert.equal(parseRoute('/:langx').lang, false);
  });
  it('reads the root', () => {
    assert.deepEqual(parseRoute('/'), { path: '/', role: null, expect: null, lang: false });
  });
});

describe('matrix', () => {
  const cells = (routes, extra = {}) => matrix({ routes, ...extra });

  it('is empty with no routes, no schemes or no languages', () => {
    assert.deepEqual(cells([]), []);
    assert.deepEqual(cells(['/'], { schemes: [] }), []);
    assert.deepEqual(cells(['/'], { langs: [] }), []);
  });

  it('opens a :lang route under the language of each cell and reports it as written', () => {
    for (const c of cells(['/:lang/list-your-garage'])) {
      assert.equal(c.href, `/${c.lang}/list-your-garage`);
      assert.equal(c.route, '/:lang/list-your-garage');
    }
  });

  it('opens /:lang and /:lang/ as /ro and /en', () => {
    assert.deepEqual([...new Set(cells(['/:lang']).map((c) => c.href))].sort(), ['/en', '/ro']);
    assert.deepEqual([...new Set(cells(['/:lang/']).map((c) => c.href))].sort(), ['/en/', '/ro/']);
  });

  it('keeps the :lang substitution out of a trailing status and a role', () => {
    const c = cells(['/:lang/x@driver:404'], { langs: ['en'] })[0];
    assert.equal(c.href, '/en/x');
    assert.equal(c.role, 'driver');
    assert.equal(c.expect, 404);
  });

  it('opens a route with its query as written', () => {
    const hrefs = new Set(cells(['/results?brand=dacia&sort=near']).map((c) => c.href));
    assert.deepEqual([...hrefs], ['/results?brand=dacia&sort=near']);
  });

  it('gives every cell of a run its own screenshot name', () => {
    const shots = cells(['/', '/cockpit', '/:lang/x']).map((c) => c.shot);
    assert.equal(new Set(shots).size, shots.length);
  });

  it('gives routes that differ only by query different screenshot names', () => {
    const routes = ['/results', '/results?brand=dacia', '/results?brand=bmw', '/results?brand=dacia&sort=near', '/results?q=a%20b', '/results?q=a-b', '/results?q=a_b', '/results?q=a.b'];
    const shots = cells(routes).map((c) => c.shot);
    assert.equal(new Set(shots).size, shots.length);
  });

  it('gives the same screen as two roles two names', () => {
    const shots = cells(['/app/x@driver', '/app/x@garage']).map((c) => c.shot);
    assert.equal(new Set(shots).size, shots.length);
  });

  it('names a file a filesystem accepts, whatever the route holds', () => {
    for (const c of cells(['/a?b=%2F%2e%2e&c=%00', '/:lang/x?y=1@driver:404'])) assert.match(c.shot, /^[A-Za-z0-9._-]+\.png$/);
  });

  it('keeps a screenshot name within a filename limit for the longest route the workflow takes', () => {
    const long = `/r?q=${'a'.repeat(400)}`;
    for (const c of cells([long])) assert.ok(Buffer.byteLength(c.shot) <= 255, `${c.shot.length} characters`);
  });

  it('keeps two very long routes that differ at the end apart', () => {
    const base = `/r?q=${'a'.repeat(400)}`;
    const shots = cells([`${base}1`, `${base}2`]).map((c) => c.shot);
    assert.equal(new Set(shots).size, shots.length);
  });
});

describe('expected status', () => {
  const http = (over) => ({ kind: 'http', status: 404, url: 'http://127.0.0.1:4200/ro/gone', path: '/:lang/gone', href: '/ro/gone', expect: 404, ...over });

  it('is empty for no observations', () => assert.deepEqual(dropExpected([]), []));

  it('drops the expected answer of the page and its console line, and keeps the rest', () => {
    const keep = [http({ status: 500 }), http({ url: 'http://127.0.0.1:4200/ro/other' }), http({ expect: null }), { kind: 'console', text: 'x', expect: null }];
    const drop = [http(), { kind: 'console', text: 'Failed to load resource: the server responded with a status of 404', expect: 404 }];
    assert.deepEqual(dropExpected([...drop, ...keep]), keep);
  });

  it('drops a query route\'s expected answer only for that exact query', () => {
    const mine = http({ url: 'http://127.0.0.1:4200/r?a=1', href: '/r?a=1', path: '/r?a=1' });
    const other = http({ url: 'http://127.0.0.1:4200/r?a=2', href: '/r?a=1', path: '/r?a=1' });
    assert.deepEqual(dropExpected([mine, other]), [other]);
  });

  it('keeps an unparseable url observation', () => {
    const odd = http({ url: 'not a url' });
    assert.deepEqual(dropExpected([odd]), [odd]);
  });
});

describe('the signed-in cookie', () => {
  const baseURL = 'http://127.0.0.1:4200';

  it('is none and asks for no session when the route has no role', async () => {
    let asked = 0;
    assert.deepEqual(await contextCookies({ role: null, lang: 'en' }, { session: async () => (asked++, 'r'), baseURL }), []);
    assert.equal(asked, 0);
  });

  it('asks for the role in the language of this cell, once, and carries the token', async () => {
    const asked = [];
    const out = await contextCookies({ role: 'garage', lang: 'en' }, { session: async (...a) => (asked.push(a), 'tok-1'), baseURL });
    assert.deepEqual(asked, [['garage', 'en']]);
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'mf_refresh');
    assert.equal(out[0].value, 'tok-1');
  });

  it('asks again for the next cell, since refresh tokens rotate', async () => {
    const asked = [];
    const session = async (role, lang) => (asked.push(lang), `t-${asked.length}`);
    const a = await contextCookies({ role: 'driver', lang: 'ro' }, { session, baseURL });
    const b = await contextCookies({ role: 'driver', lang: 'en' }, { session, baseURL });
    assert.deepEqual(asked, ['ro', 'en']);
    assert.notEqual(a[0].value, b[0].value);
  });

  it('lets a refused language update reach the caller, so the screen is never swept in the wrong language', async () => {
    await assert.rejects(contextCookies({ role: 'driver', lang: 'en' }, { session: async () => { throw new Error('PATCH /api/v1/me answered HTTP 500'); }, baseURL }), /HTTP 500/);
  });

  it('refuses a role with no way to sign in', async () => {
    await assert.rejects(contextCookies({ role: 'driver', lang: 'en' }, { baseURL }), /driver/);
  });
});
