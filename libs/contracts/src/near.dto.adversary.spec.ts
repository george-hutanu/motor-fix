import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { NearQueryDto } from './near.dto';
import { inRomania } from './place-section';
import { nearOf, parseNear, roundCoordinate } from './search-place';

const check = (near: unknown) =>
  validateSync(plainToInstance(NearQueryDto, { near }), {
    forbidNonWhitelisted: true,
    whitelist: true,
  });

describe('NearQueryDto against hostile places', () => {
  it.each([
    ['padded with a space', ' 46.771,23.624'],
    ['trailing space', '46.771,23.624 '],
    ['hexadecimal', '0x2e,25'],
    ['exponent', '4.6e1,2.3e1'],
    ['Arabic-Indic digits', '٤٦.٧٧١,٢٣.٦٢٤'],
    ['a semicolon', '46.771;23.624'],
    ['a trailing comma', '46.771,23.624,'],
    ['a leading comma', ',46.771,23.624'],
    ['only a comma', ','],
    ['Infinity', 'Infinity,Infinity'],
    ['a newline inside', '46.771,\n23.624'],
    ['a sql fragment', "46.771,23.624'; drop table garage;--"],
  ])('refuses a place %s', (_, near) => {
    expect(check(near)).not.toEqual([]);
  });

  it.each([
    ['an array', ['46.771,23.624', '44.43,26.10']],
    ['an array of one', ['46.771,23.624']],
    ['a number', 46.771],
    ['an object', { lat: 46.771, lng: 23.624 }],
    ['a boolean', true],
  ])('refuses %s in place of a string', (_, near) => {
    expect(check(near)).not.toEqual([]);
  });

  it('treats null like no place', () => {
    expect(check(null)).toEqual([]);
  });

  it('refuses a place a hair past the northern edge once rounded', () => {
    expect(check('48.4006,25')).not.toEqual([]);
  });

  it('whatever it accepts reads back as a finite point in Romania', () => {
    const candidates = [
      '46.771,23.624',
      '43.5,20.2',
      '48.4,29.8',
      '48.4,20.2',
      '43.5,29.8',
      '46.771, 23.624',
      '46.771,+23.624',
      '+46.771,23.624',
      '46,23',
      '46.,23.',
      '.5,25',
      '46.7710000000001,23.62400000001',
    ];
    for (const near of candidates) {
      if (check(near).length > 0) continue;
      const point = parseNear(near);
      expect(point).toBeDefined();
      expect(Number.isFinite(point?.lat)).toBe(true);
      expect(Number.isFinite(point?.lng)).toBe(true);
      expect(inRomania(point?.lat ?? NaN, point?.lng ?? NaN)).toBe(true);
    }
  });
});

describe('the search place helpers', () => {
  it('rounds a value already at three decimals to itself', () => {
    for (const v of [46.771, 23.624, 43.5, 29.8, 20.2]) {
      expect(roundCoordinate(v)).toBe(v);
    }
  });

  it('gives the same text when a written place is read and written again', () => {
    const near = nearOf({ lat: 46.7712345, lng: 23.6236789 });
    const point = parseNear(near);
    expect(point).toBeDefined();
    expect(nearOf(point as { lat: number; lng: number })).toBe(near);
  });

  it('writes a whole-degree place without trailing zeros', () => {
    expect(nearOf({ lat: 46, lng: 25 })).toBe('46,25');
  });

  it('keeps a place on the box edge inside Romania after rounding', () => {
    const point = parseNear('48.4004,29.7996');
    expect(point).toEqual({ lat: 48.4, lng: 29.8 });
    expect(inRomania(point?.lat ?? NaN, point?.lng ?? NaN)).toBe(true);
  });
});
