import { isPlatformServer } from '@angular/common';
import type { HttpInterceptorFn } from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';

// A slow API must not hold the whole render: on the server a call gives up
// after 3 s and the component shows the state it has for a failed read; the
// browser then asks again as it does after any failed server read.
const SERVER_TIMEOUT_MS = 3_000;

export const serverTimeoutInterceptor: HttpInterceptorFn = (req, next) =>
  next(
    isPlatformServer(inject(PLATFORM_ID))
      ? req.clone({ timeout: SERVER_TIMEOUT_MS })
      : req,
  );
