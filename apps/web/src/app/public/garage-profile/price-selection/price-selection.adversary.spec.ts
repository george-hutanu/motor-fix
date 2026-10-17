import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { PublicGarageDto } from '@motor-fix/data-access';

import { PriceSelection } from './price-selection';

const garage = (id: string, jobs: string[]) =>
  ({
    id,
    prices: jobs.map((jobTypeId) => ({
      fromBani: 10_000,
      jobTypeId,
      nameEn: jobTypeId,
      nameRo: jobTypeId,
      toBani: 20_000,
    })),
  }) as unknown as PublicGarageDto;

const MILITARI = garage('g-1', ['j-diag', 'j-brakes', 'j-chain']);
const DINAMO = garage('g-2', ['j-diag', 'j-brakes']);

function selection() {
  TestBed.configureTestingModule({
    providers: [PriceSelection, { provide: PLATFORM_ID, useValue: 'browser' }],
  });
  return TestBed.inject(PriceSelection);
}

const stored = (id: string) => sessionStorage.getItem(`mf.estimate.${id}`);
const on = (s: PriceSelection) => [...s.on()].sort();

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  jest.restoreAllMocks();
  TestBed.resetTestingModule();
});

// @traces 356-FR-009
describe('the stored selection, read hostile', () => {
  it('counts a job once when the stored list names it twice, and stores it once', () => {
    sessionStorage.setItem(
      'mf.estimate.g-1',
      JSON.stringify(['j-diag', 'j-diag', 'j-diag']),
    );
    const s = selection();
    s.sync(MILITARI);

    expect(on(s)).toEqual(['j-diag']);
    expect(JSON.parse(stored('g-1') ?? 'null')).toEqual(['j-diag']);
  });

  it('ignores prototype names stored as job ids', () => {
    sessionStorage.setItem(
      'mf.estimate.g-1',
      JSON.stringify(['__proto__', 'constructor', 'toString', 'j-diag']),
    );
    const s = selection();
    s.sync(MILITARI);

    expect(on(s)).toEqual(['j-diag']);
  });

  it.each([
    ['an empty string', ''],
    ['null', 'null'],
    ['a number', '42'],
    ['a string', '"j-diag"'],
    ['a list holding a list', '[["j-diag"]]'],
    ['a list with a number among ids', '["j-diag", 7]'],
  ])('reads %s as nothing on', (_, value) => {
    sessionStorage.setItem('mf.estimate.g-1', value);
    const s = selection();
    s.sync(MILITARI);

    expect(on(s)).toEqual([]);
    expect(s.dropped()).toBe(false);
  });

  it('keeps only the listed jobs out of ten thousand stored ids', () => {
    const many = Array.from({ length: 10_000 }, (_, i) => `j-${i}`);
    sessionStorage.setItem(
      'mf.estimate.g-1',
      JSON.stringify([...many, 'j-brakes']),
    );
    const s = selection();
    s.sync(MILITARI);

    expect(on(s)).toEqual(['j-brakes']);
    expect(JSON.parse(stored('g-1') ?? 'null')).toEqual(['j-brakes']);
  });

  it('does not let a stored selection of another garage leak across', () => {
    sessionStorage.setItem('mf.estimate.g-2', JSON.stringify(['j-diag']));
    const s = selection();
    s.sync(MILITARI);

    expect(on(s)).toEqual([]);
  });

  it('syncing the same garage twice with nothing changed changes nothing', () => {
    sessionStorage.setItem('mf.estimate.g-1', JSON.stringify(['j-diag']));
    const s = selection();
    s.sync(MILITARI);
    s.sync(MILITARI);

    expect(on(s)).toEqual(['j-diag']);
    expect(s.dropped()).toBe(false);
    expect(JSON.parse(stored('g-1') ?? 'null')).toEqual(['j-diag']);
  });

  it('keeps working after a write that was refused once', () => {
    const s = selection();
    s.sync(MILITARI);
    const set = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementationOnce(() => {
        throw new Error('quota');
      });
    s.toggle('j-diag', true);
    expect(on(s)).toEqual(['j-diag']);

    set.mockRestore();
    s.toggle('j-brakes', true);

    expect(on(s)).toEqual(['j-brakes', 'j-diag']);
    expect(JSON.parse(stored('g-1') ?? 'null').sort()).toEqual([
      'j-brakes',
      'j-diag',
    ]);
  });
});

