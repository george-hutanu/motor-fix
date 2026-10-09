import { ROLES } from '@motor-fix/domain';

import { getMyAccount } from './get-my-account';
import { account, caller, context } from '../../fixtures.testing';
import { callTool, visibleTools } from '../../registry';

describe('get_my_account', () => {
  // @traces 365-FR-007
  it('is a read for every role', () => {
    expect(getMyAccount.acts).toBe(false);
    expect(getMyAccount.annotations).toEqual({
      destructiveHint: false,
      readOnlyHint: true,
    });
    expect([...getMyAccount.roles].sort()).toEqual([...ROLES].sort());
  });

  it.each(ROLES)(
    'is listed to a %s under the read-only scope',
    async (role) => {
      const listed = await visibleTools(
        [getMyAccount],
        caller({ mechanic: {}, roles: [role] }, ['motorfix.read']),
        context(),
      );
      expect(listed.map((t) => t.name)).toEqual(['get_my_account']);
    },
  );

  it('answers first name, roles and language, nothing more', async () => {
    const loaded = account({
      language: 'en',
      name: 'Ana Maria Popescu',
      roles: ['driver', 'garage'],
    });
    const activeAccount = jest.fn(async () => loaded);
    const result = await callTool(
      [getMyAccount],
      caller({ roles: ['driver', 'garage'] }, ['motorfix.read']),
      { ...context(), accounts: { activeAccount } },
      'get_my_account',
      {},
    );
    expect(activeAccount).toHaveBeenCalledWith('account-1');
    expect(result.structuredContent).toEqual({
      firstName: 'Ana',
      language: 'en',
      roles: ['driver', 'garage'],
    });
    const text = JSON.stringify(result);
    expect(text).not.toContain('+40712345678');
    expect(text).not.toMatch(/plate/i);
  });
});
