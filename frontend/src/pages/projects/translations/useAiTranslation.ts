import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getErrorCode, getErrorStatus } from '@/lib/errors'
import { notifyWriteError } from '@/lib/permissions'
import * as translationsApi from './api'
import type { AiSuggestion, TableRow } from './types'

/**
 * Locale key of the message for a failed AI request. Mapped by status and
 * `code` only: the server masks the message of every 5xx. Any 429 (also the
 * server's own request limit, which has no code) means "busy".
 */
export function aiErrorKey(error: unknown): string {
  const code = getErrorCode(error)
  if (getErrorStatus(error) === 429 || code === 'ai_translation_rate_limit')
    return 'translations.ai.error-rate-limit'
  if (
    code === 'ai_translation_auth' ||
    code === 'ai_translation_disabled' ||
    code === 'ai_translation_config'
  )
    return 'translations.ai.error-config'
  return 'translations.ai.error'
}

/** Lädt den Status einmal; `enabled` ist false, solange er lädt oder die Abfrage scheitert. */
export function useAiTranslation(projectId: string | null): {
  enabled: boolean
  /** null = kein Vorschlag möglich (keine Quelle); wirft nie, Fehler werden als Toast gemeldet und ergeben null. */
  suggest(
    row: TableRow,
    targetLanguage: string,
    sourceLanguage: string,
    brandId?: string | null
  ): Promise<AiSuggestion | null>
} {
  const { t } = useTranslation()
  const tRef = useRef(t)
  tRef.current = t
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    let active = true
    translationsApi
      .fetchAiStatus()
      .then((status) => {
        if (active) setEnabled(status.enabled === true)
      })
      .catch(() => {
        // Without a status the feature stays hidden.
      })
    return () => {
      active = false
    }
  }, [])

  const suggest = useCallback(
    async (
      row: TableRow,
      targetLanguage: string,
      sourceLanguage: string,
      brandId?: string | null
    ): Promise<AiSuggestion | null> => {
      if (!projectId) return null
      try {
        const result = await translationsApi.suggestTranslations(projectId, {
          sourceLanguage,
          targetLanguage,
          keyIds: [row.keyId],
          ...(brandId ? { brandId } : {}),
        })
        // A key the model dropped is in neither list: no suggestion either.
        return result.suggestions.find((s) => s.keyId === row.keyId) ?? null
      } catch (err) {
        notifyWriteError(err, tRef.current, tRef.current(aiErrorKey(err)))
        return null
      }
    },
    [projectId]
  )

  return { enabled, suggest }
}
