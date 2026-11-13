import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { TranslationsTable } from './TranslationsTable'
import type { TableRow, TranslationTable } from './types'

type TranslationsTableProps = Parameters<typeof TranslationsTable>[0]

const ROW_1: TableRow = {
  keyId: 'k1',
  key: 'checkout.title',
  description: null,
  locked: false,
  values: {
    de: { value: 'Kasse', inherited: false },
    en: { value: 'Checkout', inherited: false },
  },
  overrides: { alpha: { de: 'Alpha-Kasse' } },
}

const ROW_2: TableRow = {
  keyId: 'k2',
  key: 'checkout.total',
  description: null,
  locked: false,
  values: {
    de: { value: 'Summe', inherited: false },
    en: { value: 'Total', inherited: false },
  },
  overrides: {},
}

const TABLE: TranslationTable = {
  languages: ['de', 'en', 'fr'],
  namespaces: ['translation'],
  rows: [ROW_1, ROW_2],
  total: 2,
  page: 1,
  pageSize: 50,
}

const BRANDS = [
  { id: 'alpha', name: 'Alpha', languages: ['de', 'fr'] },
  { id: 'beta', name: 'Beta', languages: ['de'] },
]

function setup(
  options: {
    brands?: typeof BRANDS
    readOnly?: boolean
    canDelete?: boolean
    table?: TranslationTable
    onSuggest?: TranslationsTableProps['onSuggest']
  } = {}
) {
  const handlers = {
    isBusy: vi.fn(() => false),
    onSave: vi.fn(() => Promise.resolve(true)),
    onUnlink: vi.fn(() => Promise.resolve(true)),
    onRelink: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onLock: vi.fn(),
    onPage: vi.fn(),
  }
  const user = userEvent.setup()
  const props = {
    table: options.table ?? TABLE,
    brands: options.brands ?? BRANDS,
    projectLanguages: ['de', 'en'],
    readOnly: options.readOnly ?? false,
    canDelete: options.canDelete ?? false,
    onSuggest: options.onSuggest,
    ...handlers,
  }
  const utils = render(<TranslationsTable {...props} />)
  const rerender = (extra: Partial<typeof props>) =>
    utils.rerender(<TranslationsTable {...props} {...extra} />)
  return { ...utils, ...handlers, rerender, user }
}

const expander = (key: string) =>
  screen.getByRole('button', { name: `Brands für ${key} anzeigen` })
const brandRow = (name: string) =>
  screen.getByRole('rowheader', { name }).closest('tr') as HTMLElement