// @traces 356-FR-002 356-FR-009
describe('toggles that do not fit', () => {
  it('does not switch on a job the list does not carry', () => {
    const s = selection();
    s.sync(MILITARI);

    s.toggle('j-unknown', true);

    expect(on(s)).toEqual([]);
    expect(stored('g-1') ?? '[]').not.toContain('j-unknown');
  });

  it('switching on twice leaves the job on once', () => {
    const s = selection();
    s.sync(MILITARI);

    s.toggle('j-diag', true);
    s.toggle('j-diag', true);

    expect(on(s)).toEqual(['j-diag']);
    expect(JSON.parse(stored('g-1') ?? 'null')).toEqual(['j-diag']);
  });

  it('switching off a job that is off leaves the others on', () => {
    const s = selection();
    s.sync(MILITARI);
    s.toggle('j-diag', true);

    s.toggle('j-brakes', false);

    expect(on(s)).toEqual(['j-diag']);
  });

  it('writes nothing under a made-up key when a toggle comes before any sync', () => {
    const s = selection();

    s.toggle('j-diag', true);

    expect(Object.keys(sessionStorage)).toEqual([]);
  });
});

// @traces 356-FR-010
describe('the list read again, hostile', () => {
  it('switches off every job when the list comes back empty, and says so', () => {
    const s = selection();
    s.sync(MILITARI);
    s.toggle('j-diag', true);
    s.toggle('j-brakes', true);

    s.sync(garage('g-1', []));

    expect(on(s)).toEqual([]);
    expect(s.dropped()).toBe(true);
    expect(JSON.parse(stored('g-1') ?? '[]')).toEqual([]);
  });

  it('keeps saying a job went when the same list is read again', () => {
    const s = selection();
    s.sync(MILITARI);
    s.toggle('j-chain', true);
    const reread = garage('g-1', ['j-diag']);
    s.sync(reread);
    expect(s.dropped()).toBe(true);

    s.sync(reread);

    expect(s.dropped()).toBe(true);
    expect(on(s)).toEqual([]);
  });

  it('stops saying a job went when another garage opens', () => {
    const s = selection();
    s.sync(MILITARI);
    s.toggle('j-chain', true);
    s.sync(garage('g-1', ['j-diag']));
    expect(s.dropped()).toBe(true);

    s.sync(DINAMO);

    expect(s.dropped()).toBe(false);
  });

  it('stops saying a job went at a switch off of a job that was off', () => {
    const s = selection();
    s.sync(MILITARI);
    s.toggle('j-chain', true);
    s.sync(garage('g-1', ['j-diag', 'j-brakes']));

    s.toggle('j-brakes', false);

    expect(s.dropped()).toBe(false);
  });

  it('brings back what the garage had on after going to another garage and back', () => {
    const s = selection();
    s.sync(MILITARI);
    s.toggle('j-diag', true);
    s.toggle('j-chain', true);
    s.sync(DINAMO);
    s.toggle('j-brakes', true);

    s.sync(MILITARI);

    expect(on(s)).toEqual(['j-chain', 'j-diag']);
    expect(s.dropped()).toBe(false);
  });

  it('says nothing when a restored job is missing from the list on load', () => {
    sessionStorage.setItem(
      'mf.estimate.g-1',
      JSON.stringify(['j-gone', 'j-also-gone']),
    );
    const s = selection();
    s.sync(MILITARI);

    expect(on(s)).toEqual([]);
    expect(s.dropped()).toBe(false);
  });
});
