import type { ToolDefinition } from './registry';
import { declineQuoteRequest } from './tools/decline-quote-request/decline-quote-request';
import { getDaySheet } from './tools/get-day-sheet/get-day-sheet';
import { getMyAccount } from './tools/get-my-account/get-my-account';
import { getSchedule } from './tools/get-schedule/get-schedule';
import { getStats } from './tools/get-stats/get-stats';
import { listQuoteRequests } from './tools/list-quote-requests/list-quote-requests';

export const catalogue: ToolDefinition[] = [
  getMyAccount,
  listQuoteRequests,
  getSchedule,
  getDaySheet,
  getStats,
  declineQuoteRequest,
];
