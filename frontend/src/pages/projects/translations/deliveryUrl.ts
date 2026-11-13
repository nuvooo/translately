/**
 * Origin of the backend, where the public delivery endpoint (`/sdk/...`, no
 * `/api` prefix) lives: the origin of an absolute `VITE_API_URL`, otherwise
 * the origin the dashboard is served from.
 */
export function backendOrigin(): string {
  const configured = import.meta.env.VITE_API_URL
  if (configured && /^https?:\/\//i.test(configured)) {
    try {
      return new URL(configured).origin
    } catch {
      // Malformed value: fall through to the page origin.
    }
  }
  return window.location.origin
}

/** e.g. https://host/sdk/translations/shop/{{lng}}/{{ns}}?brandKey=premium */
export function deliveryLoadPath(
  origin: string,
  projectKey: string,
  brandKey?: string
): string {
  const base = origin.replace(/\/$/, '')
  const path = `${base}/sdk/translations/${encodeURIComponent(projectKey)}/{{lng}}/{{ns}}`
  return brandKey ? `${path}?brandKey=${encodeURIComponent(brandKey)}` : path
}

/** Content of a single-quoted JavaScript string literal. */
const js = (value: string) => value.replace(/[\\']/g, (c) => `\\${c}`)

/** Ready-to-copy i18next setup (i18next-http-backend) for a delivery URL. */
export function i18nextSnippet(loadPath: string, languages: string[]): string {
  return [
    "import i18next from 'i18next'",
    "import HttpBackend from 'i18next-http-backend'",
    '',
    'i18next.use(HttpBackend).init({',
    `  fallbackLng: '${js(languages[0] ?? 'en')}',`,
    '  backend: {',
    `    loadPath: '${js(loadPath)}',`,
    "    customHeaders: { 'x-api-key': '<YOUR_API_KEY>' },",
    '  },',
    '})',
  ].join('\n')
}
