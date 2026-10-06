# Research: Set up push notifications

- R1 Sender: `web-push` 3.6.7 (MPL-2.0) does RFC 8291 encryption and RFC 8292 VAPID. Hand-written crypto rejected; Brevo has no browser Web Push API, so push is direct with VAPID keys from the environment.
- R2 Service worker: Angular's ngsw already shows a push whose JSON is `{ notification: {...} }` and handles `data.onActionClick`; no custom worker.
- R3 Payload: `{ notification: { title, body, icon, data: { onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url } } } } }`.
- R4 Tests: the real `web-push` client posts to a recording HTTP server started in the spec (real VAPID keys, real subscription keys), so encryption and headers are exercised.
- R5 Fallback seam: ST-194's `EMAIL_FALLBACK` slot is replaced by the real e-mail to push rule and removed.
