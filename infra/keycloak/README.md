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
  authenticated back channel, so its signature is not checked.
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

## Railway, set up by hand

The staging and production identity server is a Railway service created by
hand, not by `scripts/railway-deploy.ts`:

1. A service from the image `quay.io/keycloak/keycloak:26.8` with the start
   command `start --import-realm --features=cimd,resource-indicators
   --hostname=<public address> --proxy-headers=xforwarded --http-enabled=true`,
   a PostgreSQL database of its own (`KC_DB=postgres`, `KC_DB_URL`,
   `KC_DB_USERNAME`, `KC_DB_PASSWORD`) and a bootstrap admin
   (`KC_BOOTSTRAP_ADMIN_USERNAME`, `KC_BOOTSTRAP_ADMIN_PASSWORD`) removed after
   the first sign-in.
2. This folder's realm file in the image's import folder (a volume or a
   one-line Dockerfile `COPY`), and the placeholders above set on the
   service, without `ASSISTANT_ALLOW_HTTP`.
3. The api and the MCP server given the matching `ASSISTANT_*`, `MCP_URL` and
   `ASSISTANT_ISSUER`.
4. A connection from Claude and from ChatGPT on staging, recorded on the
   story page.
