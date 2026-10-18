import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { PublicGarageDto } from '@motor-fix/data-access';

import { PriceSelection } from './price-selection';

const garage = (id: string, jobs: string[]) =>
  ({
    id,
    prices: jobs.map((jobTypeId) => ({
      fromBani: 1,
      jobTypeId,
      nameEn: jobTypeId,
      nameRo: jobTypeId,
      toBani: 2,
    })),
  }) as unknown as PublicGarageDto;

function make(platform: string) {
  sessionStorage.clear();
  TestBed.configureTestingModule({
    providers: [PriceSelection, { provide: PLATFORM_ID, useValue: platform }],
  });
  return TestBed.inject(PriceSelection);
}

afterEach(() => TestBed.resetTestingModule());

// @traces 311-FR-003 311-FR-010
describe('when the kept jobs count as applied', () => {
  it('is false before any sync', () => {
    expect(make('browser').applied()).toBe(false);
  });

  it('turns true after a browser sync, even of a garage with no prices', () => {
    const selection = make('browser');
    selection.sync(garage('g-1', []));

    expect(selection.applied()).toBe(true);
  });

  it('stays false on the server after a sync', () => {
    const selection = make('server');
    selection.sync(garage('g-1', ['a']));

    expect(selection.applied()).toBe(false);
  });

  it('stays true when another garage is synced and when the same one is read again', () => {
    const selection = make('browser');
    selection.sync(garage('g-1', ['a']));
    selection.sync(garage('g-2', ['b']));
    selection.sync(garage('g-2', ['b']));

    expect(selection.applied()).toBe(true);
  });

  it('is true once the stored jobs are in place', () => {
    const first = make('browser');
    first.sync(garage('g-1', ['a']));
    first.toggle('a', true);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        PriceSelection,
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });
    const second = TestBed.inject(PriceSelection);
    second.sync(garage('g-1', ['a']));

    expect(second.applied()).toBe(true);
    expect([...second.on()]).toEqual(['a']);
  });
});
