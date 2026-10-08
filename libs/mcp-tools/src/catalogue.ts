import type { ToolDefinition } from './registry';
import { getMyAccount } from './tools/get-my-account/get-my-account';

// Every tool the MCP server offers.
export const catalogue: ToolDefinition[] = [getMyAccount];
