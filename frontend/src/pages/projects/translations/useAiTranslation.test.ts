import { act, renderHook, waitFor } from '@testing-library/react'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import i18n from '@/i18n'
import type { TableRow } from './types'

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
const aiApi = vi.hoisted(() => ({
  fetchAiStatus: vi.fn(),
  suggestTranslations: vi.fn(),
}))

vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/workspace', () => ({
  refreshWorkspace: vi.fn(() => Promise.resolve()),
  useWorkspace: () => ({
    projects: [],
    organizations: [],
    isLoading: false,
    error: null,
  }),
}))
vi.mock('./api', () => aiApi)

import { aiErrorKey, useAiTranslation } from './useAiTranslation'

const ROW: TableRow = {
  keyId: 'k1',
  key: 'checkout.title',
  description: null,
  locked: false,
  values: { de: { value: 'Kasse', inherited: false } },
  overrides: {},
}

const httpError = (status: number, code?: string) => ({
  isAxiosError: true,
  message: 'Request failed',
  response: {
    status,
    data: { message: 'Internal server error', ...(code ? { code } : {}) },
  },
})

async function enabledHook() {
  aiApi.fetchAiStatus.mockResolvedValue({ enabled: true })
  const hook = renderHook(() => useAiTranslation('p1'))
  await waitFor(() => expect(hook.result.current.enabled).toBe(true))
  return hook
}

describe('useAiTranslation', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('de')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })
  beforeEach(() => {
    toast.error.mockReset()
    aiApi.fetchAiStatus.mockReset()
    aiApi.suggestTranslations.mockReset()
  })

  it('Status enabled: false → enabled bleibt false', async () => {
    aiApi.fetchAiStatus.mockResolvedValue({ enabled: false })
    const { result } = renderHook(() => useAiTranslation('p1'))
    await waitFor(() => expect(aiApi.fetchAiStatus).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(result.current.enabled).toBe(false)
  })

  it('gescheiterte Status-Abfrage → enabled false, kein Toast', async () => {
    aiApi.fetchAiStatus.mockRejectedValue(httpError(500))
    const { result } = renderHook(() => useAiTranslation('p1'))
    await waitFor(() => expect(aiApi.fetchAiStatus).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(result.current.enabled).toBe(false)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('suggest gibt den Vorschlag des Keys zurück', async () => {
    const { result } = await enabledHook()
    const suggestion = {
      keyId: 'k1',
      value: 'Checkout',
      placeholderMismatch: false,
    }
    aiApi.suggestTranslations.mockResolvedValue({
      suggestions: [suggestion],
      skipped: [],
    })
    let out: unknown
    await act(async () => {
      out = await result.current.suggest(ROW, 'en', 'de')
    })
    expect(out).toEqual(suggestion)
    expect(aiApi.suggestTranslations).toHaveBeenCalledWith('p1', {
      sourceLanguage: 'de',
      targetLanguage: 'en',
      keyIds: ['k1'],
    })
  })

  it('suggest einer Brand-Zelle schickt die brandId mit', async () => {
    const { result } = await enabledHook()
    aiApi.suggestTranslations.mockResolvedValue({
      suggestions: [],
      skipped: [],
    })
    await act(async () => {
      await result.current.suggest(ROW, 'en', 'de', 'b1')
    })
    expect(aiApi.suggestTranslations).toHaveBeenCalledWith('p1', {
      sourceLanguage: 'de',
      targetLanguage: 'en',
      keyIds: ['k1'],
      brandId: 'b1',
    })
  })

  it('Antwort nur mit skipped (oder ohne den Key) → null', async () => {
    const { result } = await enabledHook()
    aiApi.suggestTranslations.mockResolvedValue({
      suggestions: [],
      skipped: [{ keyId: 'k1', reason: 'no_source' }],
    })
    let out: unknown = 'unset'
    await act(async () => {
      out = await result.current.suggest(ROW, 'en', 'de')
    })
    expect(out).toBeNull()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('429 mit Code → Toast „ausgelastet“, Rückgabe null', async () => {
    const { result } = await enabledHook()
    aiApi.suggestTranslations.mockRejectedValue(
      httpError(429, 'ai_translation_rate_limit')
    )
    let out: unknown = 'unset'
    await act(async () => {
      out = await result.current.suggest(ROW, 'en', 'de')
    })
    expect(out).toBeNull()
    expect(toast.error).toHaveBeenCalledWith(
      'Die KI ist gerade ausgelastet. Bitte gleich noch einmal versuchen.'
    )
  })

  it('ordnet Fehler nach Code zu, nie nach der Meldung', () => {
    expect(aiErrorKey(httpError(429))).toBe('translations.ai.error-rate-limit')
    expect(aiErrorKey(httpError(429, 'ai_translation_rate_limit'))).toBe(
      'translations.ai.error-rate-limit'
    )
    expect(aiErrorKey(httpError(503, 'ai_translation_auth'))).toBe(
      'translations.ai.error-config'
    )
    expect(aiErrorKey(httpError(503, 'ai_translation_disabled'))).toBe(
      'translations.ai.error-config'
    )
    expect(aiErrorKey(httpError(503, 'ai_translation_config'))).toBe(
      'translations.ai.error-config'
    )
    expect(aiErrorKey(httpError(502, 'ai_translation_failed'))).toBe(
      'translations.ai.error'
    )
    expect(aiErrorKey(new Error('offline'))).toBe('translations.ai.error')
  })

  it('ai_translation_auth → Toast „nicht richtig eingerichtet“', async () => {
    const { result } = await enabledHook()
    aiApi.suggestTranslations.mockRejectedValue(
      httpError(503, 'ai_translation_auth')
    )
    await act(async () => {
      await result.current.suggest(ROW, 'en', 'de')
    })
    expect(toast.error).toHaveBeenCalledWith(
      'Die KI-Übersetzung ist auf dieser Instanz nicht richtig eingerichtet.'
    )
  })
})
