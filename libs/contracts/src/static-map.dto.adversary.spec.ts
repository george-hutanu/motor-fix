import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { StaticMapQueryDto } from './static-map.dto';

const VALID = {
  h: '480',
  lat: '44.42681',
  lng: '26.10254',
  theme: 'light',
  w: '640',
  z: '13',
};

function refused(query: Record<string, unknown>) {
  return validateSync(plainToInstance(StaticMapQueryDto, query), {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).map((error) => error.property);
}
const with_ = (over: Record<string, unknown>) => ({ ...VALID, ...over });

// @traces 1196-FR-001
describe('StaticMapQueryDto, zoom', () => {
  it.each([
    '4',
    '17',
    '0',
    '-5',
    '13.5',
    '13.0',
    '1e1',
    '0x0d',
    ' 13',
    '13 ',
    '',
    'abc',
    '99999',
    '123456',
    '٣',
  ])('refuses z=%p', (z) => {
    expect(refused(with_({ z }))).toEqual(['z']);
  });

  it.each(['5', '16', '05'])('takes z=%p', (z) => {
    expect(refused(with_({ z }))).toEqual([]);
  });

  it('refuses a repeated z, a null z and a missing z on z alone', () => {
    expect(refused(with_({ z: ['12', '13'] }))).toEqual(['z']);
    expect(refused(with_({ z: null }))).toEqual(['z']);
    const { z: _z, ...rest } = VALID;
    expect(refused(rest)).toEqual(['z']);
  });
});

// @traces 1196-FR-001
describe('StaticMapQueryDto, centre', () => {
  it.each(['43.5', '48.4', '45', '45.0000000001'])('takes lat=%p', (lat) => {
    expect(refused(with_({ lat }))).toEqual([]);
  });

  it.each([
    '43.49999',
    '48.40001',
    '0',
    '-44.4',
    'NaN',
    'Infinity',
    '-Infinity',
    '1e1',
    '44.',
    '.5',
    '',
    ' 44.4',
    '44,4',
    '44.4.4',
    '0x2c',
    '٤٤',
  ])('refuses lat=%p', (lat) => {
    expect(refused(with_({ lat }))).toEqual(['lat']);
  });

  it.each(['20.2', '29.8'])('takes lng=%p', (lng) => {
    expect(refused(with_({ lng }))).toEqual([]);
  });

  it.each(['20.19999', '29.80001', '-26.1', '180', 'NaN', '1e1', '', 'null'])(
    'refuses lng=%p',
    (lng) => {
      expect(refused(with_({ lng }))).toEqual(['lng']);
    },
  );

  it('refuses a number given as a JSON number outside Romania and a boolean', () => {
    expect(refused(with_({ lat: 50 }))).toEqual(['lat']);
    expect(refused(with_({ lng: true }))).toEqual(['lng']);
  });
});

// @traces 1196-FR-003
describe('StaticMapQueryDto, sizes', () => {
  it.each([
    ['1280', '1024'],
    ['1280', '320'],
    ['320', '1280'],
    ['1024', '1024'],
  ])('takes w=%p h=%p', (w, h) => {
    expect(refused(with_({ h, w }))).toEqual([]);
  });

  it.each([
    ['1280', '1280'],
    ['1281', '480'],
    ['321', '480'],
    ['0', '480'],
    ['640', '0'],
    ['640', '-480'],
    ['640', '480.5'],
    ['', '480'],
  ])('refuses w=%p h=%p', (w, h) => {
    expect(refused(with_({ h, w })).length).toBeGreaterThan(0);
  });

  it('names h when the pair is past 1280 by 1024 at the largest height', () => {
    expect(refused(with_({ h: '1280', w: '1280' }))).toEqual(['h']);
  });

  it('takes a height of 1280 beside a width of 1024, whose area equals 1280 by 1024', () => {
    expect(refused(with_({ h: '1280', w: '1024' }))).toEqual([]);
  });
});

// @traces 1196-FR-001
describe('StaticMapQueryDto, theme and extras', () => {
  it.each(['LIGHT', 'Dark', 'light ', '', 'sepia', '0', 'lığht'])(
    'refuses theme=%p',
    (theme) => {
      expect(refused(with_({ theme }))).toEqual(['theme']);
    },
  );

  it('refuses a theme given twice', () => {
    expect(refused(with_({ theme: ['light', 'dark'] }))).toEqual(['theme']);
  });

  it('refuses an extra field instead of ignoring it', () => {
    expect(refused(with_({ format: 'png' }))).toEqual(['format']);
  });

  it('refuses an empty query on every field', () => {
    expect(refused({}).sort()).toEqual(['h', 'lat', 'lng', 'theme', 'w', 'z']);
  });
});
