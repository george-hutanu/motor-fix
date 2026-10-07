import { randomUUID } from 'node:crypto';

import { GarageSearchService } from './garage-search.service';
import { serialDatabase } from '../auth/serial-db.testing';
import { databaseUrl, fixtures } from '../notifications/notifications.testing';

type Stance = 'works_on' | 'does_not_take';
type Status = 'approved' | 'draft' | 'suspended';

const { prisma } = fixtures();
const search = new GarageSearchService(prisma);
serialDatabase(databaseUrl);

let dacia: string;
let tesla: string;

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE account, brand, garage CASCADE');
  dacia = (
    await prisma.brand.create({
      data: { key: 'dacia', name: 'Dacia', slug: 'dacia' },
    })
  ).id;
  tesla = (
    await prisma.brand.create({
      data: { key: 'tesla', name: 'Tesla', slug: 'tesla' },
    })
  ).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function garage(
  name: string,
  data: { brandNote?: string; refusalPhrase?: string; status?: Status } = {},
) {
  const { id } = await prisma.garage.create({
    data: {
      brandNote: data.brandNote,
      name,
      refusalPhrase: data.refusalPhrase,
      slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${randomUUID()}`,
      status: data.status ?? 'approved',
    },
  });
  return id;
}

async function mark(garageId: string, brandId: string, stance: Stance) {
  await prisma.garageBrand.create({
    data: {
      brandId,
      garageId,
      stance,
      ...(stance === 'does_not_take' && {
        diesel: false,
        electric: false,
        hybrid: false,
        petrol: false,
      }),
    },
  });
}

const brand = (key: string, over: Record<string, unknown> = {}) =>
  prisma.brand.create({
    data: { key, name: key.toUpperCase(), slug: key, ...over },
  });

describe('GarageSearchService.forBrand brand answer, adversarial', () => {
  it('carries both lists in catalogue order: popularity rank first, then name, unranked last', async () => {
    const zed = await brand('zed', { popularity: 1 });
    const abc = await brand('abc', { popularity: 2 });
    const ant = await brand('ant');
    const bee = await brand('bee');
    const id = await garage('Alfa');
    for (const b of [bee, ant, abc, zed]) await mark(id, b.id, 'works_on');
    await mark(id, tesla, 'does_not_take');
    await mark(id, dacia, 'does_not_take');

    const [item] = (await search.forBrand(dacia)).items;

    expect(item.worksOn.map((b) => b.name)).toEqual([
      'ZED',
      'ABC',
      'ANT',
      'BEE',
    ]);
    expect(item.doesNotTake.map((b) => b.name)).toEqual(['Dacia', 'Tesla']);
  });

  it('keeps a retired brand in the lists', async () => {
    const old = await brand('old', { active: false });
    const id = await garage('Alfa');
    await mark(id, old.id, 'works_on');
    await mark(id, dacia, 'works_on');

    const [item] = (await search.forBrand(dacia)).items;

    expect(item.worksOn.map((b) => b.name).sort()).toEqual(['Dacia', 'OLD']);
  });

  it('answers for a retired searched brand too', async () => {
    const old = await brand('old', { active: false });
    const id = await garage('Alfa');
    await mark(id, old.id, 'does_not_take');

    const [item] = (await search.forBrand(old.id)).items;

    expect(item.stance).toBe('does_not_take');
    expect(item.doesNotTake).toEqual([
      { id: old.id, name: 'OLD', slug: 'old' },
    ]);
  });

  it('gives an unmarked garage two empty lists, null note and null phrase', async () => {
    const id = await garage('Alfa');

    const [item] = (await search.forBrand(dacia)).items;

    expect(item).toMatchObject({
      brandNote: null,
      doesNotTake: [],
      id,
      refusalPhrase: null,
      stance: 'unstated',
      worksOn: [],
    });
  });

  it('keeps a 140-character note and a 60-character phrase whole', async () => {
    await garage('Alfa', {
      brandNote: 'n'.repeat(140),
      refusalPhrase: 'p'.repeat(60),
    });

    const [item] = (await search.forBrand(dacia)).items;

    expect(item.brandNote).toBe('n'.repeat(140));
    expect(item.refusalPhrase).toBe('p'.repeat(60));
  });

  it('returns a note and a phrase with unicode and markup exactly as stored', async () => {
    const brandNote = 'Fără „electrice” <b>și</b> ‮ 🚗';
    await garage('Alfa', { brandNote, refusalPhrase: 'Șkoda & co "x"' });

    const [item] = (await search.forBrand(dacia)).items;

    expect(item.brandNote).toBe(brandNote);
    expect(item.refusalPhrase).toBe('Șkoda & co "x"');
  });

  it('never reads a blank phrase because the store refuses to hold one', async () => {
    await expect(garage('Alfa', { refusalPhrase: '   ' })).rejects.toThrow(
      /garage_refusal_phrase_check/,
    );
  });

  it('does not leak the brand answer of another garage', async () => {
    const a = await garage('Alfa', { brandNote: 'only alfa' });
    const b = await garage('Beta');
    await mark(a, tesla, 'works_on');
    await mark(b, dacia, 'does_not_take');

    const { items } = await search.forBrand(dacia);
    const byName = Object.fromEntries(items.map((i) => [i.name, i]));

    expect(byName['Alfa'].worksOn.map((x) => x.name)).toEqual(['Tesla']);
    expect(byName['Alfa'].brandNote).toBe('only alfa');
    expect(byName['Beta'].worksOn).toEqual([]);
    expect(byName['Beta'].brandNote).toBeNull();
    expect(byName['Beta'].doesNotTake.map((x) => x.name)).toEqual(['Dacia']);
  });

  it('agrees the stance with the lists for every garage', async () => {
    const a = await garage('Alfa');
    const b = await garage('Beta');
    await garage('Delta');
    await mark(a, dacia, 'works_on');
    await mark(b, dacia, 'does_not_take');

    const { items } = await search.forBrand(dacia);

    for (const item of items) {
      expect(item.worksOn.some((x) => x.id === dacia)).toBe(
        item.stance === 'works_on',
      );
      expect(item.doesNotTake.some((x) => x.id === dacia)).toBe(
        item.stance === 'does_not_take',
      );
    }
  });

  it('carries the answer on every item of the second page', async () => {
    for (let i = 0; i < 25; i++) {
      const id = await garage(`Garage ${String(i).padStart(2, '0')}`, {
        brandNote: `note ${i}`,
      });
      await mark(id, tesla, 'works_on');
    }

    const first = await search.forBrand(dacia);
    const second = await search.forBrand(dacia, first.nextCursor ?? undefined);

    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(5);
    for (const item of [...first.items, ...second.items]) {
      expect(item.worksOn.map((x) => x.name)).toEqual(['Tesla']);
      expect(item.brandNote).toMatch(/^note \d+$/);
    }
  });

  it('keeps the garages that work on the brand first with their lists', async () => {
    const a = await garage('Alfa');
    const b = await garage('Beta');
    await mark(a, dacia, 'does_not_take');
    await mark(b, dacia, 'works_on');

    const { items } = await search.forBrand(dacia);

    expect(items.map((i) => i.name)).toEqual(['Beta', 'Alfa']);
    expect(items[0].worksOn.map((x) => x.name)).toEqual(['Dacia']);
  });

  it('leaves out draft and suspended garages with their answers', async () => {
    const d = await garage('Draft', { status: 'draft' });
    const s = await garage('Suspended', { status: 'suspended' });
    await mark(d, dacia, 'works_on');
    await mark(s, dacia, 'works_on');

    const page = await search.forBrand(dacia);

    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });

  it('writes nothing and answers the same twice', async () => {
    const id = await garage('Alfa', { brandNote: 'x' });
    await mark(id, dacia, 'works_on');
    const before = await prisma.garageBrand.count();

    const one = await search.forBrand(dacia);
    const two = await search.forBrand(dacia);

    expect(two).toEqual(one);
    expect(await prisma.garageBrand.count()).toBe(before);
  });

  it('serialises to JSON with only the contract fields and null, not missing, for unset text', async () => {
    await garage('Alfa');

    const [item] = (await search.forBrand(dacia)).items;
    const wire = JSON.parse(JSON.stringify(item));

    expect(Object.keys(wire).sort()).toEqual([
      'brandNote',
      'doesNotTake',
      'id',
      'name',
      'refusalPhrase',
      'slug',
      'stance',
      'worksOn',
    ]);
    expect(wire.brandNote).toBeNull();
    expect(wire.refusalPhrase).toBeNull();
  });

  it('gives each listed brand exactly id, name and slug', async () => {
    const id = await garage('Alfa');
    await mark(id, dacia, 'works_on');

    const [item] = (await search.forBrand(dacia)).items;

    expect(item.worksOn).toEqual([{ id: dacia, name: 'Dacia', slug: 'dacia' }]);
  });
});
