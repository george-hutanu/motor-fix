import { bellLink, VIEW_OF_KIND } from './bell.link';

const CAR = '6f1c2a3e-1d4b-4a8e-9c1f-2b3d4e5f6a7b';
const REQUEST = '0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d';
const at = (path: string) => `https://motorfix.ro${path}`;

const link = (params: unknown, kind = 'QUOTE_RECEIVED') =>
  bellLink({ kind, params, subjectId: null } as never);

describe('bellLink under hostile input', () => {
  // @traces 032-FR-003
  it.each([null, undefined, 'text', 42, []])(
    'falls back to the requests view for params %p',
    (params) => {
      expect(link(params)).toBe('/app/driver/requests');
    },
  );

  // @traces 032-FR-003
  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', ''])(
    'opens nothing for the kind %p',
    (kind) => {
      expect(
        bellLink({ kind, params: {}, subjectId: CAR } as never),
      ).toBeNull();
    },
  );

  // @traces 032-FR-003
  it('opens nothing for TEST_MESSAGE even when it carries a request link', () => {
    expect(
      link({ link: at(`/app/driver/requests/${REQUEST}`) }, 'TEST_MESSAGE'),
    ).toBeNull();
  });

  // @traces 032-FR-003
  it('does not give a review kind a car or request address', () => {
    expect(
      bellLink({
        kind: 'REVIEW_INVITE',
        params: { link: at(`/app/driver/requests/${REQUEST}`) },
        subjectId: CAR,
      } as never),
    ).toBe('/app/driver/reviews');
  });

  // @traces 032-FR-003
  it('opens the cars view alone for a car kind with an empty subject', () => {
    expect(
      bellLink({ kind: 'DUE_ITP', params: {}, subjectId: '' } as never),
    ).toBe('/app/driver/cars');
  });

  // @traces 032-FR-003
  it('ignores a request link that names a car path', () => {
    expect(link({ link: at(`/app/driver/cars/${CAR}`) })).toBe(
      '/app/driver/requests',
    );
  });

  // @traces 032-FR-003
  it('ignores a request link whose id is not a uuid', () => {
    expect(link({ link: at('/app/driver/requests/not-a-uuid') })).toBe(
      '/app/driver/requests',
    );
  });

  // @traces 032-FR-003
  it('ignores a request link with a path after the id', () => {
    expect(
      link({ link: at(`/app/driver/requests/${REQUEST}/../../admin`) }),
    ).not.toContain('admin');
  });

  // @traces 032-FR-003
  it('keeps only the pathname of a request link with a query and fragment', () => {
    expect(
      link({ link: at(`/app/driver/requests/${REQUEST}?utm=mail#top`) }),
    ).toBe(`/app/driver/requests/${REQUEST}`);
  });

  // @traces 032-FR-003
  it('never returns an off-site address for a link on another origin', () => {
    const result = link({
      link: `https://evil.example/app/driver/requests/${REQUEST}`,
    });
    expect(result).toBe(`/app/driver/requests/${REQUEST}`);
  });

  // @traces 032-FR-003
  it('follows a relative request link as the pathname it holds', () => {
    expect(link({ link: `/app/driver/requests/${REQUEST}` })).toBe(
      `/app/driver/requests/${REQUEST}`,
    );
  });

  // @traces 032-FR-003
  it('accepts an upper-case uuid in the request link', () => {
    expect(
      link({ link: at(`/app/driver/requests/${REQUEST.toUpperCase()}`) }),
    ).toBe(`/app/driver/requests/${REQUEST.toUpperCase()}`);
  });

  // @traces 032-FR-003
  it.each([
    { link: 42 },
    { link: null },
    { link: {} },
    { link: '' },
    { link: 'javascript:alert(1)' },
  ])('falls back to the requests view for params %p', (params) => {
    expect(link(params)).toBe('/app/driver/requests');
  });

  // @traces 032-FR-001
  it('maps only kinds named in the table and every address starts under the driver area', () => {
    for (const kind of Object.keys(VIEW_OF_KIND)) {
      expect(bellLink({ kind, params: {}, subjectId: CAR } as never)).toMatch(
        /^\/app\/driver\/(cars|requests|reviews)/,
      );
    }
  });

  // @traces 032-FR-003
  it('returns the same address for the same row twice', () => {
    const row = { kind: 'DUE_ITP', params: {}, subjectId: CAR } as never;
    expect(bellLink(row)).toBe(bellLink(row));
  });
});
