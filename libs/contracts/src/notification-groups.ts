// The driver's notification switches. Free of server imports, so the web
// app reads them through @motor-fix/contracts/notification-groups.
export const NOTIFICATION_GROUPS = [
  'offers',
  'bookings',
  'due_dates',
  'news',
  'reviews_history',
] as const;

export type NotificationGroupKey = (typeof NOTIFICATION_GROUPS)[number];
