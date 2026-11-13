# Example: React + i18next + Translately

A minimal Vite + React app that loads its texts at runtime from Translately, with
[i18next](https://www.i18next.com/), [react-i18next](https://react.i18next.com/) and
[i18next-http-backend](https://github.com/i18next/i18next-http-backend). It is the
customer side of Translately: the i18next setup in `src/main.tsx` is the one the
Translations page shows under "Set up for i18next", plus the start language, the
namespace and a language switcher.

The app shows `checkout.title`, `checkout.submit` and `cart.empty`, a button per
language and a **Reload** button ("Neu laden" while German is selected) that fetches
the texts again without restarting the app.

This folder is a standalone npm project. It is not part of the Translately build,
its Docker images or its CI.

## Prerequisites

- Node.js 22 or newer
- A running Translately, e.g. the Docker setup from the [root README](../../README.md)
  (dashboard on http://localhost:3000, API and delivery on http://localhost:4000)
- A project with texts. The demo data of the seed fits this example: project
  `demo-project` with the languages `de` and `en` and the keys used above. To load it into the Docker setup
  (MongoDB is published on `127.0.0.1:27017`):

  ```bash
  cd backend
  npm install
  DATABASE_URL="mongodb://127.0.0.1:27017/translately?directConnection=true" npm run db:seed
  ```

  The seed does nothing if its demo user (`demo@translately.io`) already exists.
- An API key of the project's organization: in the dashboard under
  **Organization → API Keys → New API key** (type _Client_ is meant for browser
  apps). The seed also creates a demo key; it is printed at the end of the seed
  output and is meant for local testing only.

## Configure

```bash
cd examples/react-i18next
cp .env.example .env
```

In `.env`:

- `VITE_LOAD_PATH`: delivery URL with the placeholders `{{lng}}` and `{{ns}}`:
  `<origin>/sdk/translations/<projectKey>/{{lng}}/{{ns}}`,
  optionally followed by `?brandKey=<brand key>`. The dialog "Set up for i18next"
  on the Translations page shows it for the project and the chosen brand.
- `VITE_API_KEY`: the API key, sent as `x-api-key` header.
- `VITE_LANGUAGES`: optional, comma-separated, default `de,en`. The first language
  is the start and fallback language.

`.env` is git-ignored. Vite reads it only at start: restart `npm run dev` after
every change.

**The key is public.** Vite builds `VITE_API_KEY` into the JavaScript bundle, so
everyone who opens the app can read it. With it they can read the texts of every
project of your organization (the caller chooses the project in the URL; a key
cannot be limited to one of them). Use a key of type
_Client_ for apps. The delivery treats all key types the same: every key can only
read texts and none grants more than another. Restrict the project's allowed origins
(see "403" below); this stops other websites from loading the texts in a browser,
but not requests without an `Origin` header such as `curl`.

## Run

```bash
npm install && npm run dev
```

Open http://localhost:5173 (the port is fixed so that it matches the origin you allow
in the project, see below).

With the seed project you should see "Kasse", "Ihr Warenkorb ist
leer" and a button "Jetzt kaufen"; after switching to `en`: "Checkout", "Your cart
is empty", "Buy now".

A text that is missing in the selected language is taken from the first language
(i18next's `fallbackLng`); a key without any text is shown as the key itself.

## Try it out

**Change a text.** Open the project in the dashboard (Translations), change the
German text of `checkout.title`, then click **Neu laden** in the
example. The new text appears; no restart is needed. Every request is revalidated
with the server (`ETag` / `If-None-Match`), so a saved change is delivered on the
next request.

**A brand.** Brands exist in Multi-brand projects only:

1. Project → Settings → General: set the type to Multi-brand.
2. Brands → Add brand, e.g. with the key `premium`.
3. Give the brand its languages (brand page → Languages → Manage, or the language
   settings on the Translations page). A brand delivers
   only its own languages: for any other language the response is `{}`.
4. On the Translations page open the key's brand rows and give the brand its own
   text, e.g. for `checkout.title`.
5. Use the commented `VITE_LOAD_PATH` with `?brandKey=premium` from `.env.example`
   and restart. The overridden key shows the brand's text, all other keys the
   standard text. An unknown brand key delivers the standard texts.

## Common problems

The app shows a message instead of a blank page when the configuration is missing
or the texts cannot be loaded.

**401 – the API key does not fit.** An API key belongs to one organization and works
for every project of that organization. A 401 comes back for an
unknown, deleted or expired key and for a project key that does not exist in the
key's organization. An unknown project key in the URL gives 404.

**403 – origin not allowed.** In the browser the request carries the page's origin,
here `http://localhost:5173`. Project → Settings → **Allowed origins**:

- an empty list allows every origin (the seed project has an empty list);
- as soon as the list has entries, the origin must be listed: add
  `http://localhost:5173` exactly (scheme, host and port; no path, no trailing
  slash) and click **Save origins**. `*` allows every origin, `*.example.com`
  allows `example.com` and all its subdomains.

**Network error.** Translately is not reachable at the address in `VITE_LOAD_PATH`.
Failed requests are retried a few times before the message appears.
