import { slugOf, uniqueSlug } from './garage-slug';

const takenOf =
  (...taken: string[]) =>
  async (slugs: string[]) =>
    slugs.filter((slug) => taken.includes(slug));

describe('slugOf', () => {
  it.each([
    ['Service Popescu', 'service-popescu'],
    ['  Șase Frâne & Țevi!  ', 'sase-frane-tevi'],
    ['AUTO--Nord 24', 'auto-nord-24'],
    ['Reglaj faruri', 'reglaj-faruri'],
  ])('turns %j into %j', (name, slug) => {
    expect(slugOf(name)).toBe(slug);
  });

  it('falls back to a word when nothing of the name is left', () => {
    expect(slugOf('!!!')).toBe('service');
  });
});

describe('uniqueSlug', () => {
  it('keeps the base when it is free', async () => {
    expect(await uniqueSlug('Service Popescu', takenOf())).toBe(
      'service-popescu',
    );
  });

  it('adds -2 when the base is taken', async () => {
    expect(
      await uniqueSlug('Service Popescu', takenOf('service-popescu')),
    ).toBe('service-popescu-2');
  });

  it('takes the first free number when several are taken', async () => {
    expect(
      await uniqueSlug(
        'Service Popescu',
        takenOf('service-popescu', 'service-popescu-2', 'service-popescu-3'),
      ),
    ).toBe('service-popescu-4');
  });

  it('asks again past the first batch of numbers', async () => {
    const taken = [
      'service',
      ...Array.from({ length: 30 }, (_, i) => `service-${i + 2}`),
    ];

    expect(await uniqueSlug('Service', takenOf(...taken))).toBe('service-32');
  });

  it('gives up, answering nothing, once a thousand numbers are taken', async () => {
    const asked: string[][] = [];
    const slug = await uniqueSlug('Service', async (candidates) => {
      asked.push(candidates);
      return candidates;
    });

    expect(slug).toBeUndefined();
    expect(asked.flat()).toHaveLength(1000);
  });
});
