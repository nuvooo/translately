import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
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
import { ImportDialog } from './ImportDialog'
import type { ImportPreview } from './types'

vi.mock('./api', () => ({ previewImport: vi.fn(), applyImport: vi.fn() }))
vi.mock('@/lib/permissions', () => ({ handleForbidden: vi.fn(() => false) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const previewImport = vi.mocked(api.previewImport)
const applyImport = vi.mocked(api.applyImport)

type Props = ComponentProps<typeof ImportDialog>

const BASE: Props = {
  open: true,
  onOpenChange: vi.fn(),
  projectId: 'p1',
  brands: [],
  namespace: 'translation',
  languages: ['de', 'en'],
  onImported: vi.fn(),
}

const ALPHA = { id: 'alpha', name: 'Alpha', languages: ['fr', 'it'] }

const PREVIEW: ImportPreview = {
  added: ['checkout.title', 'checkout.submit'],
  changed: ['home.title'],
  unchanged: ['home.text'],
  newKeys: ['checkout.title'],
  skipped: [
    { key: 'count', reason: 'not_string' },
    { key: 'blank', reason: 'empty' },
    { key: 'a..b', reason: 'invalid_key' },
    { key: 'long', reason: 'too_long' },
    { key: 'menu', reason: 'conflict' },
  ],
}

const EMPTY_PREVIEW: ImportPreview = {
  added: [],
  changed: [],
  unchanged: [],
  newKeys: [],
  skipped: [],
}

function renderDialog(overrides: Partial<Props> = {}) {
  const props: Props = {
    ...BASE,
    onOpenChange: vi.fn(),
    onImported: vi.fn(),
    ...overrides,
  }
  const view = render(<ImportDialog {...props} />)
  return { props, ...view }
}

const jsonFile = (text: string, name = 'de.json') =>
  new File([text], name, { type: 'application/json' })

const dialog = () => screen.getByRole('dialog')
const fileInput = () => screen.getByLabelText('JSON-Datei')
const button = (name: string) => within(dialog()).getByRole('button', { name })
const languageSelect = () =>
  within(dialog()).getByRole('combobox', { name: 'Sprache' })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type User = ReturnType<typeof userEvent.setup>

/** Chooses a file and waits until it has been read. */
async function choose(user: User, file: File) {
  await user.upload(fileInput(), file)
  await screen.findByText(file.name)
}

/** Chooses a valid file whose name selects `de` and opens the preview. */
async function toPreview(user: User, preview: ImportPreview = PREVIEW) {
  previewImport.mockResolvedValue(preview)
  await choose(user, jsonFile('{"checkout":{"title":"Kasse"}}'))
  await user.click(button('Vorschau'))
  await screen.findByRole('button', { name: 'Importieren' })
}

describe('ImportDialog', () => {
  beforeAll(async () => {
    Element.prototype.hasPointerCapture ??= () => false
    Element.prototype.setPointerCapture ??= () => {}
    Element.prototype.releasePointerCapture ??= () => {}
    await i18n.changeLanguage('de')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(handleForbidden).mockReturnValue(false)
  })

  it('zeigt das Ziel: Namespace, ohne Brands kein Ziel-Feld', () => {
    renderDialog()
    const target = within(dialog()).getByRole('group', { name: 'Ziel' })
    expect(within(target).getByText('translation')).toBeInTheDocument()
    expect(
      within(dialog()).queryByRole('combobox', { name: 'Ziel' })
    ).toBeNull()
    expect(dialog().textContent).not.toMatch(/environment/i)
    expect(button('Vorschau')).toBeDisabled()
  })

  it('Ziel „Alpha“: Sprachen der Brand, brandId in der Anfrage, kein environmentId', async () => {
    const user = userEvent.setup()
    previewImport.mockResolvedValue(PREVIEW)
    renderDialog({ brands: [ALPHA] })
    const targetSelect = within(dialog()).getByRole('combobox', {
      name: 'Ziel',
    })
    expect(targetSelect).toHaveTextContent('Standard')
    await user.click(targetSelect)
    await user.click(await screen.findByRole('option', { name: 'Alpha' }))
    expect(targetSelect).toHaveTextContent('Alpha')

    await user.click(languageSelect())
    expect(
      (await screen.findAllByRole('option')).map((o) => o.textContent)
    ).toEqual(['fr', 'it'])
    await user.keyboard('{Escape}')

    await choose(user, jsonFile('{"a":"b"}', 'fr.json'))
    expect(languageSelect()).toHaveTextContent(/^fr$/)
    await user.click(button('Vorschau'))
    await waitFor(() => expect(previewImport).toHaveBeenCalledTimes(1))
    const [projectId, target] = previewImport.mock.calls[0]
    expect(projectId).toBe('p1')
    expect(target).toEqual({
      language: 'fr',
      namespace: 'translation',
      brandId: 'alpha',
    })
    expect(target).not.toHaveProperty('environmentId')
  })

  it('Zielwechsel: eine Sprache, die das neue Ziel nicht hat, wird verworfen', async () => {
    const user = userEvent.setup()
    renderDialog({ brands: [ALPHA] })
    await choose(user, jsonFile('{"a":"b"}', 'de.json'))
    expect(languageSelect()).toHaveTextContent(/^de$/)
    await user.click(within(dialog()).getByRole('combobox', { name: 'Ziel' }))
    await user.click(await screen.findByRole('option', { name: 'Alpha' }))
    expect(languageSelect()).toHaveTextContent('Sprache wählen')
    expect(button('Vorschau')).toBeDisabled()
  })

  it('ungültige Datei zeigt die Meldung und ruft previewImport nicht auf', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.upload(fileInput(), jsonFile('{', 'de.json'))
    expect(
      await screen.findByText('Die Datei ist kein gültiges JSON.')
    ).toBeInTheDocument()
    expect(fileInput()).toHaveAttribute('aria-invalid', 'true')
    expect(button('Vorschau')).toBeDisabled()
    await user.click(button('Vorschau'))
    expect(previewImport).not.toHaveBeenCalled()
  })

  it('JSON ohne Objekt zeigt die Meldung und ruft nichts auf', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.upload(fileInput(), jsonFile('[1]', 'de.json'))
    expect(
      await screen.findByText(/Die Datei muss ein JSON-Objekt enthalten/)
    ).toBeInTheDocument()
    expect(button('Vorschau')).toBeDisabled()
    expect(previewImport).not.toHaveBeenCalled()
  })

  it('3 MB werden abgelehnt, ohne die Datei zu lesen und ohne Anfrage', async () => {
    const user = userEvent.setup()
    renderDialog()
    const file = new File([new Uint8Array(3 * 1024 * 1024)], 'de.json', {
      type: 'application/json',
    })
    const text = vi.spyOn(file, 'text')
    await user.upload(fileInput(), file)
    expect(
      await screen.findByText('Die Datei ist zu groß (max. 2 MB).')
    ).toBeInTheDocument()
    expect(text).not.toHaveBeenCalled()
    expect(button('Vorschau')).toBeDisabled()
    expect(previewImport).not.toHaveBeenCalled()
    expect(applyImport).not.toHaveBeenCalled()
  })

  it('de.json wählt de vor', async () => {
    const user = userEvent.setup()
    renderDialog()
    await choose(user, jsonFile('{}', 'de.json'))
    expect(languageSelect()).toHaveTextContent(/^de$/)
    expect(button('Vorschau')).toBeEnabled()
  })

  it('translation.en.json wählt en vor', async () => {
    const user = userEvent.setup()
    renderDialog()
    await choose(user, jsonFile('{}', 'translation.en.json'))
    expect(languageSelect()).toHaveTextContent(/^en$/)
  })

  it('ohne passende Sprache im Namen muss die Sprache gewählt werden', async () => {
    const user = userEvent.setup()
    previewImport.mockResolvedValue(PREVIEW)
    renderDialog()
    await choose(user, jsonFile('{"a":"b"}', 'messages-fr.json'))
    expect(languageSelect()).toHaveTextContent('Sprache wählen')
    expect(button('Vorschau')).toBeDisabled()
    await user.click(languageSelect())
    await user.click(await screen.findByRole('option', { name: 'en' }))
    expect(button('Vorschau')).toBeEnabled()
    await user.click(button('Vorschau'))
    await waitFor(() =>
      expect(previewImport).toHaveBeenCalledWith(
        'p1',
        { language: 'en', namespace: 'translation' },
        { a: 'b' }
      )
    )
  })

  it('mit genau einer Sprache ist sie unabhängig vom Dateinamen gewählt', async () => {
    const user = userEvent.setup()
    renderDialog({ languages: ['fr'] })
    await choose(user, jsonFile('{}', 'messages.json'))
    expect(languageSelect()).toHaveTextContent(/^fr$/)
    expect(button('Vorschau')).toBeEnabled()
  })

  it('ohne Sprachen gibt es einen Hinweis und keine Dateiauswahl', () => {
    renderDialog({ languages: [] })
    expect(
      within(dialog()).getByText(/Dieses Ziel hat noch keine Sprachen/)
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('JSON-Datei')).toBeNull()
    expect(
      within(dialog()).queryByRole('button', { name: 'Vorschau' })
    ).toBeNull()
  })

  it('Vorschau zeigt Zahlen und Gründe', async () => {
    const user = userEvent.setup()
    renderDialog()
    await toPreview(user)
    expect(previewImport).toHaveBeenCalledWith(
      'p1',
      { language: 'de', namespace: 'translation' },
      { checkout: { title: 'Kasse' } }
    )
    const d = dialog()
    expect(within(d).getByText('Neu: 2')).toBeInTheDocument()
    expect(within(d).getByText('Geändert: 1')).toBeInTheDocument()
    expect(within(d).getByText('Unverändert: 1')).toBeInTheDocument()
    expect(within(d).getByText('Neue Keys: 1')).toBeInTheDocument()
    expect(within(d).getByText('Übersprungen: 5')).toBeInTheDocument()
    const skipped = within(d).getByRole('list', {
      name: 'Übersprungene Einträge',
    })
    const items = within(skipped).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual([
      'count – Kein Text (Zahl, Wahrheitswert, null oder Liste)',
      'blank – Leerer Text',
      'a..b – Ungültiger Key',
      'long – Text länger als 10.000 Zeichen',
      'menu – Key kollidiert mit einem anderen Key (z. B. „a“ und „a.b“)',
    ])
    expect(within(d).getByText('Es wird nichts gelöscht.')).toBeInTheDocument()
    expect(within(d).getByRole('list', { name: 'Neu' })).toHaveTextContent(
      'checkout.title'
    )
    expect(button('Importieren')).toBeEnabled()
  })

  it('lange Listen zeigen höchstens 100 Einträge und „und n weitere“', async () => {
    const user = userEvent.setup()
    renderDialog()
    const added = Array.from({ length: 150 }, (_, i) => `key.${i}`)
    const skipped = Array.from({ length: 130 }, (_, i) => ({
      key: `bad.${i}`,
      reason: 'empty' as const,
    }))
    await toPreview(user, { ...EMPTY_PREVIEW, added, skipped })
    const list = within(dialog()).getByRole('list', { name: 'Neu' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(100)
    expect(within(dialog()).getByText('und 50 weitere')).toBeInTheDocument()
    const skippedList = within(dialog()).getByRole('list', {
      name: 'Übersprungene Einträge',
    })
    expect(within(skippedList).getAllByRole('listitem')).toHaveLength(100)
    expect(within(dialog()).getByText('und 30 weitere')).toBeInTheDocument()
  })

  it('lange Keys stehen vollständig im title', async () => {
    const user = userEvent.setup()
    renderDialog()
    const long = `${'segment.'.repeat(40)}end`
    await toPreview(user, { ...EMPTY_PREVIEW, added: [long] })
    const list = within(dialog()).getByRole('list', { name: 'Neu' })
    expect(within(list).getByText(long)).toHaveAttribute('title', long)
  })

  it('„Importieren“ ruft applyImport mit Ziel und demselben Inhalt, danach onImported', async () => {
    const user = userEvent.setup()
    applyImport.mockResolvedValue({
      ...EMPTY_PREVIEW,
      added: ['a', 'b', 'c'],
      unchanged: ['d'],
      skipped: [{ key: 'x', reason: 'empty' }],
    })
    const { props } = renderDialog()
    await toPreview(user)
    expect(applyImport).not.toHaveBeenCalled()
    await user.click(button('Importieren'))
    await waitFor(() => expect(props.onImported).toHaveBeenCalledTimes(1))
    expect(applyImport).toHaveBeenCalledTimes(1)
    const [projectId, target, content] = applyImport.mock.calls[0]
    expect(projectId).toBe('p1')
    expect(target).toEqual({
      language: 'de',
      namespace: 'translation',
    })
    // The very object the preview was computed for.
    expect(content).toBe(previewImport.mock.calls[0][2])
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
    // The numbers of the import itself, not of the preview.
    expect(toast.success).toHaveBeenCalledWith(
      'Import abgeschlossen: 3 neu, 0 geändert, 1 unverändert, 1 übersprungen.'
    )
  })

  it('nur unveränderte Einträge → „Importieren“ deaktiviert', async () => {
    const user = userEvent.setup()
    renderDialog()
    await toPreview(user, { ...EMPTY_PREVIEW, unchanged: ['a', 'b'] })
    expect(button('Importieren')).toBeDisabled()
    expect(
      within(dialog()).getByText(/Nichts zu importieren/)
    ).toBeInTheDocument()
    await user.click(button('Importieren'))
    expect(applyImport).not.toHaveBeenCalled()
  })

  it('413 vom Backend → Größenhinweis mit 2 MB aus den Locales, Dialog bleibt mit Datei und Sprache', async () => {
    const user = userEvent.setup()
    previewImport.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 413,
        data: { statusCode: 413, message: 'Datei zu groß (max. 2 MB)' },
      },
    })
    const { props } = renderDialog()
    await choose(user, jsonFile('{"a":"b"}'))
    await user.click(button('Vorschau'))
    expect(
      await within(dialog()).findByText('Die Datei ist zu groß (max. 2 MB).')
    ).toBeInTheDocument()
    expect(within(dialog()).getByText('de.json')).toBeInTheDocument()
    expect(languageSelect()).toHaveTextContent(/^de$/)
    expect(button('Vorschau')).toBeEnabled()
    expect(props.onOpenChange).not.toHaveBeenCalled()
    expect(applyImport).not.toHaveBeenCalled()
  })

  it('413 vom Backend wegen zu vieler Einträge → Text aus den Locales statt englischer Servermeldung', async () => {
    const user = userEvent.setup()
    previewImport.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 413,
        data: { statusCode: 413, message: 'Too many entries (max. 20000)' },
      },
    })
    renderDialog()
    await choose(user, jsonFile('{"a":"b"}'))
    await user.click(button('Vorschau'))
    expect(
      await within(dialog()).findByText(
        'Die Datei enthält zu viele Einträge (höchstens 20.000).'
      )
    ).toBeInTheDocument()
    expect(within(dialog()).queryByText(/Too many entries/)).toBeNull()
  })

  it('413 von einem Proxy (HTML-Antwort) → „Datei zu groß.“ ohne Grenze, kein rohes HTML', async () => {
    const user = userEvent.setup()
    previewImport.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 413,
        data: '<html><head><title>413 Request Entity Too Large</title></head><body><center><h1>413 Request Entity Too Large</h1></center><hr><center>nginx</center></body></html>',
      },
    })
    renderDialog()
    await choose(user, jsonFile('{"a":"b"}'))
    await user.click(button('Vorschau'))
    expect(
      await within(dialog()).findByText('Die Datei ist zu groß.')
    ).toBeInTheDocument()
    expect(
      within(dialog()).queryByText(/Request Entity|<html>|2 MB\)/)
    ).toBeNull()
  })

  it('413 ohne Antwortinhalt → „Datei zu groß.“ ohne Grenze', async () => {
    const user = userEvent.setup()
    previewImport.mockRejectedValue({
      isAxiosError: true,
      response: { status: 413, data: {} },
    })
    renderDialog()
    await choose(user, jsonFile('{"a":"b"}'))
    await user.click(button('Vorschau'))
    expect(
      await within(dialog()).findByText('Die Datei ist zu groß.')
    ).toBeInTheDocument()
  })

  it('400 zeigt die Servermeldung im Dialog', async () => {
    const user = userEvent.setup()
    previewImport.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { message: 'Unknown namespace' } },
    })
    renderDialog()
    await choose(user, jsonFile('{"a":"b"}'))
    await user.click(button('Vorschau'))
    expect(
      await within(dialog()).findByText('Unknown namespace')
    ).toBeInTheDocument()
  })

  it('403 geht an handleForbidden, sonst ein allgemeiner Fehler', async () => {
    const user = userEvent.setup()
    vi.mocked(handleForbidden).mockReturnValueOnce(true)
    const forbidden = {
      isAxiosError: true,
      response: { status: 403, data: {} },
    }
    previewImport.mockRejectedValueOnce(forbidden)
    previewImport.mockRejectedValueOnce(new Error('network'))
    renderDialog()
    await choose(user, jsonFile('{"a":"b"}'))
    await user.click(button('Vorschau'))
    await waitFor(() =>
      expect(handleForbidden).toHaveBeenCalledWith(forbidden, expect.anything())
    )
    expect(
      within(dialog()).queryByText('Der Import ist fehlgeschlagen.')
    ).toBeNull()
    await waitFor(() => expect(button('Vorschau')).toBeEnabled())
    await user.click(button('Vorschau'))
    expect(
      await within(dialog()).findByText('Der Import ist fehlgeschlagen.')
    ).toBeInTheDocument()
  })

  it('Fehler beim Importieren: Dialog bleibt in der Vorschau, erneut möglich', async () => {
    const user = userEvent.setup()
    applyImport.mockRejectedValueOnce(new Error('boom'))
    applyImport.mockResolvedValueOnce(PREVIEW)
    const { props } = renderDialog()
    await toPreview(user)
    await user.click(button('Importieren'))
    expect(
      await within(dialog()).findByText('Der Import ist fehlgeschlagen.')
    ).toBeInTheDocument()
    expect(props.onImported).not.toHaveBeenCalled()
    expect(props.onOpenChange).not.toHaveBeenCalled()
    await user.click(button('Importieren'))
    await waitFor(() => expect(props.onImported).toHaveBeenCalledTimes(1))
  })

  it('ein zweiter Klick während der Anfrage wird ignoriert', async () => {
    const user = userEvent.setup()
    const pending = deferred<ImportPreview>()
    applyImport.mockReturnValue(pending.promise)
    renderDialog()
    await toPreview(user)
    await user.click(button('Importieren'))
    expect(button('Importieren')).toBeDisabled()
    await user.click(button('Importieren'))
    expect(applyImport).toHaveBeenCalledTimes(1)
    pending.resolve(PREVIEW)
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
  })

  it('„Zurück“ behält Datei und Sprache', async () => {
    const user = userEvent.setup()
    renderDialog()
    await toPreview(user)
    await user.click(button('Zurück'))
    expect(within(dialog()).getByText('de.json')).toBeInTheDocument()
    expect(languageSelect()).toHaveTextContent(/^de$/)
    expect(button('Vorschau')).toBeEnabled()
  })

  it('Brand-Ziel: brandId in der Anfrage und Hinweis auf Standardtexte', async () => {
    const user = userEvent.setup()
    applyImport.mockResolvedValue(PREVIEW)
    renderDialog({
      brands: [{ id: 'b1', name: 'Premium', languages: ['de', 'en'] }],
    })
    await user.click(within(dialog()).getByRole('combobox', { name: 'Ziel' }))
    await user.click(await screen.findByRole('option', { name: 'Premium' }))
    await toPreview(user)
    const target = {
      language: 'de',
      namespace: 'translation',
      brandId: 'b1',
    }
    expect(previewImport).toHaveBeenCalledWith('p1', target, expect.anything())
    expect(
      within(dialog()).getByText(/dem Standardtext entsprechen/)
    ).toBeInTheDocument()
    await user.click(button('Importieren'))
    await waitFor(() =>
      expect(applyImport).toHaveBeenCalledWith('p1', target, expect.anything())
    )
  })

  it('das Ziel bleibt beim Öffnen fest, auch wenn sich die Props ändern', async () => {
    const user = userEvent.setup()
    applyImport.mockResolvedValue(PREVIEW)
    const { props, rerender } = renderDialog()
    await choose(user, jsonFile('{"a":"b"}'))
    rerender(
      <ImportDialog
        {...props}
        projectId="p2"
        brands={[{ id: 'b9', name: 'Other', languages: ['de'] }]}
        namespace="admin"
        languages={['en']}
      />
    )
    expect(
      within(dialog()).queryByRole('combobox', { name: 'Ziel' })
    ).toBeNull()
    previewImport.mockResolvedValue(PREVIEW)
    await user.click(button('Vorschau'))
    await screen.findByRole('button', { name: 'Importieren' })
    await user.click(button('Importieren'))
    await waitFor(() => expect(applyImport).toHaveBeenCalled())
    const target = {
      language: 'de',
      namespace: 'translation',
    }
    expect(previewImport).toHaveBeenCalledWith('p1', target, { a: 'b' })
    expect(applyImport).toHaveBeenCalledWith('p1', target, { a: 'b' })
  })

  it('erneutes Öffnen beginnt bei Schritt 1 ohne Datei', async () => {
    const user = userEvent.setup()
    const { props, rerender } = renderDialog()
    await toPreview(user)
    rerender(<ImportDialog {...props} open={false} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    rerender(<ImportDialog {...props} open />)
    expect(button('Vorschau')).toBeDisabled()
    expect(within(dialog()).queryByText('de.json')).toBeNull()
    expect(
      within(dialog()).queryByRole('button', { name: 'Importieren' })
    ).toBeNull()
  })

  it('eine neue Datei verwirft die Vorschau-Grundlage: Vorschau läuft mit dem neuen Inhalt', async () => {
    const user = userEvent.setup()
    renderDialog()
    await toPreview(user)
    await user.click(button('Zurück'))
    await choose(user, jsonFile('{"x":"y"}', 'other.de.json'))
    await user.click(button('Vorschau'))
    await screen.findByRole('button', { name: 'Importieren' })
    expect(previewImport).toHaveBeenLastCalledWith(
      'p1',
      expect.objectContaining({ language: 'de' }),
      { x: 'y' }
    )
  })

  it('nimmt eine auf den Bereich gezogene Datei an', async () => {
    renderDialog()
    const zone = within(dialog()).getByTestId('import-drop-zone')
    fireEvent.drop(zone, {
      dataTransfer: { files: [jsonFile('{"a":"b"}', 'en.json')] },
    })
    expect(await within(dialog()).findByText('en.json')).toBeInTheDocument()
    expect(languageSelect()).toHaveTextContent(/^en$/)
  })
})
