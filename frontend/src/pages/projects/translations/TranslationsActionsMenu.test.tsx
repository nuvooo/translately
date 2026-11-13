import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { MemoryRouter } from 'react-router-dom'
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
import * as api from './api'
import * as saveBlob from './saveBlob'
import { TranslationsActionsMenu } from './TranslationsActionsMenu'
import * as zip from './zip'

vi.mock('./api', () => ({ exportFile: vi.fn() }))
vi.mock('./saveBlob', () => ({ saveBlobAsFile: vi.fn() }))
vi.mock('./zip', () => ({
  zipFiles: vi.fn((files: { name: string }[]) =>
    Promise.resolve(new Blob([files.map((file) => file.name).join(',')]))
  ),
}))
vi.mock('@/lib/permissions', () => ({ handleForbidden: vi.fn(() => false) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const exportFile = vi.mocked(api.exportFile)
const save = vi.mocked(saveBlob.saveBlobAsFile)
const zipFiles = vi.mocked(zip.zipFiles)

type Props = ComponentProps<typeof TranslationsActionsMenu>

const BASE: Props = {
  projectId: 'p1',
  projectKey: 'shop',
  brands: [],
  projectLanguages: ['de', 'en'],
  namespace: 'translation',
  organizationId: 'o1',
}

const ALPHA = {
  id: 'alpha',
  key: 'alpha',
  name: 'Alpha',
  languages: ['fr', 'it'],
}

function renderMenu(props: Partial<Props> = {}) {
  const user = userEvent.setup()
  const utils = render(
    <MemoryRouter>
      <TranslationsActionsMenu {...BASE} {...props} />
    </MemoryRouter>
  )
  return { user, ...utils }
}

const trigger = () => screen.getByRole('button', { name: 'Aktionen' })
const item = (name: string) => screen.getByRole('menuitem', { name })
const itemNames = () =>
  screen.getAllByRole('menuitem').map((entry) => entry.textContent)
/** Entries of the export submenu: the languages offered for download. */
const languageItems = () =>
  itemNames().filter((name) => /^[a-z]{2}$/.test(name ?? ''))

/**
 * Chooses an entry of the export submenu. Without pointer movement: jsdom has
 * no layout, so Radix cannot tell that the pointer stays inside the submenu.
 */
const choose = (entry: HTMLElement) => fireEvent.click(entry)

async function openExport(user: ReturnType<typeof userEvent.setup>) {
  await user.click(trigger())
  await user.click(item('Exportieren'))
}

describe('TranslationsActionsMenu', () => {
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
    exportFile.mockResolvedValue(new Blob(['{}']))
  })

  describe('entries', () => {
    it('always offers the snippet and the export, the others only with a handler', async () => {
      const { user } = renderMenu()
      await user.click(trigger())
      expect(itemNames()).toEqual(['Für i18next einrichten', 'Exportieren'])
    })

    it('lists languages, import and AI translation and calls their handlers', async () => {
      const onManageLanguages = vi.fn()
      const onImport = vi.fn()
      const onAiTranslate = vi.fn()
      const { user } = renderMenu({
        onManageLanguages,
        onImport,
        onAiTranslate,
      })

      await user.click(trigger())
      expect(itemNames()).toEqual([
        'Sprachen verwalten',
        'JSON importieren',
        'Mit KI übersetzen',
        'Für i18next einrichten',
        'Exportieren',
      ])
      await user.click(item('Sprachen verwalten'))
      expect(onManageLanguages).toHaveBeenCalledTimes(1)
      // Choosing an entry closes the menu.
      expect(screen.queryByRole('menu')).toBeNull()

      await user.click(trigger())
      await user.click(item('JSON importieren'))
      expect(onImport).toHaveBeenCalledTimes(1)

      await user.click(trigger())
      await user.click(item('Mit KI übersetzen'))
      expect(onAiTranslate).toHaveBeenCalledTimes(1)
    })

    it('disables the entries it is told to', async () => {
      const onManageLanguages = vi.fn()
      const { user } = renderMenu({
        onManageLanguages,
        languagesDisabled: true,
        onImport: vi.fn(),
        importDisabled: true,
        onAiTranslate: vi.fn(),
        aiDisabled: true,
        exportDisabled: true,
      })
      await user.click(trigger())
      for (const name of [
        'Sprachen verwalten',
        'JSON importieren',
        'Mit KI übersetzen',
        'Exportieren',
      ]) {
        expect(item(name)).toHaveAttribute('aria-disabled', 'true')
      }
      expect(item('Für i18next einrichten')).not.toHaveAttribute(
        'aria-disabled'
      )
    })

    it('opens the snippet dialog', async () => {
      const { user } = renderMenu()
      await user.click(trigger())
      await user.click(item('Für i18next einrichten'))
      expect(
        await screen.findByRole('dialog', { name: /i18next/i })
      ).toBeInTheDocument()
    })
  })

  describe('export', () => {
    it('offers a submenu with one entry per language and downloads <ns>.<lng>.json', async () => {
      const { user } = renderMenu()
      await openExport(user)
      expect(languageItems()).toEqual(['de', 'en'])
      choose(item('en'))

      await waitFor(() => expect(save).toHaveBeenCalled())
      expect(exportFile).toHaveBeenCalledWith('p1', {
        language: 'en',
        namespace: 'translation',
      })
      expect(save).toHaveBeenCalledWith(expect.any(Blob), 'translation.en.json')
    })

    it('without brands there is no target radio group', async () => {
      const { user } = renderMenu()
      await openExport(user)
      expect(screen.queryByRole('menuitemradio')).toBeNull()
      expect(screen.queryByRole('group', { name: 'Ziel' })).toBeNull()
    })

    it('is a plain entry with exactly one language and no brands', async () => {
      const { user } = renderMenu({ projectLanguages: ['de'] })
      await openExport(user)
      await waitFor(() => expect(save).toHaveBeenCalled())
      expect(save).toHaveBeenCalledWith(expect.any(Blob), 'translation.de.json')
      expect(screen.queryByRole('menu')).toBeNull()
    })

    it('target brand: the submenu lists its languages and the export carries brandId', async () => {
      const { user } = renderMenu({ brands: [ALPHA] })
      await openExport(user)
      expect(
        screen.getByRole('menuitemradio', { name: 'Standard' })
      ).toHaveAttribute('aria-checked', 'true')
      expect(languageItems()).toEqual(['de', 'en'])

      choose(screen.getByRole('menuitemradio', { name: 'Alpha' }))
      // Choosing the target keeps the menu open for the language.
      expect(
        screen.getByRole('menuitemradio', { name: 'Alpha' })
      ).toHaveAttribute('aria-checked', 'true')
      expect(languageItems()).toEqual(['fr', 'it'])
      choose(item('fr'))

      await waitFor(() => expect(save).toHaveBeenCalled())
      expect(exportFile).toHaveBeenCalledWith('p1', {
        language: 'fr',
        namespace: 'translation',
        brandId: 'alpha',
      })
    })

    it('with brands it stays a submenu even with one project language', async () => {
      const { user } = renderMenu({ brands: [ALPHA], projectLanguages: ['de'] })
      await openExport(user)
      expect(languageItems()).toEqual(['de'])
      expect(exportFile).not.toHaveBeenCalled()
    })

    it('is enabled when only a brand has languages', async () => {
      const { user } = renderMenu({ brands: [ALPHA], projectLanguages: [] })
      await user.click(trigger())
      expect(item('Exportieren')).not.toHaveAttribute('aria-disabled')
    })

    it('is disabled with a hint when there is no language at all', async () => {
      const { user } = renderMenu({
        projectLanguages: [],
        brands: [{ ...ALPHA, languages: [] }],
      })
      await user.click(trigger())
      const entry = screen.getByRole('menuitem', { name: /Exportieren/ })
      expect(entry).toHaveAttribute('aria-disabled', 'true')
      expect(entry.textContent).not.toBe('Exportieren')
    })

    it('shows a running download on the menu button and blocks a second one', async () => {
      let finish!: (b: Blob) => void
      exportFile.mockReturnValue(
        new Promise<Blob>((resolve) => {
          finish = resolve
        })
      )
      const { user, container } = renderMenu({ projectLanguages: ['de'] })
      await openExport(user)
      expect(container.querySelector('.animate-spin')).not.toBeNull()

      await user.click(trigger())
      expect(item('Exportieren')).toHaveAttribute('aria-disabled', 'true')

      finish(new Blob(['{}']))
      await waitFor(() =>
        expect(container.querySelector('.animate-spin')).toBeNull()
      )
      expect(item('Exportieren')).not.toHaveAttribute('aria-disabled')
    })

    it('all languages: one request per language, saved as <project>.<ns>.zip', async () => {
      const { user } = renderMenu()
      await openExport(user)
      choose(item('Alle Sprachen (ZIP)'))

      await waitFor(() => expect(save).toHaveBeenCalled())
      expect(exportFile.mock.calls.map((call) => call[1])).toEqual([
        { language: 'de', namespace: 'translation' },
        { language: 'en', namespace: 'translation' },
      ])
      expect(zipFiles.mock.calls[0][0].map((file) => file.name)).toEqual([
        'translation.de.json',
        'translation.en.json',
      ])
      expect(save).toHaveBeenCalledTimes(1)
      expect(save).toHaveBeenCalledWith(
        expect.any(Blob),
        'shop.translation.zip'
      )
    })

    it('all languages of a brand: brand languages, brandId and the brand key in the name', async () => {
      const { user } = renderMenu({ brands: [ALPHA] })
      await openExport(user)
      choose(screen.getByRole('menuitemradio', { name: 'Alpha' }))
      choose(item('Alle Sprachen (ZIP)'))

      await waitFor(() => expect(save).toHaveBeenCalled())
      expect(exportFile.mock.calls.map((call) => call[1])).toEqual([
        { language: 'fr', namespace: 'translation', brandId: 'alpha' },
        { language: 'it', namespace: 'translation', brandId: 'alpha' },
      ])
      expect(save).toHaveBeenCalledWith(
        expect.any(Blob),
        'shop.alpha.translation.zip'
      )
    })

    it('all languages: saves nothing when one language fails', async () => {
      exportFile
        .mockResolvedValueOnce(new Blob(['{}']))
        .mockRejectedValueOnce(new Error('boom'))
      const { user } = renderMenu()
      await openExport(user)
      choose(item('Alle Sprachen (ZIP)'))

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          'Der Export ist fehlgeschlagen.'
        )
      )
      expect(zipFiles).not.toHaveBeenCalled()
      expect(save).not.toHaveBeenCalled()
    })

    it('offers no ZIP entry for a single language', async () => {
      const { user } = renderMenu({ brands: [ALPHA], projectLanguages: ['de'] })
      await openExport(user)
      expect(screen.queryByRole('menuitem', { name: /ZIP/ })).toBeNull()
    })

    it('toasts a generic error when the export fails', async () => {
      exportFile.mockRejectedValue(new Error('boom'))
      const { user } = renderMenu({ projectLanguages: ['de'] })
      await openExport(user)
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          'Der Export ist fehlgeschlagen.'
        )
      )
      expect(save).not.toHaveBeenCalled()
    })
  })
})