describe('TranslationsTable', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('de')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('zugeklappt: keine Brand-Zeilen, Hinweis nur bei eigenen Texten', () => {
    setup()
    expect(
      screen.queryByRole('rowheader', { name: 'Alpha' })
    ).not.toBeInTheDocument()
    const key1 = screen.getByRole('rowheader', { name: /checkout\.title/ })
    const key2 = screen.getByRole('rowheader', { name: /checkout\.total/ })
    expect(
      within(key1).getByText('1 Brand mit eigenem Text')
    ).toBeInTheDocument()
    expect(within(key2).queryByText(/Brand/)).not.toBeInTheDocument()
    expect(expander('checkout.title')).toHaveAttribute('aria-expanded', 'false')
  })

  it('Klick auf den Pfeil klappt nur diese Zeile auf', async () => {
    const { user } = setup()
    await user.click(expander('checkout.title'))
    const toggle = screen.getByRole('button', {
      name: 'Brands für checkout.title ausblenden',
    })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('rowheader', { name: 'Alpha' })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: 'Beta' })).toBeInTheDocument()
    // aria-controls points at the brand rows
    const controls = toggle.getAttribute('aria-controls')?.split(' ') ?? []
    expect(controls).toHaveLength(2)
    for (const id of controls) {
      expect(document.getElementById(id)?.tagName).toBe('TR')
    }
    expect(expander('checkout.total')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getAllByRole('rowheader', { name: 'Alpha' })).toHaveLength(1)
  })

  it('eigener Brand-Text: „Wieder verknüpfen“ ruft onRelink', async () => {
    const { user, onRelink } = setup()
    await user.click(expander('checkout.title'))
    const alpha = brandRow('Alpha')
    expect(within(alpha).getByText('Alpha-Kasse')).toBeInTheDocument()
    await user.click(
      within(alpha).getByRole('button', {
        name: 'Wieder verknüpfen: checkout.title – de – Alpha',
      })
    )
    expect(onRelink).toHaveBeenCalledWith(ROW_1, 'de', 'alpha')
  })

  it('geerbter Brand-Text: „Lösen“ ruft onUnlink und öffnet den Editor', async () => {
    const { user, onUnlink } = setup()
    await user.click(expander('checkout.title'))
    const beta = brandRow('Beta')
    expect(within(beta).getByText('Kasse')).toBeInTheDocument()
    expect(
      within(beta).getByText('Aus dem Standard übernommen')
    ).toBeInTheDocument()
    await user.click(
      within(beta).getByRole('button', {
        name: 'Lösen: checkout.title – de – Beta',
      })
    )
    expect(onUnlink).toHaveBeenCalledWith(ROW_1, 'de', 'beta')
    const editor = await within(beta).findByRole('textbox', {
      name: 'checkout.title – de – Beta',
    })
    expect(editor).toHaveValue('Kasse')
    expect(editor).toHaveFocus()
  })

  it('Sprache, die die Brand nicht anbietet, ist gesperrt', async () => {
    const { user } = setup()
    await user.click(expander('checkout.title'))
    const beta = brandRow('Beta')
    expect(
      within(beta).queryByRole('button', {
        name: 'checkout.title – en – Beta',
      })
    ).not.toBeInTheDocument()
    expect(
      within(beta).getAllByTitle('Die Brand bietet diese Sprache nicht an')
    ).toHaveLength(2)
  })

  it('Standardzelle einer Nicht-Projektsprache ist gesperrt', () => {
    setup()
    expect(
      screen.queryByRole('button', { name: 'checkout.title – fr' })
    ).not.toBeInTheDocument()
    expect(
      screen.getAllByTitle('Keine Projektsprache – hier haben nur Brands Texte')
    ).toHaveLength(2)
  })

  it('Brand-Zelle speichert mit der Brand-Id', async () => {
    const { user, onSave } = setup()
    await user.click(expander('checkout.title'))
    await user.click(
      screen.getByRole('button', { name: 'checkout.title – fr – Alpha' })
    )
    await user.keyboard('Bonjour{Enter}')
    expect(onSave).toHaveBeenCalledWith(ROW_1, 'fr', 'Bonjour', 'alpha')
  })

  it('ohne Brands: kein Pfeil und keine Legende', () => {
    setup({ brands: [] })
    expect(
      screen.queryByRole('button', { name: /Brands für/ })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Text kommt aus dem Standard')
    ).not.toBeInTheDocument()
  })

  it('mit Brands: Legende sichtbar', () => {
    setup()
    expect(screen.getByText('Text kommt aus dem Standard')).toBeInTheDocument()
  })

  it('readOnly: Brand-Zeilen sichtbar, aber nichts bearbeitbar', async () => {
    const { user } = setup({ readOnly: true })
    await user.click(expander('checkout.title'))
    const alpha = brandRow('Alpha')
    const beta = brandRow('Beta')
    expect(within(alpha).getByText('Alpha-Kasse')).toBeInTheDocument()
    expect(within(beta).getByText('Kasse')).toBeInTheDocument()
    expect(within(alpha).queryByRole('button')).not.toBeInTheDocument()
    expect(within(beta).queryByRole('button')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Lösen|Wieder verknüpfen/ })
    ).not.toBeInTheDocument()
  })

  it('Seitenwechsel klappt alle Zeilen wieder zu', async () => {
    const { user, rerender } = setup({ table: { ...TABLE, total: 120 } })
    await user.click(expander('checkout.title'))
    await user.click(expander('checkout.total'))
    expect(screen.getAllByRole('rowheader', { name: 'Alpha' })).toHaveLength(2)
    rerender({ table: { ...TABLE, total: 120, page: 2 } })
    expect(
      screen.queryByRole('rowheader', { name: 'Alpha' })
    ).not.toBeInTheDocument()
    expect(expander('checkout.title')).toHaveAttribute('aria-expanded', 'false')
  })

  describe('KI-Vorschlag', () => {
    const SUGGEST = 'KI-Vorschlag'
    const PARTIAL: TableRow = {
      keyId: 'k3',
      key: 'checkout.hint',
      description: null,
      locked: false,
      values: {
        de: { value: 'Hinweis', inherited: false },
        en: { value: null, inherited: false },
      },
      overrides: {},
    }
    const EMPTY: TableRow = {
      keyId: 'k4',
      key: 'checkout.empty',
      description: null,
      locked: false,
      values: {},
      overrides: {},
    }
    const BRANDED: TableRow = {
      keyId: 'k5',
      key: 'checkout.brand',
      description: null,
      locked: false,
      values: {
        de: { value: 'Hallo', inherited: false },
        en: { value: 'Hello', inherited: false },
      },
      overrides: { alpha: { fr: 'Bonjour' } },
    }
    const AI_TABLE: TranslationTable = {
      ...TABLE,
      rows: [PARTIAL, EMPTY, BRANDED],
      total: 3,
    }
    const suggest = () =>
      vi.fn(() =>
        Promise.resolve({
          keyId: 'k',
          value: 'Hint',
          placeholderMismatch: false,
        })
      )

    it('fehlendes en mit de-Text: Knopf im en-Editor ruft onSuggest mit de als Quelle', async () => {
      const onSuggest = suggest()
      const { user } = setup({ table: AI_TABLE, onSuggest, brands: [] })
      expect(
        screen.queryByRole('button', { name: SUGGEST })
      ).not.toBeInTheDocument()
      await user.click(
        screen.getByRole('button', { name: 'checkout.hint – en' })
      )
      await user.click(screen.getByRole('button', { name: SUGGEST }))
      expect(onSuggest).toHaveBeenCalledWith(PARTIAL, 'en', 'de', undefined)
      expect(
        screen.getByRole('textbox', { name: 'checkout.hint – en' })
      ).toHaveValue('Hint')
    })

    it('Zeile ohne irgendeinen Text: kein Knopf', async () => {
      const { user } = setup({
        table: AI_TABLE,
        onSuggest: suggest(),
        brands: [],
      })
      await user.click(
        screen.getByRole('button', { name: 'checkout.empty – en' })
      )
      expect(
        screen.getByRole('textbox', { name: 'checkout.empty – en' })
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: SUGGEST })
      ).not.toBeInTheDocument()
    })

    it('Brand-Zelle ruft onSuggest mit der Brand-Id', async () => {
      const onSuggest = suggest()
      const { user } = setup({ onSuggest })
      await user.click(expander('checkout.title'))
      await user.click(
        screen.getByRole('button', { name: 'checkout.title – fr – Alpha' })
      )
      await user.click(screen.getByRole('button', { name: SUGGEST }))
      expect(onSuggest).toHaveBeenCalledWith(ROW_1, 'fr', 'de', 'alpha')
    })

    it('Brand-Zelle: eigene Texte der Brand gehen als Quelle vor', async () => {
      const onSuggest = suggest()
      const { user } = setup({ table: AI_TABLE, onSuggest })
      await user.click(expander('checkout.brand'))
      // inherited "Hallo": the button is offered; fr (own text) beats en
      await user.click(
        screen.getByRole('button', { name: 'checkout.brand – de – Alpha' })
      )
      await user.click(screen.getByRole('button', { name: SUGGEST }))
      expect(onSuggest).toHaveBeenCalledWith(BRANDED, 'de', 'fr', 'alpha')
    })

    it('readOnly: kein Knopf', async () => {
      const { user } = setup({
        table: AI_TABLE,
        onSuggest: suggest(),
        readOnly: true,
      })
      await user.click(expander('checkout.hint'))
      await user.click(screen.getAllByText('fehlt')[0])
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: SUGGEST })
      ).not.toBeInTheDocument()
    })
  })

  it('Pfeil per Tastatur: Fokus + Enter klappt auf', async () => {
    const { user } = setup()
    expander('checkout.title').focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('rowheader', { name: 'Alpha' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'Brands für checkout.title ausblenden',
      })
    ).toHaveFocus()
  })

  it('Spaltenkopf: Flagge und Code der Sprache, der Name als Tooltip', () => {
    setup()
    const head = (code: string) =>
      screen.getByRole('columnheader', { name: code })
    expect(head('de').querySelector('[data-flag]')).toHaveAttribute(
      'data-flag',
      'de'
    )
    expect(head('en').querySelector('[data-flag]')).toHaveAttribute(
      'data-flag',
      'gb'
    )
    expect(head('fr')).toHaveAttribute('title', 'Französisch')
  })

  describe('Zeilenmenü und Sperre', () => {
    const LOCKED: TableRow = { ...ROW_2, locked: true }
    const lockedTable = { ...TABLE, rows: [ROW_1, LOCKED] }
    const menuButton = (key: string) =>
      screen.getByRole('button', { name: `Aktionen für ${key}` })
    const entry = (name: string) => screen.getByRole('menuitem', { name })
    const entries = () =>
      screen.getAllByRole('menuitem').map((item) => item.textContent)

    it('der Scroll-Container der Tabelle ist positioniert, damit sr-only-Texte die Seite nicht verbreitern', () => {
      setup()
      const scroller = screen.getByRole('table').parentElement as HTMLElement
      expect(scroller).toHaveClass('overflow-x-auto', 'relative')
    })

    it('das Menü sitzt in der feststehenden Key-Spalte, nicht hinter den Sprachen', () => {
      setup()
      const keyCell = screen.getByRole('rowheader', { name: /checkout\.title/ })
      expect(keyCell).toContainElement(menuButton('checkout.title'))
      expect(keyCell).toHaveClass('sticky', 'left-0')
      // One column per language after the key column, none for a menu.
      const cells = within(keyCell.closest('tr') as HTMLElement).getAllByRole(
        'cell'
      )
      expect(cells).toHaveLength(TABLE.languages.length)
    })

    it('ohne Schreibrecht gibt es kein Menü', () => {
      setup({ readOnly: true })
      expect(screen.queryByRole('button', { name: /Aktionen für/ })).toBeNull()
    })

    it('ohne Löschrecht: nur Umbenennen, kein Sperren', async () => {
      const { user, onRename } = setup()
      await user.click(menuButton('checkout.title'))
      expect(entries()).toEqual(['Umbenennen'])
      await user.click(entry('Umbenennen'))
      expect(onRename).toHaveBeenCalledWith(ROW_1)
    })

    it('mit Löschrecht: Sperren ruft onLock(row, true)', async () => {
      const { user, onLock } = setup({ canDelete: true })
      await user.click(menuButton('checkout.title'))
      expect(entries()).toEqual(['Umbenennen', 'Sperren', 'Löschen'])
      expect(entry('Umbenennen')).not.toHaveAttribute('aria-disabled')
      expect(entry('Löschen')).not.toHaveAttribute('aria-disabled')
      await user.click(entry('Sperren'))
      expect(onLock).toHaveBeenCalledWith(ROW_1, true)
    })

    it('gesperrter Key: Umbenennen und Löschen sind aus, der Hinweis steht im Menü', async () => {
      const { user, onLock, onRename, onDelete } = setup({
        canDelete: true,
        table: lockedTable,
      })
      await user.click(menuButton('checkout.total'))
      expect(entry('Umbenennen')).toHaveAttribute('aria-disabled', 'true')
      expect(entry('Löschen')).toHaveAttribute('aria-disabled', 'true')
      expect(
        within(screen.getByRole('menu')).getByText(
          /Dieser Key kann nicht umbenannt oder gelöscht werden/
        )
      ).toBeInTheDocument()

      await user.click(entry('Umbenennen'))
      expect(onRename).not.toHaveBeenCalled()
      expect(onDelete).not.toHaveBeenCalled()

      await user.click(entry('Entsperren'))
      expect(onLock).toHaveBeenCalledWith(LOCKED, false)
    })

    it('gesperrter Key ohne Löschrecht: Hinweis, aber kein Entsperren', async () => {
      const { user } = setup({ table: lockedTable })
      await user.click(menuButton('checkout.total'))
      expect(entries()).toEqual(['Umbenennen'])
      expect(entry('Umbenennen')).toHaveAttribute('aria-disabled', 'true')
      expect(
        within(screen.getByRole('menu')).getByText(/erst entsperren/)
      ).toBeInTheDocument()
    })

    it('zeigt das Schloss nur am gesperrten Key, auch ohne Schreibrecht', () => {
      setup({ table: lockedTable, readOnly: true })
      const locked = screen.getByRole('rowheader', { name: /checkout\.total/ })
      const open = screen.getByRole('rowheader', { name: /checkout\.title/ })
      expect(
        within(locked).getByRole('img', { name: 'Gesperrt' })
      ).toBeInTheDocument()
      expect(within(open).queryByRole('img', { name: 'Gesperrt' })).toBeNull()
    })

    it('das Schloss erklärt per Tooltip, was die Sperre verhindert', async () => {
      const { user } = setup({ table: lockedTable })
      await user.hover(screen.getByRole('img', { name: 'Gesperrt' }))
      expect(
        await screen.findByRole('tooltip', {
          name: /kann nicht umbenannt oder gelöscht werden/,
        })
      ).toBeInTheDocument()
    })
  })
})
