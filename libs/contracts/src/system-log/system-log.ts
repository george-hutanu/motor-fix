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

export const SYSTEM_LOG_PAGE = 20;
