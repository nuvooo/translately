/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Delivery URL with {{lng}} and {{ns}}, optionally with ?brandKey=… */
  readonly VITE_LOAD_PATH?: string
  /** API key of the project's organization */
  readonly VITE_API_KEY?: string
  /** Comma-separated languages, the first one is the start and fallback language */
  readonly VITE_LANGUAGES?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
