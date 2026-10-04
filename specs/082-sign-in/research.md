# Research: sign-in

## Password hashing
- Decision: Node's built-in `crypto.argon2('argon2id', …)` (Node 24.7+; `.nvmrc` 24, local 24.21.0), PHC string `$argon2id$v=19$m=19456,t=2,p=1$salt$hash`, 16-byte salt, 32-byte tag; verify recomputes with the stored parameters and compares with `timingSafeEqual`.
- Rationale: argon2id is the Security page's rule; the built-in avoids a native dependency (Principle I). ≈ 37 ms per check locally.
- Alternatives: the `argon2` npm package (native build, a dependency); scrypt (not the rule).

## Session tokens
- Decision: keep ST-79's HS256 access token (`signAccessToken`, 15 minutes). Refresh token = 32 random bytes base64url in `mf_refresh`, `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`, stored as SHA-256; rotation marks the row used and inserts the successor in the same family; reuse after 20 s deletes the family.
- Rationale: Security page ("Refresh tokens are httpOnly, rotate at every use, and reuse closes all sessions"; "Cookies are SameSite and are only used for the refresh call"); Hot paths §3 for the two-tab case. SHA-256 is enough for a 256-bit random value (no salt or slow hash needed).
- CSRF: the cookie is `SameSite=Strict` and path-scoped, so no cross-site request carries it; the access token is a header the browser never adds by itself. The refresh answer is readable only same-origin. No CSRF token is needed.
- Alternatives: `__Host-` cookie prefix (requires `Path=/`, which would send the cookie with every request); a session id in Redis (Redis must not be the only copy, constitution VI).

## Attempt limits
- Decision: Redis `INCR` + `EXPIRE 900` on every counted failure, `GET` both keys before checking; e-mail keyed by SHA-256 of the lower-cased e-mail; Redis errors fail open with one warning log per failure.
- Rationale: Security page ("limited per e-mail and per address", "counted in Redis"); no personal data in Redis keys or logs.

## Client address
- Decision: the web edge appends `req.socket.remoteAddress` to `X-Forwarded-For`; the API sets Express `trust proxy` to `loopback, linklocal, uniquelocal`, so `req.ip` is the right-most address that is not a private hop.
- Rationale: the browser reaches the API only through the edge (`apps/web/src/server/edge.ts`); Railway's private network uses private addresses, so a client cannot spoof its address by sending its own header.

## Cookie reading
- Decision: parse the `Cookie` header for `mf_refresh` in a few lines; set and clear with Express's `res.cookie` / `res.clearCookie`.
- Alternatives: `cookie-parser` (a dependency for one cookie).

## Front end
- Decision: `Session` holds the token; one functional `HttpInterceptorFn`; the dialog is a lazily loaded task in `libs/overlays`' `dialog` shape; the area guard redirects with `RedirectCommand` and navigation `state` so the public frame opens the dialog after a signed-out dashboard visit.
- Rationale: Front end architecture page (session, guards and interceptor; dialogs are not routes). Not a new `libs/auth`: one app uses it (AGENTS.md: a lib is created by the story that first needs it as a lib).
