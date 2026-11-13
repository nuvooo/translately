import { act, render, screen, waitFor, within } from '@testing-library/react'
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
import * as api from './api'
import { LanguagesDialog } from './LanguagesDialog'

vi.mock('./api', () => ({
  setProjectLanguages: vi.fn(),
  setBrandLanguages: vi.fn(),
}))
vi.mock('@/lib/permissions', () => ({ handleForbidden: vi.fn(() => false) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const setProjectLanguages = vi.mocked(api.setProjectLanguages)
const setBrandLanguages = vi.mocked(api.setBrandLanguages)

type Props = ComponentProps<typeof LanguagesDialog>

const PROJECT_PROPS: Props = {
  open: true,
  onOpenChange: vi.fn(),
  scope: { kind: 'project', id: 'p1' },
  languages: ['de', 'en'],
  onSaved: vi.fn(),
}

const BRAND_PROPS: Props = {
  ...PROJECT_PROPS,
  scope: {
    kind: 'brand',
    id: 'b1',
    name: 'Premium',
    projectLanguages: ['de', 'en', 'fr'],
  },
  languages: ['de', 'it'],
}

function renderDialog(overrides: Partial<Props> = {}) {
  const props: Props = {
    ...PROJECT_PROPS,
    onOpenChange: vi.fn(),
    onSaved: vi.fn(),
    ...overrides,
  }
  const view = render(<LanguagesDialog {...props} />)
  return { props, ...view }
}

const dialog = () => screen.getByRole('dialog')
const list = () =>
  within(dialog()).getByRole('list', { name: 'Ausgewählte Sprachen' })
const listed = () =>
  within(list())
    .queryAllByRole('listitem')
    .map((item) => item.getAttribute('data-language'))

describe('LanguagesDialog', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('de')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(handleForbidden).mockReturnValue(false)
  })

  it('zeigt die gespeicherten Sprachen der Projekt-Sicht', () => {
    renderDialog()
    expect(
      within(dialog()).getByRole('heading', { name: 'Sprachen des Projekts' })
    ).toBeInTheDocument()
    expect(listed()).toEqual(['de', 'en'])
    expect(
      within(dialog()).getByRole('button', { name: 'Speichern' })
    ).toBeDisabled()
  })

  it('ungültiger Code zeigt einen Fehler, fügt nichts hinzu und ruft nichts auf', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.type(screen.getByLabelText('Sprachcode'), 'de_DE')
    await user.click(screen.getByRole('button', { name: 'Hinzufügen' }))
    expect(
      screen.getByText(/Ungültiger Sprachcode/, { exact: false })
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Sprachcode')).toHaveAttribute(
      'aria-invalid',
      'true'
    )
    expect(listed()).toEqual(['de', 'en'])
    await user.keyboard('{Enter}')
    expect(listed()).toEqual(['de', 'en'])
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled()
    expect(setProjectLanguages).not.toHaveBeenCalled()
    expect(setBrandLanguages).not.toHaveBeenCalled()
  })

  it('doppelter Code zeigt einen Fehler', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.type(screen.getByLabelText('Sprachcode'), 'en{Enter}')
    expect(
      screen.getByText('„en“ ist bereits in der Liste.')
    ).toBeInTheDocument()
    expect(listed()).toEqual(['de', 'en'])
  })

  it('weist auf einen Code hin, der sich nur in der Schreibweise unterscheidet', async () => {
    const user = userEvent.setup()
    renderDialog({ languages: ['en-US'] })
    await user.type(screen.getByLabelText('Sprachcode'), 'en-us')
    expect(screen.getByText(/ähnelt „en-US“/)).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(listed()).toEqual(['en-US', 'en-us'])
  })

  it('reines Hinzufügen speichert ohne Rückfrage', async () => {
    const user = userEvent.setup()
    setProjectLanguages.mockResolvedValue({
      languages: ['de', 'en', 'fr'],
      removedValues: 0,
    })
    const { props } = renderDialog()
    await user.type(screen.getByLabelText('Sprachcode'), '  fr {Enter}')
    expect(listed()).toEqual(['de', 'en', 'fr'])
    expect(screen.getByLabelText('Sprachcode')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() =>
      expect(setProjectLanguages).toHaveBeenCalledWith(
        'p1',
        ['de', 'en', 'fr'],
        ['de', 'en']
      )
    )
    await waitFor(() =>
      expect(props.onSaved).toHaveBeenCalledWith(['de', 'en', 'fr'])
    )
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
    expect(toast.success).toHaveBeenCalledWith('Sprachen gespeichert.')
  })

  it('Entfernen + Speichern zeigt die Bestätigung, erst danach der API-Aufruf', async () => {
    const user = userEvent.setup()
    setProjectLanguages.mockResolvedValue({
      languages: ['de'],
      removedValues: 7,
    })
    const { props } = renderDialog()
    await user.click(screen.getByRole('button', { name: 'en entfernen' }))
    expect(listed()).toEqual(['de'])
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(
      screen.getByRole('heading', { name: 'Sprachen entfernen?' })
    ).toBeInTheDocument()
    expect(dialog()).toHaveTextContent('Texte in en werden gelöscht')
    expect(dialog()).toHaveTextContent(
      'Die Standardtexte in diesen Sprachen werden entfernt.'
    )
    expect(dialog().textContent).not.toMatch(/environment/i)
    expect(dialog()).toHaveTextContent(
      'Eigene Texte der Brands bleiben erhalten.'
    )
    expect(setProjectLanguages).not.toHaveBeenCalled()

    await user.click(
      screen.getByRole('button', { name: 'Entfernen und speichern' })
    )
    await waitFor(() =>
      expect(setProjectLanguages).toHaveBeenCalledWith(
        'p1',
        ['de'],
        ['de', 'en']
      )
    )
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith(['de']))
    expect(toast.success).toHaveBeenCalledWith(
      'Sprachen gespeichert. Gelöschte Texte: 7.'
    )
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('Abbrechen der Bestätigung behält Dialog und Entwurf', async () => {
    const user = userEvent.setup()
    const { props } = renderDialog()
    await user.click(screen.getByRole('button', { name: 'en entfernen' }))
    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    await user.click(screen.getByRole('button', { name: 'Zurück' }))
    expect(listed()).toEqual(['de'])
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeEnabled()
    expect(setProjectLanguages).not.toHaveBeenCalled()
    expect(props.onOpenChange).not.toHaveBeenCalled()

    // Escape in the confirmation also returns to the list.
    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    await user.keyboard('{Escape}')
    expect(listed()).toEqual(['de'])
    expect(setProjectLanguages).not.toHaveBeenCalled()
    expect(props.onOpenChange).not.toHaveBeenCalled()
  })

  it('Brand-Variante zeigt Projektsprachen als Vorschläge', async () => {
    const user = userEvent.setup()
    setBrandLanguages.mockResolvedValue({
      languages: ['de', 'it', 'en'],
      removedValues: 0,
    })
    const { props } = renderDialog(BRAND_PROPS)
    expect(
      within(dialog()).getByRole('heading', {
        name: 'Sprachen der Brand „Premium“',
      })
    ).toBeInTheDocument()
    const suggestions = within(dialog()).getByRole('group', {
      name: 'Sprachen des Projekts',
    })
    // `de` is already chosen; only the others are suggested.
    expect(
      within(suggestions)
        .getAllByRole('button')
        .map((b) => b.textContent?.trim())
    ).toEqual(['en', 'fr'])
    await user.click(
      within(suggestions).getByRole('button', { name: 'en hinzufügen' })
    )
    expect(listed()).toEqual(['de', 'it', 'en'])
    expect(
      within(suggestions)
        .getAllByRole('button')
        .map((b) => b.textContent?.trim())
    ).toEqual(['fr'])
    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() =>
      expect(setBrandLanguages).toHaveBeenCalledWith(
        'b1',
        ['de', 'it', 'en'],
        ['de', 'it']
      )
    )
    expect(setProjectLanguages).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(props.onSaved).toHaveBeenCalledWith(['de', 'it', 'en'])
    )
  })

  it('Brand-Variante: die Bestätigung nennt die eigenen Texte der Brand', async () => {
    const user = userEvent.setup()
    setBrandLanguages.mockResolvedValue({ languages: ['de'], removedValues: 0 })
    renderDialog(BRAND_PROPS)
    await user.click(screen.getByRole('button', { name: 'it entfernen' }))
    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    expect(dialog()).toHaveTextContent(
      'Eigene Texte der Brand „Premium“ in it werden gelöscht.'
    )
    expect(setBrandLanguages).not.toHaveBeenCalled()
    await user.click(
      screen.getByRole('button', { name: 'Entfernen und speichern' })
    )
    await waitFor(() =>
      expect(setBrandLanguages).toHaveBeenCalledWith('b1', ['de'], ['de', 'it'])
    )
  })

  it('Fehler beim Speichern: Toast mit Servermeldung, Dialog bleibt mit Entwurf offen', async () => {
    const user = userEvent.setup()
    setProjectLanguages.mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed',
      response: { status: 400, data: { message: 'At most 100 languages' } },
    })
    const { props } = renderDialog()
    await user.type(screen.getByLabelText('Sprachcode'), 'fr{Enter}')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('At most 100 languages')
    )
    expect(props.onSaved).not.toHaveBeenCalled()
    expect(props.onOpenChange).not.toHaveBeenCalled()
    expect(listed()).toEqual(['de', 'en', 'fr'])
  })

  it('403 läuft über handleForbidden', async () => {
    const user = userEvent.setup()
    vi.mocked(handleForbidden).mockReturnValue(true)
    setProjectLanguages.mockRejectedValue({
      isAxiosError: true,
      response: { status: 403, data: {} },
    })
    renderDialog()
    await user.type(screen.getByLabelText('Sprachcode'), 'fr{Enter}')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() => expect(handleForbidden).toHaveBeenCalled())
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('Wiederöffnen beginnt mit der gespeicherten Liste', async () => {
    const user = userEvent.setup()
    const { props, rerender } = renderDialog()
    await user.click(screen.getByRole('button', { name: 'en entfernen' }))
    expect(listed()).toEqual(['de'])
    rerender(<LanguagesDialog {...props} open={false} />)
    rerender(<LanguagesDialog {...props} open />)
    expect(listed()).toEqual(['de', 'en'])
  })

  it('bei 100 Sprachen ist Hinzufügen gesperrt', () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      `x${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`.slice(
        0,
        3
      )
    )
    // 100 distinct three-letter codes
    expect(new Set(many).size).toBe(100)
    renderDialog({ languages: many })
    expect(
      screen.getByText('Maximal 100 Sprachen erreicht.')
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Sprachcode')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Hinzufügen' })).toBeDisabled()
  })

  describe('stored list as baseline and conflicts', () => {
    const conflict = {
      isAxiosError: true,
      message: 'Request failed',
      response: {
        status: 409,
        data: { message: 'Die Sprachliste wurde inzwischen geändert' },
      },
    }

    it('nimmt die gespeicherte Liste beim Öffnen als Basis und folgt späteren Props nicht', async () => {
      const user = userEvent.setup()
      setProjectLanguages.mockResolvedValue({
        languages: ['de', 'en', 'it'],
        removedValues: 0,
      })
      const { props, rerender } = renderDialog()
      rerender(<LanguagesDialog {...props} languages={['de', 'en', 'fr']} />)
      expect(listed()).toEqual(['de', 'en'])
      expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled()
      await user.type(screen.getByLabelText('Sprachcode'), 'it{Enter}')
      await user.click(screen.getByRole('button', { name: 'Speichern' }))
      await waitFor(() =>
        expect(setProjectLanguages).toHaveBeenCalledWith(
          'p1',
          ['de', 'en', 'it'],
          ['de', 'en']
        )
      )
    })

    it('409: ein Aufruf, onStale, Dialog bleibt offen mit Entwurf und Hinweis', async () => {
      const user = userEvent.setup()
      setProjectLanguages.mockRejectedValue(conflict)
      const onStale = vi.fn()
      const { props } = renderDialog({ onStale })
      await user.type(screen.getByLabelText('Sprachcode'), 'fr{Enter}')
      await user.click(screen.getByRole('button', { name: 'Speichern' }))
      await waitFor(() => expect(onStale).toHaveBeenCalledTimes(1))
      expect(setProjectLanguages).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('status')).toHaveTextContent(
        'Die Sprachliste wurde inzwischen geändert – bitte prüfen.'
      )
      expect(listed()).toEqual(['de', 'en', 'fr'])
      expect(props.onOpenChange).not.toHaveBeenCalled()
      expect(props.onSaved).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('nach 409 gilt die frische Liste: die Bestätigung nennt alle fehlenden Codes', async () => {
      const user = userEvent.setup()
      setProjectLanguages
        .mockRejectedValueOnce(conflict)
        .mockResolvedValueOnce({ languages: ['de'], removedValues: 4 })
      const onStale = vi.fn()
      const { props, rerender } = renderDialog({ onStale })

      await user.click(screen.getByRole('button', { name: 'en entfernen' }))
      await user.click(screen.getByRole('button', { name: 'Speichern' }))
      await user.click(
        screen.getByRole('button', { name: 'Entfernen und speichern' })
      )
      await waitFor(() => expect(onStale).toHaveBeenCalled())
      expect(setProjectLanguages).toHaveBeenLastCalledWith(
        'p1',
        ['de'],
        ['de', 'en']
      )
      // Back in the list after the conflict.
      expect(listed()).toEqual(['de'])

      // Another admin had added `fr`; the parent passes the fresh list.
      rerender(
        <LanguagesDialog
          {...props}
          onStale={onStale}
          languages={['de', 'en', 'fr']}
        />
      )
      expect(listed()).toEqual(['de'])
      await user.click(screen.getByRole('button', { name: 'Speichern' }))
      expect(dialog()).toHaveTextContent('Texte in en, fr werden gelöscht')
      await user.click(
        screen.getByRole('button', { name: 'Entfernen und speichern' })
      )
      await waitFor(() =>
        expect(setProjectLanguages).toHaveBeenLastCalledWith(
          'p1',
          ['de'],
          ['de', 'en', 'fr']
        )
      )
      expect(setProjectLanguages).toHaveBeenCalledTimes(2)
      await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith(['de']))
    })

    it('nach 409 in der Bestätigung kehrt der Dialog zur Liste zurück', async () => {
      const user = userEvent.setup()
      setProjectLanguages.mockRejectedValue(conflict)
      renderDialog({ onStale: vi.fn() })
      await user.click(screen.getByRole('button', { name: 'en entfernen' }))
      await user.click(screen.getByRole('button', { name: 'Speichern' }))
      await user.click(
        screen.getByRole('button', { name: 'Entfernen und speichern' })
      )
      await waitFor(() =>
        expect(
          screen.queryByRole('heading', { name: 'Sprachen entfernen?' })
        ).not.toBeInTheDocument()
      )
      expect(listed()).toEqual(['de'])
    })

    it('Wechsel der Sicht bei offenem Dialog schließt ihn und verwirft den Entwurf', async () => {
      const user = userEvent.setup()
      const { props, rerender } = renderDialog(BRAND_PROPS)
      await user.click(screen.getByRole('button', { name: 'it entfernen' }))
      rerender(
        <LanguagesDialog
          {...props}
          scope={{ kind: 'project', id: 'p1' }}
          languages={['de', 'en']}
        />
      )
      await waitFor(() =>
        expect(props.onOpenChange).toHaveBeenCalledWith(false)
      )
      expect(setProjectLanguages).not.toHaveBeenCalled()
      expect(setBrandLanguages).not.toHaveBeenCalled()
    })
  })

  describe('target selection', () => {
    const TARGET_BRANDS = [{ id: 'b1', name: 'Premium' }]
    const targetSelect = () =>
      within(dialog()).queryByRole('combobox', { name: 'Ziel' })

    beforeAll(() => {
      Element.prototype.hasPointerCapture ??= () => false
      Element.prototype.setPointerCapture ??= () => {}
      Element.prototype.releasePointerCapture ??= () => {}
    })

    it('ohne Ziel-Auswahl (keine Brands) kein Ziel-Feld', () => {
      renderDialog({
        target: { brands: [], value: null, onChange: vi.fn() },
      })
      expect(targetSelect()).toBeNull()
    })

    it('Zielwechsel ruft onChange; das neue Ziel übernimmt seine Liste, der Dialog bleibt offen', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const { props, rerender } = renderDialog({
        target: { brands: TARGET_BRANDS, value: null, onChange },
      })
      expect(targetSelect()).toHaveTextContent('Standard')
      await user.click(targetSelect() as HTMLElement)
      await user.click(await screen.findByRole('option', { name: 'Premium' }))
      expect(onChange).toHaveBeenCalledWith('b1')

      rerender(
        <LanguagesDialog
          {...props}
          scope={BRAND_PROPS.scope}
          languages={BRAND_PROPS.languages}
          target={{ brands: TARGET_BRANDS, value: 'b1', onChange }}
        />
      )
      expect(
        within(dialog()).getByRole('heading', {
          name: 'Sprachen der Brand „Premium“',
        })
      ).toBeInTheDocument()
      expect(listed()).toEqual(['de', 'it'])
      expect(props.onOpenChange).not.toHaveBeenCalled()
    })

    it('Zielwechsel bei geändertem Entwurf ist gesperrt', async () => {
      const user = userEvent.setup()
      renderDialog({
        target: { brands: TARGET_BRANDS, value: null, onChange: vi.fn() },
      })
      expect(targetSelect()).toBeEnabled()
      await user.click(screen.getByRole('button', { name: 'en entfernen' }))
      expect(targetSelect()).toBeDisabled()
      await user.type(screen.getByLabelText('Sprachcode'), 'en{Enter}')
      expect(listed()).toEqual(['de', 'en'])
      expect(targetSelect()).toBeEnabled()
    })
  })

  describe('keyboard, focus and accidental confirmation', () => {
    it('Enter im leeren Feld tut nichts', async () => {
      const user = userEvent.setup()
      renderDialog()
      await user.click(screen.getByLabelText('Sprachcode'))
      await user.keyboard('{Enter}')
      await user.type(screen.getByLabelText('Sprachcode'), '   {Enter}')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(
        screen.queryByText(/Ungültiger Sprachcode/)
      ).not.toBeInTheDocument()
      expect(listed()).toEqual(['de', 'en'])
    })

    it('Sprachliste: zeigt Name und ISO-Code, die Eingabe filtert nach Name oder Code', async () => {
      const user = userEvent.setup()
      renderDialog()
      const catalog = () =>
        screen.getByRole('group', { name: 'Sprachen mit ISO-Code' })
      expect(
        within(catalog()).getByRole('button', {
          name: 'Französisch (fr) hinzufügen',
        })
      ).toHaveTextContent('Französischfr')

      await user.type(screen.getByLabelText('Sprachcode'), 'portu')
      expect(
        within(catalog())
          .getAllByRole('button')
          .map((button) => button.getAttribute('aria-label'))
      ).toEqual([
        'Portugiesisch (pt) hinzufügen',
        'Portugiesisch (Brasilien) (pt-BR) hinzufügen',
        'Portugiesisch (Portugal) (pt-PT) hinzufügen',
      ])
    })

    it('Sprachliste: ein Klick nimmt die Sprache auf und bietet sie nicht mehr an', async () => {
      const user = userEvent.setup()
      renderDialog()
      await user.click(
        screen.getByRole('button', { name: 'Spanisch (es) hinzufügen' })
      )
      expect(
        within(screen.getByRole('list', { name: 'Ausgewählte Sprachen' }))
          .getAllByRole('listitem')
          .map((item) => item.getAttribute('data-language'))
      ).toContain('es')
      expect(
        screen.queryByRole('button', { name: 'Spanisch (es) hinzufügen' })
      ).toBeNull()
      expect(screen.getByLabelText('Sprachcode')).toHaveFocus()
    })

    it('Enter nimmt bei einem Namensanfang die passende Sprache', async () => {
      const user = userEvent.setup()
      renderDialog()
      await user.type(screen.getByLabelText('Sprachcode'), 'Italie{Enter}')
      expect(
        within(screen.getByRole('list', { name: 'Ausgewählte Sprachen' }))
          .getAllByRole('listitem')
          .map((item) => item.getAttribute('data-language'))
      ).toContain('it')
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('gewählte Sprachen tragen ihre Flagge', () => {
      renderDialog()
      const chips = within(
        screen.getByRole('list', { name: 'Ausgewählte Sprachen' })
      ).getAllByRole('listitem')
      expect(
        chips.map((chip) => [
          chip.getAttribute('data-language'),
          chip.querySelector('[data-flag]')?.getAttribute('data-flag'),
        ])
      ).toContainEqual(['de', 'de'])
    })

    it('der Validierungsfehler ist ein alert', async () => {
      const user = userEvent.setup()
      renderDialog()
      await user.type(screen.getByLabelText('Sprachcode'), 'x{Enter}')
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Ungültiger Sprachcode'
      )
    })

    it('nach Entfernen und nach einem Vorschlag liegt der Fokus im Eingabefeld', async () => {
      const user = userEvent.setup()
      renderDialog(BRAND_PROPS)
      await user.click(screen.getByRole('button', { name: 'it entfernen' }))
      expect(screen.getByLabelText('Sprachcode')).toHaveFocus()
      await user.click(screen.getByRole('button', { name: 'fr hinzufügen' }))
      expect(screen.getByLabelText('Sprachcode')).toHaveFocus()
    })

    it('die Bestätigung fokussiert „Zurück“, die Rückkehr das Eingabefeld', async () => {
      const user = userEvent.setup()
      renderDialog()
      await user.click(screen.getByRole('button', { name: 'en entfernen' }))
      await user.click(screen.getByRole('button', { name: 'Speichern' }))
      expect(screen.getByRole('button', { name: 'Zurück' })).toHaveFocus()
      await user.click(screen.getByRole('button', { name: 'Zurück' }))
      expect(screen.getByLabelText('Sprachcode')).toHaveFocus()
    })

    it('„Zurück“ steht an der Stelle von „Speichern“, nicht der Löschen-Button', async () => {
      const user = userEvent.setup()
      renderDialog()
      await user.click(screen.getByRole('button', { name: 'en entfernen' }))
      const footerButtons = () =>
        within(dialog())
          .getAllByRole('button')
          .filter((b) => b.closest('[data-testid="languages-dialog-footer"]'))
          .map((b) => b.textContent?.trim())
      expect(footerButtons()).toEqual(['Abbrechen', 'Speichern'])
      // A double click on "Speichern" must not confirm.
      await user.dblClick(screen.getByRole('button', { name: 'Speichern' }))
      expect(footerButtons()).toEqual(['Entfernen und speichern', 'Zurück'])
      expect(setProjectLanguages).not.toHaveBeenCalled()
    })

    it('Klick neben den Dialog in der Bestätigung führt zur Liste zurück', async () => {
      const user = userEvent.setup()
      const { props } = renderDialog()
      await user.click(screen.getByRole('button', { name: 'en entfernen' }))
      await user.click(screen.getByRole('button', { name: 'Speichern' }))
      // Radix listens for outside pointer downs after a tick and, for the
      // primary button, acts on the following click.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
        document.body.dispatchEvent(
          new MouseEvent('pointerdown', { bubbles: true, button: 0 })
        )
        document.body.dispatchEvent(
          new MouseEvent('click', { bubbles: true, button: 0 })
        )
      })
      expect(
        screen.queryByRole('heading', { name: 'Sprachen entfernen?' })
      ).not.toBeInTheDocument()
      expect(listed()).toEqual(['de'])
      expect(props.onOpenChange).not.toHaveBeenCalled()
      expect(setProjectLanguages).not.toHaveBeenCalled()
    })
  })
})
