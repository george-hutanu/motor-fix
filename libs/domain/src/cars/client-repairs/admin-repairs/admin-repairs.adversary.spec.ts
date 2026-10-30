import { HttpException } from '@nestjs/common';

import { idOr404 } from './admin-repairs';
import { ADMIN_SCOPE, garageScope, LIST_LIMIT } from '../client-repairs';

const statusOf = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return (error as HttpException).getStatus();
  }
  return null;
};

// @traces 1267-FR-006
describe('the admin scope and the garage scope', () => {
  it('reaches every logged repair not deleted and filters on nothing else', () => {
    expect(ADMIN_SCOPE.capability).toBe('admin.users');
    expect(ADMIN_SCOPE.where).toStrictEqual({
      deletedAt: null,
      source: 'logged',
    });
  });

  it.each([
    ['no garage id', {}],
    ['an undefined garage id', { garageId: undefined }],
    ['a null garage id', { garageId: null }],
    ['an empty garage id', { garageId: '' }],
  ])('gives an actor with %s no scope', (_title, actor) => {
    expect(garageScope(actor as never)).toBeNull();
  });

  it('keeps the garage scope to shared repairs of its approved garage, whatever the actor', () => {
    const scope = garageScope({ garageId: 'g1' });
    expect(scope?.capability).toBe('garage.client_repairs');
    expect(scope?.where).toMatchObject({
      deletedAt: null,
      garage: { status: 'approved' },
      garageId: 'g1',
      sharedWithGarage: true,
      source: 'logged',
    });
  });

  it('builds a scope per call, so two garages never share a filter', () => {
    const first = garageScope({ garageId: 'g1' });
    const second = garageScope({ garageId: 'g2' });
    expect(first?.where.garageId).toBe('g1');
    expect(second?.where.garageId).toBe('g2');
    expect(garageScope({ garageId: 'g1' })).toEqual(first);
  });

  it('leaves the admin scope without a garage or sharing condition', () => {
    expect(Object.keys(ADMIN_SCOPE.where)).not.toContain('garageId');
    expect(Object.keys(ADMIN_SCOPE.where)).not.toContain('sharedWithGarage');
    expect(Object.keys(ADMIN_SCOPE.where)).not.toContain('garage');
  });
});

// @traces 1267-FR-001
describe('the list cap', () => {
  it('is 200', () => {
    expect(LIST_LIMIT).toBe(200);
  });
});

// @traces 1267-FR-001 1267-FR-003
describe('idOr404 under hostile ids', () => {
  it.each([
    ['empty', ''],
    ['a space', ' '],
    [
      'a uuid with a trailing newline',
      '6f1c0c5e-2b7a-4d1e-9a3b-8c4d5e6f7a80\n',
    ],
    ['a uuid with a leading space', ' 6f1c0c5e-2b7a-4d1e-9a3b-8c4d5e6f7a80'],
    ['a uuid in braces', '{6f1c0c5e-2b7a-4d1e-9a3b-8c4d5e6f7a80}'],
    ['a uuid without dashes', '6f1c0c5e2b7a4d1e9a3b8c4d5e6f7a80'],
    ['a sql fragment', "' OR 1=1 --"],
    ['a path climb', '../accounts'],
    ['the word null', 'null'],
    ['unicode digits', '６f1c0c5e-2b7a-4d1e-9a3b-8c4d5e6f7a80'],
    ['a uuid with a suffix', '6f1c0c5e-2b7a-4d1e-9a3b-8c4d5e6f7a80x'],
  ])('answers %s as 404', (_title, id) => {
    expect(statusOf(() => idOr404(id, 'repair'))).toBe(404);
    expect(statusOf(() => idOr404(id, 'account'))).toBe(404);
  });

  it('returns an upper-case uuid as written', () => {
    const id = '6F1C0C5E-2B7A-4D1E-9A3B-8C4D5E6F7A80';
    expect(idOr404(id, 'repair')).toBe(id);
  });
});
