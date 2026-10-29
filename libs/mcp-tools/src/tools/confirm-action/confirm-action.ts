import { ROLES } from '@motor-fix/domain';
import { z } from 'zod';

import { ToolRefusal } from '../../errors';
import { access, defineTool, settle } from '../../registry';

// The person's answer to an action an assistant proposed: the action runs
// here, once, as the grant's actor with every check run again.
export const confirmAction = defineTool({
  acts: true,
  annotations: {
    destructiveHint: true,
    idempotentHint: true,
    readOnlyHint: false,
  },
  description:
    "Carries out an action the person agreed to. An acting tool's first call answers confirmation_required with a confirmationId and a summary: show the person the summary, then call this with their answer (confirmed true for yes, false for no) and the same arguments as that first call. Nothing is sent after 5 minutes or when the arguments differ; ask the person again then. Calling it again answers the first outcome.",
  handler: async (_actor, input, ctx, step) => {
    const name = await ctx.confirmations.toolOf(
      input.confirmationId,
      step.caller.grantId,
    );
    const tool = step.tools.find((t) => t.name === name && t.preview);
    if (!tool) throw new ToolRefusal('not_found');
    const actor = await access(tool, step.caller, ctx);
    if (typeof actor === 'string') throw new ToolRefusal(actor);
    const args = z.object(tool.inputSchema).safeParse(input.arguments);
    if (!args.success) throw new ToolRefusal('validation');
    return settle(
      tool,
      actor,
      args.data,
      ctx,
      step,
      input.confirmationId,
      input.confirmed,
    );
  },
  inputSchema: {
    arguments: z.record(z.string(), z.unknown()),
    confirmationId: z.uuid(),
    confirmed: z.boolean(),
  },
  name: 'confirm_action',
  roles: ROLES,
});
