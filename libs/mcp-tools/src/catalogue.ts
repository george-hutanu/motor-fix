import type { ToolDefinition } from './registry';
import { getMyAccount } from './tools/get-my-account/get-my-account';

export const catalogue: ToolDefinition[] = [getMyAccount];
