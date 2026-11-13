<p align="center">
  <img src="frontend/public/favicon.svg" alt="Translately logo" width="144">
</p>

# Translately

Translately is a self-hosted product for managing translation texts. UI texts are maintained in a web interface per key, language and (optionally) brand, and your app fetches them at runtime as i18next-compatible JSON over an HTTP API (see [Integrating into your app](#integrating-into-your-app)).

> Origin: created as a copy of Togglely `c0c6f20`.

## Features

- **Translations**
  - Texts per key, language and namespace, edited in a compact table; missing texts are marked
  - Brands inherit the standard text; each key row expands into one row per brand, where a brand text can be unlinked (own text) or relinked (inherits again)
  - JSON import with preview and export, per language, namespace and target (standard or one brand)
  - Delivery as i18next JSON (`i18next-http-backend`) with ETag caching
- **User authentication & authorization**
  - JWT-based authentication
  - Role-based access control (Owner, Admin, Member, Viewer)
  - Organization-based multi-tenant architecture
- **Organizations & projects**
  - Multiple organizations per user
  - Projects within organizations
  - Team management with invitations
- **Brands**
  - Optional brands per project
- **Audit logs**
  - Traceability of all changes
  - Filtering by user, project, entity
- **API keys**
  - Expiration dates and revocation
  - Project-bound MCP keys for AI tools (see [MCP](#mcp))
- **Webhooks**
  - Signed POST requests when a project changes

## Quick Start

### Prerequisites

- Docker Engine 25+ with Docker Compose v2 (the MongoDB healthcheck uses `start_interval`, which older engines reject)

The shell commands in this README assume bash; on Windows use Git Bash or WSL (Windows PowerShell 5.1 writes `.env` as UTF-16 with `echo … >` and has no `VAR=… command` form).

### Installation

1. **Clone the repository**

```bash
git clone https://github.com/nuvooo/translately.git
cd translately
```

2. **Create a `.env` with a JWT secret** (required, min. 32 chars)

`docker compose` refuses to start while `JWT_SECRET` is unset or empty. Either create a `.env` that only contains the secret:

```bash
echo "JWT_SECRET=$(openssl rand -hex 32)" > .env
```

or copy the commented example (`cp .env.example .env`) and set `JWT_SECRET=` to the output of `openssl rand -hex 32`. Of the variables in `.env`, `docker-compose.yml` uses `JWT_SECRET`, `FRONTEND_URL`, `CORS_ORIGINS`, `SETUP_TOKEN`, `SKIP_DB_PUSH`, the `WEBHOOK_*` settings, `ANTHROPIC_API_KEY` and `AI_TRANSLATION_MODEL`.

3. **Start Docker Containers**

```bash
docker compose up -d --build
```

4. **Access the application**

- Frontend: http://localhost:3000
- Backend API: http://localhost:4000/api
- Delivery for your apps: http://localhost:4000/sdk/translations/... (also reachable through the frontend, http://localhost:3000/sdk/...)
- API Health: http://localhost:4000/health

On first start the app opens a setup page where you create the first account and organization.

5. **Demo data (optional)**

The seed creates a demo user (`demo@translately.io` / `demo123!`), the project `demo-project` with the languages `de` and `en`, a few texts and a demo API key. It runs from your machine against the MongoDB of the Docker setup (published on `127.0.0.1:27017`) and does nothing if the demo user already exists:

```bash
cd backend
npm install
DATABASE_URL="mongodb://127.0.0.1:27017/translately?directConnection=true" npm run db:seed
```

## Integrating into your app

Your app loads its texts at runtime with [i18next](https://www.i18next.com/) and [i18next-http-backend](https://github.com/i18next/i18next-http-backend). On the Translations page, **Set up for i18next** shows the configuration for the selected brand, for example:

```js
import i18next from 'i18next'
import HttpBackend from 'i18next-http-backend'

i18next.use(HttpBackend).init({
  fallbackLng: 'de',
  backend: {
    loadPath: 'https://translately.example.com/sdk/translations/shop/{{lng}}/{{ns}}',
    customHeaders: { 'x-api-key': '<YOUR_API_KEY>' },
  },
})
```

`fallbackLng` is the first language of the project. Replace `<YOUR_API_KEY>` with an API key of the project's organization (Organization → API Keys; type *Client* for browser and mobile apps).

A runnable example is in [`examples/react-i18next`](examples/react-i18next).

### URL

```
<origin>/sdk/translations/<projectKey>/{{lng}}/{{ns}}[?brandKey=<brandKey>]
```

| Part | Meaning |
|------|---------|
| `<origin>` | Address of the backend (e.g. `http://localhost:4000`). The dashboard's own address works as well: its nginx forwards `/sdk/` to the backend. There is no `/api` prefix. |
| `<projectKey>` | Key of the project (Project → Settings). |
| `{{lng}}` | Filled in by i18next: the language, compared exactly (`pt-BR` and `pt-br` differ). |
| `{{ns}}` | Filled in by i18next: the namespace. i18next uses `translation` unless you configure `ns`; a `.json` suffix is accepted. |
| `?brandKey=` | Optional, Multi-brand projects only: the brand's own texts, the standard texts for every key without one. A brand delivers only the languages of its own language list; other languages return `{}`. An unknown brand key delivers the standard texts. |

The response is the language file as nested i18next JSON (`checkout.title` becomes `{ "checkout": { "title": … } }`). Missing texts are left out, so i18next falls back to `fallbackLng`.

### API key

The backend accepts the key in three ways:

1. the `x-api-key` header (recommended, used by the snippet),
2. `Authorization: Bearer <key>`,
3. the query parameter `?apiKey=<key>` (if several are sent, the query parameter wins, then `Authorization`).

Prefer the header: query strings end up in browser histories and in the logs of proxies in between.

### What a key can read

- A key belongs to one organization and reads the texts of **every project** of that organization: the caller picks the project in the URL. A key cannot be limited to one project.
- A key used in a browser or mobile app is **visible to everyone who opens the app** (it is in the bundle and in every request). Anyone can copy it and read all texts of your organization, for example with `curl`.
- Key types: use a key of type *Client* for apps. The delivery treats Client, Server and the legacy SDK type the same: every key can only read texts, none can change anything, so no type grants more than another. The type only records what the key is meant for; keep keys created as *Server* out of browser code anyway.
- Restrict the project's [allowed origins](#allowed-origins): this stops other websites from loading the texts in a browser, but not requests without an `Origin` header (servers, `curl`).
- Keep texts that must not be readable by your app's users in a separate organization.

### Responses

| Status | When |
|--------|------|
| `200` | The language file. An unknown or invalid language or namespace returns `200 {}`, so i18next does not treat it as an error. |
| `304` | `If-None-Match` matches the current `ETag` (no body). |
| `401` | No API key, an unknown or expired key, or a project that is not in the key's organization. |
| `403` | The request's `Origin` is not in the project's allowed origins. |
| `429` | More than `SDK_RATE_LIMIT_PER_MINUTE` (default 600) requests per minute from one IP address. |

### Caching

Every file carries an `ETag` and `Cache-Control: private, no-cache`: browsers keep a copy but revalidate it on every request, and a request with a matching `If-None-Match` gets `304 Not Modified` without a body. Each change to the texts of a project changes the ETag, so a saved change is delivered with the next request. i18next requests the files when it starts and when you call `i18next.reloadResources()`.

### Allowed origins

Project → Settings → **Allowed origins** controls which websites may load the texts from the browser. An empty list allows every origin. With entries, a request whose `Origin` header is not listed gets `403`. Entries are exact origins (scheme, host and port, e.g. `https://shop.example.com` or `http://localhost:5173` for a local Vite dev server), `*.example.com` (the domain and all its subdomains) or `*` (everyone). Requests without an `Origin` header (servers, scripts) are not restricted by this list.

## MCP

Translately has an [MCP](https://modelcontextprotocol.io) server, so AI tools such as Claude can read and edit the texts of one project. It is part of the backend and needs no extra service.

### Connecting

The endpoint is `POST https://<domain>/api/mcp` (Streamable HTTP, stateless; `GET` and `DELETE` return `405`). Authenticate with a project-bound MCP key as `Authorization: Bearer <key>`. A client configuration looks like this:

```json
{
  "mcpServers": {
    "translately": {
      "type": "http",
      "url": "https://<domain>/api/mcp",
      "headers": { "Authorization": "Bearer tkm_..." }
    }
  }
}
```

### Creating a key

1. Open **API keys** of your organization and click **New API key**.
2. Choose the type **MCP**, give the key a name, choose the project it works on and an expiry.
3. Copy the key or the ready-made client configuration from the dialog. The key is shown only once and cannot be shown again, not even to admins.

Members and above can create MCP keys (other key types need an admin). Below admin, a user sees only their own MCP keys in the list; admins see all of them. Everyone can delete their own MCP keys, whatever their current role; admins can delete any key.

### Tools

All tools work on the one project of the key. Every tool except `get_project` and `add_language` takes an optional `namespace`, which defaults to `translation`.

| Tool | What it does | Needs |
|------|--------------|-------|
| `get_project` | Returns the project's languages, namespaces, brands, the caller's role and whether AI translation is enabled. | Viewer |
| `list_keys` | Lists keys with their texts, 50 per page, optionally filtered by namespace, a search term or `missingOnly`. | Viewer |
| `get_key` | Returns one key with its texts, the languages that are missing and its brand overrides. | Viewer |
| `create_key` | Creates a key, optionally with a description and texts per language. | Member |
| `update_key` | Renames a key or changes its description. A locked key cannot be renamed. | Member |
| `set_translations` | Writes the standard texts of up to 50 keys at once, or the texts of one brand with `brandKey`. Checks everything first. | Member |
| `translate_missing` | Translates missing standard texts from one language into another with the instance's AI. Returns suggestions; with `apply: true` it also stores them. | Member |
| `delete_key` | Deletes a key. Without `confirm: true` it only reports what would be deleted. A locked key cannot be deleted. | Admin |
| `add_language` | Adds one language to the project, or to one brand with `brandKey`. Languages cannot be removed over MCP, because removing one deletes its texts. | Admin |

The role is the creator's current role in the organization; a key never has more rights than its creator. A tool call with too low a role is refused before anything is read or written.

### `translate_missing`

The tool needs the instance's `ANTHROPIC_API_KEY` (see [Environment Variables](#environment-variables)); `get_project` reports `aiTranslationEnabled`. Without the key the tool says so, and the AI tool translates the texts itself and stores them with `set_translations`.

With `apply: true` the suggestions are stored without a human review step. Existing texts are never overwritten, and suggestions whose placeholders differ from the source text are never stored; they are returned separately under `needsReview`. Without `apply` nothing is stored. If storing fails, the suggestions are still returned together with an `applyError`.

### Limits

- 120 requests per minute per key and 600 per minute per IP address; beyond that the endpoint answers with HTTP `429`.
- `translate_missing`: 20 calls per minute per user (shared by all keys of that user, like the AI translation in the web interface) and at most 40 keys per call.
- `set_translations`: at most 50 keys per call.
- Request bodies up to 1 MB.

### Security

An MCP key grants read and write access to one project with the role its creator has. Treat it like a password and give each AI tool its own key.

- Project content is untrusted input for the AI tool. Key names, descriptions and texts are written by other people, and a text written by one member can try to steer another member's agent. Keep tool approval switched on in your client for `delete_key`, `set_translations` and `update_key`.
- A key created by an admin or owner can delete keys and add languages. If the AI tool does not need to do either, create its key from a member account.
- To revoke a key, delete it on the API keys page. Changing your password does not revoke keys.
- A key also stops working when it expires, when the project is deleted, or when its creator is deactivated or removed from the organization; when the creator is removed or leaves, their MCP keys of that organization are deleted.

Changes made through MCP appear in the audit log with the key's name. A `translate_missing` call with `apply: true` is recorded as one entry with the target language and the number of texts stored, not as one entry per text.

Behind a reverse proxy, `/api/mcp` must be forwarded; `translate_missing` can take a while, so the bundled nginx configurations allow a 150 s read timeout for this path.

## Upgrading from a version with environments

Older versions stored every text per environment (Development, Staging, Production). Translately now stores a text once per project as key x language x scope (standard or brand). Breaking changes:

- The delivery URL has no environment segment any more: `/sdk/translations/<projectKey>/{{lng}}/{{ns}}`. There is no redirect from the old path; update the `loadPath` in your apps.
- API keys are not bound to an environment; a key reads all projects of its organization.
- "Copy between environments" is gone. Import and export work per language, namespace and target.
- Webhooks have no environment selection and the payload has no `environment` field.

**The database must be emptied by hand before the first start of the new version.** The backend runs `prisma db push` on every start and refuses to boot if it fails. The unique index of the texts changed from (key, environment, language, scope) to (key, language, scope); existing texts of one key in two environments make the index creation fail, so the backend would not start. There is deliberately no migration script and nothing empties a database automatically. (This follows from reading the Dockerfile and the schema; it has not been tried out.)

**Warning: emptying the database deletes ALL data of the instance** - users, organizations, projects, brands, API keys, webhooks, the audit log and all texts - not only the translation texts. There is no supported way to keep existing data in this version: no migration script exists, and no procedure that keeps users or organizations while removing only the texts has been built or tested. After the upgrade you set the instance up from scratch (setup page, new account and organization, new API keys).

Before you empty the database, export your texts as JSON per language (Translations page, export) so you can import them again afterwards.

With the Docker setup of this repository, stop the stack and remove the data volumes: `docker compose down -v` removes all named volumes of the stack. In `docker-compose.yml` these are `mongodb_data` and `redis_data`; the database is `mongodb_data`. The actual volume name carries the compose project prefix (by default the folder name, for example `<project>_mongodb_data`); `docker volume ls` shows it. To remove only the database, run `docker compose down` and then `docker volume rm <project>_mongodb_data`. Then start again and set up from scratch.

## Project Structure

```
translately/
├── backend/           # NestJS backend API
│   ├── src/
│   │   ├── modules/       # Feature modules (auth, organizations, projects, webhooks, ...)
│   │   └── shared/        # Shared infrastructure
│   └── prisma/            # Database schema
├── frontend/          # React/TypeScript frontend
│   └── src/
│       ├── components/    # React components
│       ├── pages/         # Page components
│       └── store/         # Zustand stores
├── examples/
│   └── react-i18next/ # Standalone example app that loads texts from Translately
└── docker-compose.yml # Docker Compose configuration
```

## Development

### Backend

```bash
cd backend
npm install
npm run start:dev
```

Environment variables:
- `DATABASE_URL` - MongoDB connection URL
- `REDIS_URL` - Redis connection URL
- `JWT_SECRET` - Secret key for JWT
- `PORT` - API port (default: 4000)

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Database Schema

MongoDB has no Prisma migrations: the schema (indexes) is synced with `prisma db push`, which the Docker image runs on every start (unless `SKIP_DB_PUSH=true`). Prisma needs MongoDB as a replica set (see `docker-compose.yml`).

```bash
cd backend
npm run db:push
npm run db:seed   # optional demo data
```

## Webhooks

A project can notify your systems when it changes. Webhooks fire on every text change of the project. Translately sends a signed `POST` request with a JSON body to the URL you configure. Each request carries these headers:

| Header | Content |
|--------|---------|
| `X-Translately-Signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256>` |
| `X-Translately-Delivery` | Unique ID of the delivery |
| `X-Translately-Event` | Type of the event |
| `User-Agent` | `Translately-Webhooks/1` |

The signature is the hex-encoded HMAC-SHA256 of `"<t>.<raw request body>"`, keyed with the webhook secret (`whsec_...`, shown once when the webhook is created). Receivers should recompute the HMAC over the raw body, compare it in constant time and reject requests whose timestamp `t` is too old to prevent replays.

The event type is `translations.changed`; its `changes` array lists what changed, for example `{ "key": "checkout.title", "namespace": "translation", "language": "de", "action": "updated" }` (fields that do not apply are omitted).

By default, private network targets and plain `http://` URLs are blocked (SSRF protection); see `WEBHOOK_ALLOW_PRIVATE` and `WEBHOOK_ALLOW_INSECURE`.

## API Endpoints

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register user |
| POST | `/api/auth/login` | Login |
| GET | `/api/auth/me` | Current user |

### Organizations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/organizations` | List organizations |
| POST | `/api/organizations` | Create organization |
| GET | `/api/organizations/:id` | Organization details |
| GET | `/api/organizations/:id/members` | List members |

### Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/organization/:orgId` | List projects |
| POST | `/api/projects/organization/:orgId` | Create project |
| GET | `/api/projects/:id` | Project details |

## Architecture

### Multi-Tenant Architecture

Translately uses an organization-based multi-tenant architecture:

```
Users
  └── Organizations (Owner, Admin, Member, Viewer)
        └── Projects
              └── Brands
```

### Database

- **MongoDB**: Document-based database for all data
- **Redis**: Caching and change notification

### Security

- Passwords hashed with bcrypt
- JWT for session management
- API keys for access from your applications
- Role-based access control

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | MongoDB URL | - |
| `REDIS_URL` | Redis URL | - |
| `JWT_SECRET` | JWT Secret | - |
| `PORT` | API Port | 4000 |
| `NODE_ENV` | Environment | development |
| `ANTHROPIC_API_KEY` | Enables AI translation of missing texts. Without a key the feature is off and nothing is sent. With a key, key names, descriptions and source texts are sent to Anthropic. | - |
| `AI_TRANSLATION_MODEL` | Claude model used for AI translation. The model must support structured outputs and the `effort` setting; with an unsuitable or mistyped model the feature reports that it is not set up correctly. | `claude-haiku-5-5` |

## Testing

```bash
# Backend Tests
cd backend
npm test

# Frontend Tests
cd frontend
npm test
```

## Deployment

### Docker Production

```bash
# Build
docker compose -f docker-compose.yml build

# Start
docker compose -f docker-compose.yml up -d
```

The `Makefile` wraps the common commands: `make build`, `make up`, `make down`, `make logs`, `make db-push` (schema sync inside the running backend; it also runs on every start), `make seed` (demo data from your machine, as in step 5 of the Quick Start; run `npm install` in `backend/` first) and `make test` (backend and frontend tests on your machine).

### Coolify

See [docs/COOLIFY.md](docs/COOLIFY.md).

### Manual Deployment

1. Install MongoDB and Redis
2. Install Node.js 22+
3. Build and start backend
4. Build and serve frontend

### Password Reset Without Email

Without SMTP, users cannot receive reset mails. Two alternatives:

- **Organization owners** can create a one-time reset link for a member
  (`POST /api/organizations/:id/members/:userId/password-reset-link`).
  This only works if the owner owns *every* organization the user belongs to
  and the user is not an owner of any organization (owners may still reset
  their own account); otherwise the server administrator has to do it.
- **Server administrators** can create a reset link on the server:

```bash
docker exec -it translately-backend node dist/cli reset-password 'user@example.com'
# without Docker: cd backend && npm run cli -- reset-password 'user@example.com'
```

Always wrap the email in single quotes: valid addresses may contain shell
metacharacters such as `$`, `` ` ``, `|` or `&`. A `'` inside the address is
written as `'\''`, e.g. `'o'\''brien@example.com'`.

The link is printed to the terminal, is valid for 1 hour and replaces any
previously issued reset link. No mail is sent. The command boots the backend's
application context: it needs the same environment (database, secrets) as the
server and runs the startup migrations before creating the link. The audit log
records it as `user.password_reset_link_created_by_operator` (actor: server
operator).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT License - see [LICENSE](LICENSE) for details.
