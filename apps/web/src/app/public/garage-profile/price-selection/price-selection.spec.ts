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

function selection(platform = 'browser') {
  TestBed.configureTestingModule({
    providers: [PriceSelection, { provide: PLATFORM_ID, useValue: platform }],
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

// @traces 356-live-estimate-FR-002
describe('the jobs switched on', () => {
  it('starts with nothing on', () => {
    const s = selection();
    s.sync(MILITARI);

    expect(on(s)).toEqual([]);
    expect(s.dropped()).toBe(false);
  });

  it('turns a job on and off again', () => {
    const s = selection();
    s.sync(MILITARI);

    s.toggle('j-diag', true);
    s.toggle('j-brakes', true);
    expect(on(s)).toEqual(['j-brakes', 'j-diag']);

    s.toggle('j-brakes', false);
    expect(on(s)).toEqual(['j-diag']);
  });
});

// @traces 356-live-estimate-FR-009
describe('the jobs kept for the session', () => {
  it('writes the jobs on under the garage, as a list of ids', () => {
    const s = selection();
    s.sync(MILITARI);
    s.toggle('j-diag', true);
    s.toggle('j-brakes', true);

    expect(JSON.parse(stored('g-1') ?? 'null').sort()).toEqual([
      'j-brakes',
      'j-diag',
    ]);
  });

  it('restores the jobs on when the same garage opens again', () => {
    sessionStorage.setItem('mf.estimate.g-1', JSON.stringify(['j-diag']));
    const s = selection();
    s.sync(MILITARI);

    expect(on(s)).toEqual(['j-diag']);
    expect(s.dropped()).toBe(false);
  });

  it('starts another garage with nothing on, and keeps each garage its own', () => {
    const s = selection();
    s.sync(MILITARI);
    s.toggle('j-diag', true);

    s.sync(DINAMO);
    expect(on(s)).toEqual([]);
    expect(s.changes()).toBe(0);
    s.toggle('j-brakes', true);

    s.sync(MILITARI);
    expect(on(s)).toEqual(['j-diag']);
    expect(JSON.parse(stored('g-2') ?? 'null')).toEqual(['j-brakes']);
  });

  it.each([
    ['not json', '{oops'],
    ['not a list', '{"j-diag":true}'],
    ['a list of other things', '[1,null]'],
  ])('reads %s as nothing on', (_, value) => {
    sessionStorage.setItem('mf.estimate.g-1', value);
    const s = selection();
    s.sync(MILITARI);

    expect(on(s)).toEqual([]);
  });

  it('drops a restored job the list no longer carries, silently, and forgets it', () => {
    sessionStorage.setItem(
      'mf.estimate.g-1',
      JSON.stringify(['j-diag', 'j-gone']),
    );
    const s = selection();
    s.sync(MILITARI);

    expect(on(s)).toEqual(['j-diag']);
    expect(s.dropped()).toBe(false);
    expect(JSON.parse(stored('g-1') ?? 'null')).toEqual(['j-diag']);
  });

  it('keeps working for the open page when storage is refused', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const s = selection();
    s.sync(MILITARI);
    s.toggle('j-diag', true);

    expect(on(s)).toEqual(['j-diag']);
  });

  it('reads and writes nothing on the server', () => {
    sessionStorage.setItem('mf.estimate.g-1', JSON.stringify(['j-diag']));
    const s = selection('server');
    s.sync(MILITARI);
    s.toggle('j-brakes', true);

    expect(on(s)).toEqual(['j-brakes']);
    expect(JSON.parse(stored('g-1') ?? 'null')).toEqual(['j-diag']);
  });
});

// @traces 356-live-estimate-FR-010
describe('the list read again', () => {
  it('switches off a job no longer listed and says one went', () => {
    const s = selection();
    s.sync(MILITARI);
    s.toggle('j-diag', true);
    s.toggle('j-chain', true);

    s.sync(garage('g-1', ['j-diag', 'j-brakes']));

    expect(on(s)).toEqual(['j-diag']);
    expect(s.dropped()).toBe(true);
    expect(JSON.parse(stored('g-1') ?? 'null')).toEqual(['j-diag']);
  });

  it('keeps a job still listed on, and says nothing', () => {
    const s = selection();
    s.sync(MILITARI);
    s.toggle('j-diag', true);

    s.sync(garage('g-1', ['j-chain', 'j-diag']));

    expect(on(s)).toEqual(['j-diag']);
    expect(s.dropped()).toBe(false);
  });

  it('stops saying a job went at the next switch change', () => {
    const s = selection();
    s.sync(MILITARI);
    s.toggle('j-chain', true);
    s.sync(garage('g-1', ['j-diag']));

    s.toggle('j-diag', true);

    expect(s.dropped()).toBe(false);
  });

  it('leaves a job that went off when it comes back', () => {
    const s = selection();
    s.sync(MILITARI);
    s.toggle('j-chain', true);
    s.sync(garage('g-1', ['j-diag']));

    s.sync(MILITARI);

    expect(on(s)).toEqual([]);
  });
});
