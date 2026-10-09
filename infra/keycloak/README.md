# The AI assistants' identity server

Claude, ChatGPT and other assistants sign people in to the MotorFix MCP server
(`apps/mcp`) through Keycloak 26.8, realm `motorfix-assistants`. Keycloak
never asks for a password itself: every sign-in goes to the MotorFix sign-in
page through the api's assistant routes (`/api/v1/auth/assistant/*`), and the
token it issues names the MotorFix account in `motorfix_account_id`.

## The realm import

`realm-motorfix-assistants.json` is the whole realm. Keycloak imports it at
start (`--import-realm`, mounted at `/opt/keycloak/data/import`) and fills
its `${…}` placeholders from its own environment:

| Placeholder | What it is |
| --- | --- |
| `MCP_URL` | The MCP server's public address: the tokens' audience and the one resource an assistant may ask for |
| `PUBLIC_WEB_URL` | The web app; the browser goes to its `/api/v1/auth/assistant/authorize` |
| `API_INTERNAL_URL` | The api as Keycloak reaches it, for the token call |
| `ASSISTANT_BROKER_CLIENT_ID`, `ASSISTANT_BROKER_CLIENT_SECRET` | Keycloak's client at the api; the api holds the same values |
| `ASSISTANT_TRUSTED_DOMAINS` | One host trusted besides `claude.ai`, `chatgpt.com` and `openai.com` (Keycloak does not split a list placeholder); unset, it repeats `claude.ai` |
| `ASSISTANT_ALLOW_HTTP` | `true` lets a client document live on `http`; development and CI only, unset elsewhere |

The api's `ASSISTANT_BROKER_REDIRECT_URI` is
`<issuer>/broker/motorfix/endpoint`, where the issuer is the realm's address
as the browser sees it (the MCP server's `ASSISTANT_ISSUER`).

What the realm holds:

- Scopes `motorfix.read` and `motorfix.act`, each with its consent text and
  an audience mapper to `MCP_URL`; a default scope that puts
  `motorfix_account_id` in the access token.
- The identity provider `motorfix` (OpenID Connect, `client_secret_post`),
  the browser flow that goes straight to it and a first sign-in flow that
  creates the user without a profile review. The id token comes back on the
  authenticated back channel, so its signature is not checked: Keycloak 26.8
  checks a brokered token only against a public key (a JWKS address, an
  inline JWKS or a PEM), never the client secret, and the api signs it HS256
  with that secret. Signing it with a published key pair is a debt task.
- Access tokens for 15 minutes; refresh tokens rotate and are never reused.
- Client ID Metadata Documents: a client whose id is an address on a trusted
  domain is accepted, may only ask for `MCP_URL`, and may send people back to
  `localhost` (Claude Code's callback).
- Anonymous dynamic client registration, limited to the two scopes, with
  consent, for clients from the trusted hosts.

Locally: `docker compose --profile assistants up -d --wait keycloak`, then
`http://127.0.0.1:8081` (admin `admin` / `admin`, development only). The
realm is imported only when it does not exist yet: recreate the container
(`--force-recreate`) after changing the file. CI's E2E job starts it the same
way and runs `apps/web-e2e/src/assistant-connect.spec.ts` against it.

## ChatGPT connects through registration

Keycloak refuses ChatGPT's client document: ChatGPT publishes
`token_endpoint_auth_methods_supported` where the specification asks for
`token_endpoint_auth_method`. ChatGPT then registers itself through dynamic
client registration, which the realm allows for its hosts. Claude Code and
Claude Desktop use their client documents.

## Railway: staging only

Staging only: production runs neither the identity server nor the MCP server.
The release workflow builds this folder's `Dockerfile` (Keycloak with the
realm baked in) and `scripts/railway-deploy.ts` deploys both services after
the api, worker and web, each waiting for its health check: Keycloak's is `/realms/master`, which
answers only once the realm import has finished (Railway refuses a path with
a `.` or a `-`), the MCP server's is `/health/live`. Until the
owner has created a service and set its id, the release skips it with a
notice.

Every value below is set by the owner on Railway or GitHub; this file holds
names only. A row marked *secret* is generated and never pasted anywhere
else; *address* is a public or internal address; *name* is a plain value.

1. Create two services in the staging environment from an empty image: `mcp`
   and `keycloak` (target port 8080, a public domain on each).
2. In the staging PostgreSQL, create a database and a role for Keycloak, apart
   from the app's own.
3. Set the variables:

   On the api and the MCP server (the same six on both, as the Build brief
   lists them):

   | Variable | Kind | What it is |
   | --- | --- | --- |
   | `MCP_URL` | address | The MCP server's public address, ending in `/mcp` |
   | `ASSISTANT_ISSUER` | address | The realm's public address (`<keycloak>/realms/motorfix-assistants`) |
   | `ASSISTANT_TRUSTED_DOMAINS` | name | Left unset unless a further host is trusted |
   | `ASSISTANT_BROKER_CLIENT_ID` | name | Keycloak's client at the api |
   | `ASSISTANT_BROKER_CLIENT_SECRET` | secret | Generated once; the same value on Keycloak |
   | `ASSISTANT_BROKER_REDIRECT_URI` | address | `<issuer>/broker/motorfix/endpoint` |

   On the MCP server only:

   | Variable | Kind | What it is |
   | --- | --- | --- |
   | `DATABASE_URL` | secret | The app's staging database, as the api has it |
   | `APP_ENV` | name | `staging` |
   | `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_EXPORTER_OTLP_PROTOCOL` | address, secret, name | Grafana Cloud, as the api has them |

   On Keycloak:

   | Variable | Kind | What it is |
   | --- | --- | --- |
   | `KC_DB` | name | `postgres` |
   | `KC_DB_URL` | address | The Keycloak database from step 2, as a JDBC address |
   | `KC_DB_USERNAME`, `KC_DB_PASSWORD` | name, secret | The role from step 2 |
   | `KC_HOSTNAME` | address | Keycloak's public address |
   | `KC_BOOTSTRAP_ADMIN_USERNAME`, `KC_BOOTSTRAP_ADMIN_PASSWORD` | name, secret | The first admin, removed after the first sign-in |
   | `MCP_URL` | address | As on the api |
   | `PUBLIC_WEB_URL` | address | The staging web app |
   | `API_INTERNAL_URL` | address | The api on Railway's private network |
   | `ASSISTANT_BROKER_CLIENT_ID`, `ASSISTANT_BROKER_CLIENT_SECRET` | name, secret | The same values as the api |
   | `ASSISTANT_TRUSTED_DOMAINS` | name | Left unset unless a further host is trusted |

   `ASSISTANT_ALLOW_HTTP` is not set on staging: it is for development and CI only.
4. On the GitHub `staging` environment, set the variables
   `RAILWAY_SERVICE_MCP` and `RAILWAY_SERVICE_KEYCLOAK` to the two services'
   ids. The next release deploys both.
5. Sign in to Keycloak's admin console once with the bootstrap admin, create a
   permanent admin, then remove the bootstrap one.
6. Import `infra/observability/alerts/mcp.json` into Grafana Cloud: it carries
   `mcp-down` and `mcp-issuer-unreachable` for these two services.
7. Connect Claude and ChatGPT to the staging MCP server and record the result
   on the story pages.

Known limit: the realm is imported only when it does not exist yet. A change
to `realm-motorfix-assistants.json` reaches staging through the admin console
(or by deleting the realm before a release), never by the release alone.
