# Deploy Translately on Coolify

This describes the files in this repository for a [Coolify](https://coolify.io/) deployment. The Coolify setup has not been tested on a real Coolify instance yet; check each step against your Coolify version.

## Resource

1. Create a new resource in Coolify and choose **Docker Compose**.
2. Select this repository and the file `docker-compose.coolify.yml`.

It starts four services on one internal network: `mongodb` (replica set `rs0`, no authentication, no published port), `redis`, `backend` (port 4000, only exposed to the network) and `frontend` (nginx, published on `${FRONTEND_PORT:-3000}`).

Give the **frontend** service your domain. Its nginx serves the dashboard and forwards `/api/` and `/sdk/` to the backend, so one domain covers the dashboard, the API and the delivery of texts to your apps (`https://<domain>/sdk/translations/...`). Keep `VITE_API_URL=/api`.

AI tools reach the MCP server at `https://<domain>/api/mcp` (see the README, section "MCP"). The frontend's nginx forwards this path to the backend with a 150 s read timeout, because `translate_missing` calls the AI. If you put another proxy in front, forward `/api/mcp` as well and allow at least that timeout.

## Environment variables

Set these in the Coolify UI (defaults from `docker-compose.coolify.yml`):

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `JWT_SECRET` | yes | – | At least 32 characters, e.g. `openssl rand -hex 32`. The backend refuses to start with a weak secret. |
| `FRONTEND_URL` | yes | – | Public URL of the dashboard, used for links in emails. |
| `CORS_ORIGINS` | no | `FRONTEND_URL` | Origins allowed to call `/api` from a browser (comma-separated). The delivery under `/sdk/` is controlled per project instead (Project → Settings → Allowed origins). |
| `SETUP_TOKEN` | recommended | – | The first-run setup (`/setup`) asks for this token, so only you can claim a fresh instance. |
| `METRICS_TOKEN` | no | – | Bearer token for `/metrics`; disabled in production when unset. |
| `ANTHROPIC_API_KEY` | no | – | Enables AI translation of missing texts. Without a key the feature is off and nothing is sent. With a key, key names, descriptions and source texts are sent to Anthropic. |
| `AI_TRANSLATION_MODEL` | no | `claude-haiku-5-5` | Claude model used for AI translation. The model must support structured outputs and the `effort` setting; with an unsuitable or mistyped model the feature reports that it is not set up correctly. |
| `SDK_RATE_LIMIT_PER_MINUTE` | no | `600` | Per-IP requests per minute on the delivery routes. |
| `SKIP_DB_PUSH` | no | `false` | `true` skips the schema/index sync (`prisma db push`) on backend start. |
| `WEBHOOK_ALLOW_PRIVATE`, `WEBHOOK_ALLOW_INSECURE`, `WEBHOOK_WORKER_DISABLED` | no | `false` | Allow webhook targets in private networks, allow plain `http://` targets, switch the delivery worker off. |
| `DATABASE_URL`, `REDIS_URL` | no | the bundled `mongodb` / `redis` services | Only for an external database or Redis. MongoDB must run as a replica set. |
| `FRONTEND_PORT` | no | `3000` | Published port of the frontend. |
| `VITE_API_URL` | no | `/api` | Baked into the dashboard at build time. Keep `/api`. |

Mail (`SMTP_*`) is not passed by `docker-compose.coolify.yml`; add the variables to the backend service if you need password-reset and invitation mails.

## Volumes

| Volume | Path | Content |
|--------|------|---------|
| `mongodb_data` | `/data/db` | MongoDB data |
| `redis_data` | `/data` | Redis data |
| `uploads` | `/app/uploads` | Uploaded files |

## Health checks

- Backend: `GET /api/health` (used by the compose healthcheck); `GET /api/health/deep` also checks the database.
- Frontend: `GET /`.

## After the first deploy

Open the domain: the app shows the setup page, where you create the first account and organization (with `SETUP_TOKEN` set, it asks for the token).

## Upgrading from a version with environments

Older versions stored texts per environment; the new version stores them once per project and the delivery URL has no environment segment any more (`https://<domain>/sdk/translations/<projectKey>/{{lng}}/{{ns}}`, no redirect from the old path).

**Empty the database by hand before the first start of the new version.** The backend runs `prisma db push` on every start and refuses to boot if it fails. The unique index of the texts changed from (key, environment, language, scope) to (key, language, scope), so existing texts of one key in two environments make the index creation fail. There is deliberately no migration script and nothing empties a database automatically. (This follows from reading the Dockerfile and the schema; it has not been tried out.)

**Warning: emptying the database deletes ALL data of the instance** - users, organizations, projects, brands, API keys, webhooks, the audit log and all texts - not only the translation texts. There is no supported way to keep existing data in this version: no migration script exists, and no procedure that keeps users or organizations while removing only the texts has been built or tested. After the upgrade you set the instance up from scratch (setup page, new account and organization, new API keys).

Before you empty the database, export your texts as JSON per language (Translations page, export) so you can import them again afterwards.

In Coolify: stop the resource, delete the MongoDB data volume (`mongodb_data` in `docker-compose.coolify.yml`; Coolify shows it under a name prefixed by Coolify, so look for a volume ending in `mongodb_data`, and do not delete `uploads` or `redis_data` by mistake), deploy again and run the setup page anew.
