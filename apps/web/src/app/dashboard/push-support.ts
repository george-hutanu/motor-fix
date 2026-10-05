import { InjectionToken } from '@angular/core';

export type PushSupport = 'ios-hint' | 'unsupported' | 'supported';

// What the browser says about itself, read once per call so a spec can lie.
export interface PushEnv {
  userAgent: string;
  maxTouchPoints: number;
  // Running from the Home Screen rather than a browser tab.
  standalone: boolean;
  hasPushManager: boolean;
  permission: () => NotificationPermission;
}

const IPHONE_OR_IPAD = /iPhone|iPad|iPod/;

// An iPad that asks for the desktop site calls itself a Mac with a touch screen.
const isApple = ({ maxTouchPoints, userAgent }: PushEnv) =>
  IPHONE_OR_IPAD.test(userAgent) ||
  (/Macintosh/.test(userAgent) && maxTouchPoints > 1);

// iOS and iPadOS show web push only to an app added to the Home Screen, and
// hide `PushManager` from a tab, so the hint comes before the support check.
export function pushSupport(env: PushEnv): PushSupport {
  if (isApple(env) && !env.standalone) return 'ios-hint';
  return env.hasPushManager ? 'supported' : 'unsupported';
}

export const PUSH_ENV = new InjectionToken<PushEnv>('PUSH_ENV', {
  factory: () => {
    if (typeof window === 'undefined') {
      return {
        hasPushManager: false,
        maxTouchPoints: 0,
        permission: () => 'default',
        standalone: false,
        userAgent: '',
      };
    }
    return {
      hasPushManager: 'PushManager' in window && 'Notification' in window,
      maxTouchPoints: navigator.maxTouchPoints,
      permission: () =>
        'Notification' in window ? Notification.permission : 'default',
      standalone:
        window.matchMedia('(display-mode: standalone)').matches ||
        (navigator as { standalone?: boolean }).standalone === true,
      userAgent: navigator.userAgent,
    };
  },
});
