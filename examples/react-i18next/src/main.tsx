import i18next from 'i18next'
import HttpBackend from 'i18next-http-backend'
import { StrictMode, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { initReactI18next, useTranslation } from 'react-i18next'

const env = import.meta.env
const loadPath = env.VITE_LOAD_PATH?.trim() ?? ''
const apiKey = env.VITE_API_KEY?.trim() ?? ''
const configured = (env.VITE_LANGUAGES ?? '')
  .split(',')
  .map((language) => language.trim())
  .filter(Boolean)
const languages = configured.length > 0 ? configured : ['de', 'en']

/** Texts of the example itself (not the ones loaded from Translately). */
const UI = {
  de: {
    language: 'Sprache',
    reload: 'Neu laden',
    loading: 'Texte werden geladen …',
    configTitle: 'Konfiguration fehlt',
    configText:
      'Kopiere .env.example nach .env, trage VITE_LOAD_PATH und VITE_API_KEY ein und starte npm run dev neu.',
    loadPathText:
      'VITE_LOAD_PATH muss {{lng}} und {{ns}} enthalten, z. B. http://localhost:4000/sdk/translations/<projekt>/{{lng}}/{{ns}}.',
    errorTitle: 'Texte konnten nicht geladen werden',
    401: 'Zugriff verweigert: Der API-Key ist ungültig oder abgelaufen, gehört zu einer anderen Organisation als das Projekt – oder der Projekt-Key in VITE_LOAD_PATH stimmt nicht.',
    403: `Origin nicht erlaubt: ${window.location.origin} in den Projekt-Einstellungen unter „Erlaubte Origins“ eintragen (oder die Liste leer lassen).`,
    404: 'Projekt nicht gefunden: Projekt-Key in VITE_LOAD_PATH prüfen.',
    network:
      'Translately ist nicht erreichbar (Netzwerkfehler). Läuft der Server unter der Adresse aus VITE_LOAD_PATH?',
  },
  en: {
    language: 'Language',
    reload: 'Reload',
    loading: 'Loading texts …',
    configTitle: 'Configuration missing',
    configText:
      'Copy .env.example to .env, fill in VITE_LOAD_PATH and VITE_API_KEY and restart npm run dev.',
    loadPathText:
      'VITE_LOAD_PATH must contain {{lng}} and {{ns}}, e.g. http://localhost:4000/sdk/translations/<project>/{{lng}}/{{ns}}.',
    errorTitle: 'Texts could not be loaded',
    401: 'Access denied: the API key is invalid or expired, belongs to another organization than the project, or the project key in VITE_LOAD_PATH is wrong.',
    403: `Origin not allowed: add ${window.location.origin} to the project settings under "Allowed origins" (or leave the list empty).`,
    404: 'Project not found: check the project key in VITE_LOAD_PATH.',
    network:
      'Translately is not reachable (network error). Is the server running at the address in VITE_LOAD_PATH?',
  },
}
type UiText = (typeof UI)['en']
const ui = (language: string): UiText =>
  language.startsWith('de') ? UI.de : UI.en

function configProblem(): keyof UiText | null {
  // `<YOUR_API_KEY>` is the placeholder from .env.example
  if (!loadPath || !apiKey || apiKey.startsWith('<')) return 'configText'
  if (!loadPath.includes('{{lng}}') || !loadPath.includes('{{ns}}')) {
    return 'loadPathText'
  }
  return null
}

/** Failed language files (`<lng>/<ns>` → message), cleared once a file loads. */
const failures = new Map<string, string>()
const listeners = new Set<() => void>()
let failureSnapshot: string[] = []
function setFailure(file: string, message: string | null) {
  if (message === null) failures.delete(file)
  else failures.set(file, message)
  failureSnapshot = [...failures.values()]
  for (const listener of listeners) listener()
}
function useFailures(): string[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => failureSnapshot
  )
}

const PAGE_STYLE = {
  fontFamily: 'system-ui, sans-serif',
  maxWidth: 640,
  margin: '2rem auto',
  padding: '0 1rem',
}
const ALERT_STYLE = { border: '1px solid', padding: '0.5rem 1rem' }

/** User-facing explanation of an i18next-http-backend error message. */
function explain(message: string, text: UiText): string {
  const status = /status code: (\d+)/.exec(message)?.[1]
  if (status === '401' || status === '403' || status === '404') {
    return text[status]
  }
  if (status) return message
  return text.network
}

function App() {
  const { t, i18n, ready } = useTranslation()
  const failed = useFailures()
  const [reloading, setReloading] = useState(false)
  const [, setRevision] = useState(0)
  const text = ui(i18n.language || languages[0])

  const reload = async () => {
    setReloading(true)
    try {
      await i18n.reloadResources()
    } finally {
      setReloading(false)
      setRevision((revision) => revision + 1)
    }
  }

  return (
    <main style={PAGE_STYLE}>
      <p>
        {text.language}:{' '}
        {languages.map((language) => (
          <button
            key={language}
            type="button"
            onClick={() => i18n.changeLanguage(language)}
            aria-pressed={i18n.language === language}
            style={{
              fontWeight: i18n.language === language ? 'bold' : 'normal',
              marginRight: 4,
            }}
          >
            {language}
          </button>
        ))}{' '}
        <button type="button" onClick={reload} disabled={reloading}>
          {text.reload}
        </button>
      </p>

      {failed.length > 0 && (
        <div role="alert" style={ALERT_STYLE}>
          <strong>{text.errorTitle}</strong>
          {[...new Set(failed.map((message) => explain(message, text)))].map(
            (line) => (
              <p key={line}>{line}</p>
            )
          )}
        </div>
      )}

      {ready ? (
        <section>
          <h1>{t('checkout.title')}</h1>
          <p>{t('cart.empty')}</p>
          <button type="button">{t('checkout.submit')}</button>
        </section>
      ) : (
        <p role="status">{text.loading}</p>
      )}
    </main>
  )
}

function ConfigError({ problem }: { problem: keyof UiText }) {
  const text = ui(languages[0])
  return (
    <main style={PAGE_STYLE}>
      <div role="alert" style={ALERT_STYLE}>
        <strong>{text.configTitle}</strong>
        <p>{text[problem]}</p>
      </div>
    </main>
  )
}

const root = createRoot(document.getElementById('root') as HTMLElement)
const problem = configProblem()

if (problem) {
  root.render(<ConfigError problem={problem} />)
} else {
  i18next.on('failedLoading', (lng, ns, message) =>
    setFailure(`${lng}/${ns}`, String(message))
  )

  // Same setup as the snippet in Translately (Translations page, "Set up for
  // i18next"), plus the start language, the namespace and no Suspense.
  i18next
    .use(HttpBackend)
    .use(initReactI18next)
    .init({
      lng: languages[0],
      fallbackLng: languages[0],
      ns: ['translation'],
      defaultNS: 'translation',
      backend: {
        loadPath,
        customHeaders: { 'x-api-key': apiKey },
      },
      react: { useSuspense: false },
    })
  // The store exists once init() has run; a file that loads clears its error.
  i18next.store.on('added', (lng: string, ns: string) =>
    setFailure(`${lng}/${ns}`, null)
  )

  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
