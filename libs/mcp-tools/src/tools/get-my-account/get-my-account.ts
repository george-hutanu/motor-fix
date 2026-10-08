import { ROLES } from '@motor-fix/domain';
import { z } from 'zod';

import { defineTool } from '../../registry';

export const getMyAccount = defineTool({
  acts: false,
  annotations: { destructiveHint: false, readOnlyHint: true },
  description:
    "Returns the signed-in person's first name, their roles on MotorFix and the language they use.",
  async handler(actor, _input, ctx) {
    const account = await ctx.accounts.activeAccount(actor.accountId);
    return {
      firstName: account.name.trim().split(/\s+/)[0],
      language: account.language,
      roles: account.roles.map((r) => r.role),
    };
  },
  inputSchema: {},
  name: 'get_my_account',
  outputSchema: {
    firstName: z.string(),
    language: z.enum(['ro', 'en']),
    roles: z.array(z.enum(ROLES)),
  },
  roles: ROLES,
});
