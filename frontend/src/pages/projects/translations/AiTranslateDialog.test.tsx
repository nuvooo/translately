import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { toast } from 'sonner'
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
import { handleForbidden } from '@/lib/permissions'
import { AiTranslateDialog } from './AiTranslateDialog'
import * as api from './api'
import type { AiPreviewLanguage } from './types'

vi.mock('./api', () => ({
  previewMissingTranslations: vi.fn(),
  applyAiTranslations: vi.fn(),
}))
vi.mock('@/lib/permissions', () => ({
  handleForbidden: vi.fn(() => false),
  notifyWriteError: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const previewMissing = vi.mocked(api.previewMissingTranslations)
const applyAi = vi.mocked(api.applyAiTranslations)

type Props = ComponentProps<typeof AiTranslateDialog>

const EN: AiPreviewLanguage = {
  language: 'en',
  remaining: 7,
  suggestions: [
    {
      keyId: 'k1',
      key: 'checkout.title',
      source: 'Kasse',
      value: 'Checkout',
      placeholderMismatch: false,
    },
    {
      keyId: 'k2',
      key: 'checkout.submit',
      source: 'Jetzt kaufen',
      value: 'Buy now',
      placeholderMismatch: false,
    },
    {
      keyId: 'k3',
      key: 'greeting',
      source: 'Hallo {{name}}',
      value: 'Hello',
      placeholderMismatch: true,
    },
  ],
}
const FR: AiPreviewLanguage = {
  language: 'fr',
  remaining: 1,
  suggestions: [
    {
      keyId: 'k1',
      key: 'checkout.title',
      source: 'Kasse',
      value: 'Caisse',
      placeholderMismatch: false,
    },
  ],
}

const httpError = (status: number, code?: string) => ({
  isAxiosError: true,
  message: 'Request failed',
  response: {
    status,
    data: { message: 'Internal server error', ...(code ? { code } : {}) },
  },
})

function renderDialog(overrides: Partial<Props> = {}) {
  const props: Props = {
    open: true,
    onOpenChange: vi.fn(),
    projectId: 'p1',
    namespace: 'translation',
    projectLanguages: ['de', 'en', 'fr'],
    onApplied: vi.fn(),
    ...overrides,
  }
  const view = render(<AiTranslateDialog {...props} />)
  return { props, ...view }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Answers each preview request with the language it asked for. */
function answerPreviews(byLanguage: Record<string, AiPreviewLanguage>) {
  previewMissing.mockImplementation(async (_projectId, body) => ({
    languages: [byLanguage[body.targetLanguages[0]]],
  }))
}

const dialog = () => screen.getByRole('dialog')
const button = (name: string | RegExp) =>
  within(dialog()).getByRole('button', { name })
const targetBox = (language: string) =>
  within(
    within(dialog()).getByRole('group', { name: 'Zielsprachen' })
  ).queryByRole('checkbox', { name: language })
const section = (language: string) =>
  within(dialog()).getByRole('region', { name: language })
const rowBox = (language: string, key: string) =>
  within(section(language)).getByRole('checkbox', { name: key })

type User = ReturnType<typeof userEvent.setup>

/** Creates suggestions for `en` and `fr` and waits for both. */
async function toReview(user: User) {
  answerPreviews({ en: EN, fr: FR })
  await user.click(button('Vorschläge erstellen'))
  await within(dialog()).findByText('Caisse')
}

describe('AiTranslateDialog', () => {
  beforeAll(async () => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
    Element.prototype.scrollIntoView ??= () => {}
    await i18n.changeLanguage('de')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(handleForbidden).mockReturnValue(false)
  })

  it('Start: Quelle de, Ziele en und fr angewählt, Hinweis mit Namespace', () => {
    renderDialog()
    expect(
      within(dialog()).getByRole('heading', {
        name: 'Fehlende Texte mit KI übersetzen',
      })
    ).toBeInTheDocument()
    expect(
      within(dialog()).getByRole('combobox', { name: 'Quellsprache' })
    ).toHaveTextContent(/^de$/)
    expect(targetBox('en')).toBeChecked()
    expect(targetBox('fr')).toBeChecked()
    expect(targetBox('de')).toBeNull()
    expect(dialog()).toHaveTextContent(
      'Übersetzt werden nur fehlende Standardtexte im Namespace „translation“.'
    )
  })

  it('Quelle auf en → en verschwindet aus den Zielen, de kommt dazu', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.click(
      within(dialog()).getByRole('combobox', { name: 'Quellsprache' })
    )
    await user.click(await screen.findByRole('option', { name: 'en' }))
    expect(targetBox('en')).toBeNull()
    expect(targetBox('de')).toBeChecked()
    expect(targetBox('fr')).toBeChecked()
  })

  it('„Vorschläge erstellen“ sendet je Zielsprache eine Anfrage, nacheinander', async () => {
    const user = userEvent.setup()
    const first = deferred<{ languages: AiPreviewLanguage[] }>()
    previewMissing.mockReturnValueOnce(first.promise)
    previewMissing.mockResolvedValueOnce({ languages: [FR] })
    renderDialog()
    await user.click(button('Vorschläge erstellen'))
    expect(previewMissing).toHaveBeenCalledTimes(1)
    expect(previewMissing).toHaveBeenNthCalledWith(1, 'p1', {
      namespace: 'translation',
      sourceLanguage: 'de',
      targetLanguages: ['en'],
      limit: 40,
    })
    // en is in progress, fr waits.
    expect(section('en')).toHaveAttribute('aria-busy', 'true')
    expect(section('fr')).toHaveTextContent('Vorschläge werden erstellt …')
    first.resolve({ languages: [EN] })
    await within(dialog()).findByText('Caisse')
    expect(previewMissing).toHaveBeenCalledTimes(2)
    expect(previewMissing).toHaveBeenNthCalledWith(2, 'p1', {
      namespace: 'translation',
      sourceLanguage: 'de',
      targetLanguages: ['fr'],
      limit: 40,
    })
  })

  it('Vorschau zeigt Keys, Quelltexte und Vorschläge; Platzhalter-Zeile ist markiert und abgewählt', async () => {
    const user = userEvent.setup()
    renderDialog()
    await toReview(user)
    const en = section('en')
    for (const text of [
      'checkout.title',
      'Kasse',
      'Checkout',
      'checkout.submit',
      'Jetzt kaufen',
      'Buy now',
    ]) {
      expect(within(en).getByText(text)).toBeInTheDocument()
    }
    expect(rowBox('en', 'checkout.title')).toBeChecked()
    expect(rowBox('en', 'checkout.submit')).toBeChecked()
    expect(rowBox('en', 'greeting')).not.toBeChecked()
    const mismatchRow = rowBox('en', 'greeting').closest('tr') as HTMLElement
    expect(mismatchRow).toHaveTextContent(
      'Platzhalter weichen vom Quelltext ab – bitte prüfen.'
    )
    const okRow = rowBox('en', 'checkout.title').closest('tr') as HTMLElement
    expect(okRow).not.toHaveTextContent('Platzhalter')
  })

  it('remaining: 7 → Hinweis mit 7, remaining: 1 → Einzahl', async () => {
    const user = userEvent.setup()
    renderDialog()
    await toReview(user)
    expect(section('en')).toHaveTextContent(
      '7 weitere fehlende Texte folgen in einem nächsten Durchgang.'
    )
    expect(section('fr')).toHaveTextContent(
      '1 weiterer fehlender Text folgt in einem nächsten Durchgang.'
    )
  })

  it('kein Hinweis bei remaining: 0', async () => {
    const user = userEvent.setup()
    answerPreviews({ en: EN, fr: { ...FR, remaining: 0 } })
    renderDialog()
    await user.click(button('Vorschläge erstellen'))
    await within(dialog()).findByText('Caisse')
    expect(section('fr')).not.toHaveTextContent('nächsten Durchgang')
  })

  it('während „Übernehmen“ läuft, sind die Zeilen-Checkboxen gesperrt', async () => {
    const user = userEvent.setup()
    const pending = deferred<{ written: number; skippedExisting: number }>()
    applyAi.mockReturnValue(pending.promise)
    renderDialog()
    await toReview(user)
    await user.click(button('Übernehmen (3)'))
    expect(rowBox('en', 'checkout.title')).toBeDisabled()
    expect(rowBox('en', 'checkout.submit')).toBeDisabled()
    expect(rowBox('fr', 'checkout.title')).toBeDisabled()
    pending.resolve({ written: 1, skippedExisting: 0 })
  })

  it('während des Erstellens sind die Zeilen-Checkboxen gesperrt', async () => {
    const user = userEvent.setup()
    const second = deferred<{ languages: AiPreviewLanguage[] }>()
    previewMissing.mockResolvedValueOnce({ languages: [EN] })
    previewMissing.mockReturnValueOnce(second.promise)
    renderDialog()
    await user.click(button('Vorschläge erstellen'))
    await within(dialog()).findByText('Checkout')
    expect(rowBox('en', 'checkout.title')).toBeDisabled()
    second.resolve({ languages: [FR] })
    await within(dialog()).findByText('Caisse')
    expect(rowBox('en', 'checkout.title')).toBeEnabled()
  })

  it('Unmount während die erste Sprache lädt → keine weitere Anfrage', async () => {
    const user = userEvent.setup()
    const first = deferred<{ languages: AiPreviewLanguage[] }>()
    previewMissing.mockReturnValueOnce(first.promise)
    previewMissing.mockResolvedValue({ languages: [FR] })
    const { unmount } = renderDialog()
    await user.click(button('Vorschläge erstellen'))
    expect(previewMissing).toHaveBeenCalledTimes(1)
    unmount()
    first.resolve({ languages: [EN] })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(previewMissing).toHaveBeenCalledTimes(1)
  })

  it('Sprache ohne fehlende Texte → „Nichts zu übersetzen“', async () => {
    const user = userEvent.setup()
    answerPreviews({
      en: EN,
      fr: { language: 'fr', remaining: 0, suggestions: [] },
    })
    renderDialog()
    await user.click(button('Vorschläge erstellen'))
    await within(dialog()).findByText('Nichts zu übersetzen')
    expect(section('fr')).toHaveTextContent('Nichts zu übersetzen')
    expect(button('Übernehmen (2)')).toBeEnabled()
  })

  it('„Übernehmen (2)“ sendet je Sprache nur die angewählten Zeilen, ruft onApplied und schließt', async () => {
    const user = userEvent.setup()
    applyAi
      .mockResolvedValueOnce({ written: 1, skippedExisting: 0 })
      .mockResolvedValueOnce({ written: 0, skippedExisting: 1 })
    const { props } = renderDialog()
    await toReview(user)
    expect(button('Übernehmen (3)')).toBeEnabled()
    await user.click(rowBox('en', 'checkout.submit'))
    await user.click(button('Übernehmen (2)'))
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false))
    expect(applyAi).toHaveBeenCalledTimes(2)
    expect(applyAi).toHaveBeenNthCalledWith(1, 'p1', {
      targetLanguage: 'en',
      values: [{ keyId: 'k1', value: 'Checkout' }],
    })
    expect(applyAi).toHaveBeenNthCalledWith(2, 'p1', {
      targetLanguage: 'fr',
      values: [{ keyId: 'k1', value: 'Caisse' }],
    })
    expect(props.onApplied).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith(
      '1 Texte übernommen, 1 übersprungen (bereits vorhanden).'
    )
  })

  it('eine angewählte Platzhalter-Zeile wird mitgesendet', async () => {
    const user = userEvent.setup()
    applyAi.mockResolvedValue({ written: 1, skippedExisting: 0 })
    renderDialog({ projectLanguages: ['de', 'en'] })
    answerPreviews({ en: EN })
    await user.click(button('Vorschläge erstellen'))
    await within(dialog()).findByText('Checkout')
    await user.click(rowBox('en', 'checkout.title'))
    await user.click(rowBox('en', 'checkout.submit'))
    await user.click(rowBox('en', 'greeting'))
    await user.click(button('Übernehmen (1)'))
    await waitFor(() => expect(applyAi).toHaveBeenCalledTimes(1))
    expect(applyAi).toHaveBeenCalledWith('p1', {
      targetLanguage: 'en',
      values: [{ keyId: 'k3', value: 'Hello' }],
    })
  })

  it('leere Vorschläge sind nicht wählbar und werden nie gesendet', async () => {
    const user = userEvent.setup()
    applyAi.mockResolvedValue({ written: 1, skippedExisting: 0 })
    renderDialog({ projectLanguages: ['de', 'en'] })
    answerPreviews({
      en: {
        language: 'en',
        remaining: 0,
        suggestions: [
          { ...EN.suggestions[0] },
          { ...EN.suggestions[1], value: '   ' },
        ],
      },
    })
    await user.click(button('Vorschläge erstellen'))
    await within(dialog()).findByText('Checkout')
    expect(rowBox('en', 'checkout.submit')).not.toBeChecked()
    expect(rowBox('en', 'checkout.submit')).toBeDisabled()
    await user.click(button('Übernehmen (1)'))
    await waitFor(() => expect(applyAi).toHaveBeenCalledTimes(1))
    expect(applyAi).toHaveBeenCalledWith('p1', {
      targetLanguage: 'en',
      values: [{ keyId: 'k1', value: 'Checkout' }],
    })
  })

  it('alle abgewählt → Knopf gesperrt', async () => {
    const user = userEvent.setup()
    renderDialog()
    await toReview(user)
    await user.click(rowBox('en', 'checkout.title'))
    await user.click(rowBox('en', 'checkout.submit'))
    await user.click(rowBox('fr', 'checkout.title'))
    expect(button('Übernehmen (0)')).toBeDisabled()
  })

  it('429 beim Erstellen (alle Sprachen) → Meldung „ausgelastet“ im Dialog, Schritt 1 bleibt', async () => {
    const user = userEvent.setup()
    previewMissing.mockRejectedValue(
      httpError(429, 'ai_translation_rate_limit')
    )
    renderDialog()
    await user.click(button('Vorschläge erstellen'))
    expect(
      await within(dialog()).findByText(
        'Die KI ist gerade ausgelastet. Bitte gleich noch einmal versuchen.'
      )
    ).toBeInTheDocument()
    expect(previewMissing).toHaveBeenCalledTimes(2)
    expect(button('Vorschläge erstellen')).toBeEnabled()
    expect(targetBox('en')).toBeChecked()
    expect(within(dialog()).queryByRole('region')).toBeNull()
  })

  it('erste Sprache scheitert, zweite gelingt → Fehler im ersten Abschnitt, Vorschläge im zweiten; Übernehmen zählt nur den zweiten', async () => {
    const user = userEvent.setup()
    applyAi.mockResolvedValue({ written: 1, skippedExisting: 0 })
    previewMissing
      .mockRejectedValueOnce(httpError(502, 'ai_translation_failed'))
      .mockResolvedValueOnce({ languages: [FR] })
    renderDialog()
    await user.click(button('Vorschläge erstellen'))
    await within(dialog()).findByText('Caisse')
    expect(
      within(section('en')).getByText(
        'Der Vorschlag konnte nicht erstellt werden.'
      )
    ).toBeInTheDocument()
    await user.click(button('Übernehmen (1)'))
    await waitFor(() => expect(applyAi).toHaveBeenCalledTimes(1))
    expect(applyAi).toHaveBeenCalledWith('p1', {
      targetLanguage: 'fr',
      values: [{ keyId: 'k1', value: 'Caisse' }],
    })
  })

  it('apply scheitert bei der zweiten Sprache → erste verschwindet, zweite bleibt mit Fehler, onApplied trotzdem', async () => {
    const user = userEvent.setup()
    applyAi
      .mockResolvedValueOnce({ written: 2, skippedExisting: 0 })
      .mockRejectedValueOnce(httpError(500))
    const { props } = renderDialog()
    await toReview(user)
    await user.click(button('Übernehmen (3)'))
    await waitFor(() => expect(props.onApplied).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(within(dialog()).queryByRole('region', { name: 'en' })).toBeNull()
    )
    const fr = section('fr')
    expect(within(fr).getByText('Caisse')).toBeInTheDocument()
    expect(within(fr).getByRole('alert')).toHaveTextContent(
      'Der Text konnte nicht gespeichert werden.'
    )
    expect(props.onOpenChange).not.toHaveBeenCalled()
    expect(button('Übernehmen (1)')).toBeEnabled()
  })

  it('während des Erstellens lässt sich der Dialog nicht schließen', async () => {
    const user = userEvent.setup()
    const pending = deferred<{ languages: AiPreviewLanguage[] }>()
    previewMissing.mockReturnValue(pending.promise)
    const { props } = renderDialog({ projectLanguages: ['de', 'en'] })
    await user.click(button('Vorschläge erstellen'))
    await user.keyboard('{Escape}')
    expect(props.onOpenChange).not.toHaveBeenCalled()
    expect(button('Zurück')).toBeDisabled()
    pending.resolve({ languages: [EN] })
    await within(dialog()).findByText('Checkout')
    await user.keyboard('{Escape}')
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('„Zurück“ verwirft die Vorschläge; erneutes Öffnen beginnt leer mit den neuen Sprachen', async () => {
    const user = userEvent.setup()
    const { props, rerender } = renderDialog()
    await toReview(user)
    await user.click(button('Zurück'))
    expect(within(dialog()).queryByRole('region')).toBeNull()
    expect(targetBox('fr')).toBeChecked()

    await toReview(user)
    rerender(<AiTranslateDialog {...props} open={false} />)
    rerender(
      <AiTranslateDialog
        {...props}
        open
        namespace="admin"
        projectLanguages={['en', 'it']}
      />
    )
    expect(within(dialog()).queryByRole('region')).toBeNull()
    expect(
      within(dialog()).getByRole('combobox', { name: 'Quellsprache' })
    ).toHaveTextContent(/^en$/)
    expect(targetBox('it')).toBeChecked()
    expect(dialog()).toHaveTextContent('„admin“')
  })

  it('hält Namespace und Sprachen beim Öffnen fest', async () => {
    const user = userEvent.setup()
    answerPreviews({ en: EN })
    const { props, rerender } = renderDialog({ projectLanguages: ['de', 'en'] })
    rerender(
      <AiTranslateDialog
        {...props}
        namespace="admin"
        projectLanguages={['de', 'en', 'fr']}
      />
    )
    expect(targetBox('fr')).toBeNull()
    await user.click(button('Vorschläge erstellen'))
    await within(dialog()).findByText('Checkout')
    expect(previewMissing).toHaveBeenCalledWith('p1', {
      namespace: 'translation',
      sourceLanguage: 'de',
      targetLanguages: ['en'],
      limit: 40,
    })
  })
})
