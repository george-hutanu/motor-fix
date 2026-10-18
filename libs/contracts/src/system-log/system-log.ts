import type { LiveMessage } from '../live.dto';

// The system log's names and page size, apart from the query rules that
// read them.
export const SYSTEM_LOG_KINDS = [
  'status_changed',
  'check_failed',
  'job_failed',
  'service_error',
  'server_error',
  'backup_completed',
  'backup_failed',
  'deploy',
] as const;
export type SystemLogKind = (typeof SYSTEM_LOG_KINDS)[number];

export const SYSTEM_LOG_SOURCES = [
  'api',
  'search',
  'maps',
  'email',
  'notifications',
  'backup',
  'worker',
  'webrtc',
  'identity',
  'storage',
] as const;
export type SystemLogSource = (typeof SYSTEM_LOG_SOURCES)[number];

export const SYSTEM_LOG_SEVERITIES = ['info', 'warning', 'error'] as const;
export type SystemLogSeverity = (typeof SYSTEM_LOG_SEVERITIES)[number];

export const SYSTEM_LOG_PAGE = 20;
export const SYSTEM_LOG_PAGE_MAX = 50;
// The worker purges older entries, so no read reaches further back.
export const SYSTEM_LOG_RETENTION_DAYS = 90;
export const SYSTEM_LOG_SEARCH_MIN = 2;
export const SYSTEM_LOG_SEARCH_MAX = 100;

// Enough for an open view to tell whether a new entry passes its filters.
export interface SystemLogAddedMessage extends LiveMessage {
  kind: 'system_log.added';
  entryKind: SystemLogKind;
  severity: SystemLogSeverity;
  source: SystemLogSource;
}
