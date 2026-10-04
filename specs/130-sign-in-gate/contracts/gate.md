# Contract: the sign-in gate

## API

Every route answers, without a valid bearer access token:

```
HTTP/1.1 401 Unauthorized
Content-Type: application/problem+json
{ "code": "sign_in_required", ... }   # the existing problem shape (ProblemFilter)
```

except the public list, exactly:

| Method | Path |
| --- | --- |
| POST | /api/v1/auth/sign-in |
| POST | /api/v1/auth/sign-up |
| POST | /api/v1/auth/refresh |
| POST | /api/v1/auth/sign-out |
| GET | /health/live |
| GET | /health/ready |

A route joins the list only by carrying `@Public()` (`@motor-fix/domain`). The 401 comes before body validation. The 403 `account_suspended` and the capability 404 are unchanged.

## Web

- A refused call (401 `sign_in_required`, renewal failed) through the HTTP client waits on the one sign-in dialog; signed in → the call is sent again once with the new token; closed → the original error.
- Not gated: `/api/v1/auth/*`, `GET /api/v1/me`, the live stream (`fetch`), the server render.
- Texts: `public.signIn.reason` (shown when the gate opened the dialog), `shell.form.problem.sign_in_required` (a form's message after the dialog was closed): "Intră în cont ca să continui." / "Sign in to continue."
