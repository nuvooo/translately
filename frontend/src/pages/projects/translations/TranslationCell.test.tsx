import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { TranslationCell } from './TranslationCell'
import type { TableCell } from './types'

const LABEL = 'checkout.title – de'

function setup(
  cell: TableCell,
  options: {
    variant?: 'standard' | 'brand'
    busy?: boolean
    readOnly?: boolean
    onSave?: (value: string) => Promise<boolean>
    withReset?: boolean
    onUnlink?: () => Promise<boolean>
    onSuggest?: () => Promise<Suggestion | null>
    lockedHint?: string
  } = {}
) {
  const onSave = vi.fn(options.onSave ?? (() => Promise.resolve(true)))
  const onReset = vi.fn()
  const onUnlink = options.onUnlink && vi.fn(options.onUnlink)
  const onSuggest = options.onSuggest && vi.fn(options.onSuggest)
  const user = userEvent.setup()
  const props = {
    label: LABEL,
    variant: options.variant ?? ('standard' as const),
    busy: options.busy ?? false,
    readOnly: options.readOnly ?? false,
    onSave,
    onReset: options.withReset === false ? undefined : onReset,
    onUnlink,
    onSuggest,
    lockedHint: options.lockedHint,
  }
  const utils = render(<TranslationCell cell={cell} {...props} />)
  const rerender = (next: TableCell, extra: Partial<typeof props> = {}) =>
    utils.rerender(<TranslationCell cell={next} {...props} {...extra} />)
  /** Replaces the cell by something else, as a remount of the table does. */
  const remove = () => utils.rerender(<span>entfernt</span>)
  return {
    ...utils,
    rerender,
    remove,
    onSave,
    onReset,
    onUnlink,
    onSuggest,
    user,
  }
}

type Suggestion = { value: string; placeholderMismatch: boolean }

const SUGGEST = 'KI-Vorschlag'
const PLACEHOLDER_WARNING =
  'Platzhalter weichen vom Quelltext ab – bitte prüfen.'

const UNLINK = `Lösen: ${LABEL}`

const cellButton = () => screen.getByRole('button', { name: LABEL })
const editor = () =>
  screen.getByRole('textbox', { name: LABEL }) as HTMLTextAreaElement

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('TranslationCell', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('de')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('zeigt „fehlt“ bei null', () => {
    setup({ value: null, inherited: false })
    expect(screen.getByText('fehlt')).toBeInTheDocument()
  })

  it('Enter speichert mit dem getippten Wert', async () => {
    const { user, onSave } = setup({ value: 'Kasse', inherited: false })
    await user.click(cellButton())
    expect(editor().value).toBe('Kasse')
    await user.clear(editor())
    await user.keyboard('Zur Kasse{Enter}')
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledWith('Zur Kasse')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('öffnet per Enter und F2, wenn die Zelle den Fokus hat', async () => {
    const { user } = setup({ value: 'Kasse', inherited: false })
    cellButton().focus()
    await user.keyboard('{Enter}')
    expect(editor()).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(cellButton()).toHaveFocus()
    await user.keyboard('{F2}')
    expect(editor()).toHaveFocus()
  })

  it('Umschalt+Enter speichert nicht, sondern fügt eine Zeile ein', async () => {
    const { user, onSave } = setup({ value: null, inherited: false })
    await user.click(cellButton())
    await user.keyboard('Zeile 1{Shift>}{Enter}{/Shift}Zeile 2')
    expect(onSave).not.toHaveBeenCalled()
    expect(editor().value).toBe('Zeile 1\nZeile 2')
  })

  it('Enter während einer IME-Eingabe speichert nicht', async () => {
    const { user, onSave } = setup({ value: null, inherited: false })
    await user.click(cellButton())
    await user.keyboard('ka')
    fireEvent.keyDown(editor(), { key: 'Enter', isComposing: true })
    expect(onSave).not.toHaveBeenCalled()
    expect(editor()).toBeInTheDocument()
  })

  it('Escape verwirft und ruft onSave nicht', async () => {
    const { user, onSave } = setup({ value: 'Kasse', inherited: false })
    await user.click(cellButton())
    await user.keyboard('XYZ{Escape}')
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByText('Kasse')).toBeInTheDocument()
    expect(cellButton()).toHaveFocus()
  })

  it('Verlassen des Feldes speichert', async () => {
    const { user, onSave } = setup({ value: 'Kasse', inherited: false })
    await user.click(cellButton())
    await user.keyboard('!')
    await act(async () => editor().blur())
    expect(onSave).toHaveBeenCalledWith('Kasse!')
  })

  it('unveränderter Wert ruft onSave nicht', async () => {
    const { user, onSave } = setup({ value: 'Kasse', inherited: false })
    await user.click(cellButton())
    await user.keyboard('{Enter}')
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('leerer Entwurf bei fehlendem Text ruft onSave nicht', async () => {
    const { user, onSave } = setup({ value: null, inherited: false })
    await user.click(cellButton())
    await user.keyboard('{Enter}')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('geleerter eigener Text speichert einen leeren Wert', async () => {
    const { user, onSave } = setup({ value: 'Kasse', inherited: false })
    await user.click(cellButton())
    await user.clear(editor())
    await user.keyboard('{Enter}')
    expect(onSave).toHaveBeenCalledWith('')
  })

  it('onSave → false lässt den Editor offen mit Entwurf und aria-invalid', async () => {
    const { user, onSave } = setup(
      { value: 'Kasse', inherited: false },
      { onSave: () => Promise.resolve(false) }
    )
    await user.click(cellButton())
    await user.keyboard(' neu{Enter}')
    expect(onSave).toHaveBeenCalledWith('Kasse neu')
    expect(editor().value).toBe('Kasse neu')
    expect(editor()).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Nicht gespeichert')).toBeInTheDocument()
    expect(editor()).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    // reopening starts from the cell's value, not the discarded draft
    await user.click(cellButton())
    expect(editor().value).toBe('Kasse')
    expect(editor()).not.toHaveAttribute('aria-invalid')
  })

  it('nach einem Fehlschlag sendet Verlassen des Feldes nicht erneut, nur Enter', async () => {
    const { user, onSave } = setup(
      { value: 'Kasse', inherited: false },
      { onSave: () => Promise.resolve(false) }
    )
    await user.click(cellButton())
    await user.keyboard(' neu{Enter}')
    expect(onSave).toHaveBeenCalledTimes(1)
    // blur right after the failure keeps the error mark and sends nothing
    await act(async () => editor().blur())
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(editor()).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Nicht gespeichert')).toBeInTheDocument()
    // editing again clears the mark (the draft is just unsaved) …
    await user.click(editor())
    await user.keyboard('!')
    expect(editor()).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByText('Nicht gespeichert')).not.toBeInTheDocument()
    // … but blur still does not auto-save until an Enter succeeds
    await act(async () => editor().blur())
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(editor().value).toBe('Kasse neu!')
    await user.click(editor())
    await user.keyboard('{Enter}')
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave).toHaveBeenLastCalledWith('Kasse neu!')
  })

  it('hält den Entwurf, solange gespeichert wird, und schließt nach Erfolg', async () => {
    const pending = deferred<boolean>()
    const { user } = setup(
      { value: 'Kasse', inherited: false },
      { onSave: () => pending.promise }
    )
    await user.click(cellButton())
    await user.keyboard('!{Enter}')
    expect(editor().value).toBe('Kasse!')
    expect(editor()).toHaveAttribute('readonly')
    await act(async () => pending.resolve(true))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('überschreibt einen offenen Entwurf nicht durch neue Props', async () => {
    const { user, rerender } = setup({ value: 'Kasse', inherited: false })
    await user.click(cellButton())
    await user.keyboard(' offen')
    rerender({ value: 'Vom Server', inherited: false })
    expect(editor().value).toBe('Kasse offen')
  })

  it('zeigt busy als Fortschrittsanzeige', () => {
    setup({ value: 'Kasse', inherited: false }, { busy: true })
    expect(screen.getByRole('status')).toHaveTextContent('Wird gespeichert')
  })

  it('geerbte Zelle ist vorbefüllt und zeigt keinen „Wieder verknüpfen“-Button', async () => {
    const { user, onSave } = setup(
      { value: 'Kasse', inherited: true },
      { variant: 'brand' }
    )
    expect(
      screen.queryByRole('button', { name: /Wieder verknüpfen/ })
    ).not.toBeInTheDocument()
    expect(screen.getByText('Aus dem Standard übernommen')).toBeInTheDocument()
    await user.click(cellButton())
    expect(editor().value).toBe('Kasse')
    await user.keyboard('{Enter}')
    expect(onSave).not.toHaveBeenCalled()
  })

  it('geerbter Text, erneut getippt, wird als eigener Text gespeichert', async () => {
    const { user, onSave } = setup(
      { value: 'Kasse', inherited: true },
      { variant: 'brand' }
    )
    await user.click(cellButton())
    await user.keyboard('x{Backspace}{Enter}')
    expect(onSave).toHaveBeenCalledWith('Kasse')
  })

  it('eigene Brand-Zelle zeigt „Wieder verknüpfen“ und ruft onReset', async () => {
    const { user, onReset } = setup(
      { value: 'Exklusiv', inherited: false },
      { variant: 'brand' }
    )
    await user.click(
      screen.getByRole('button', { name: `Wieder verknüpfen: ${LABEL}` })
    )
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('fehlende Brand-Zelle zeigt „fehlt“ ohne „Wieder verknüpfen“', () => {
    setup({ value: null, inherited: false }, { variant: 'brand' })
    expect(screen.getByText('fehlt')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Wieder verknüpfen/ })
    ).not.toBeInTheDocument()
  })

  it('geerbte Brand-Zelle: „Lösen“ ruft onUnlink und öffnet den Editor', async () => {
    const { user, onUnlink, onSave } = setup(
      { value: 'Kasse', inherited: true },
      { variant: 'brand', onUnlink: () => Promise.resolve(true) }
    )
    await user.click(screen.getByRole('button', { name: UNLINK }))
    expect(onUnlink).toHaveBeenCalledTimes(1)
    expect(editor().value).toBe('Kasse')
    expect(editor()).toHaveFocus()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('onUnlink → false öffnet den Editor nicht', async () => {
    const { user, onUnlink } = setup(
      { value: 'Kasse', inherited: true },
      { variant: 'brand', onUnlink: () => Promise.resolve(false) }
    )
    await user.click(screen.getByRole('button', { name: UNLINK }))
    expect(onUnlink).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('kein „Lösen“ bei fehlendem Text, eigenem Text oder in der Standardzelle', () => {
    const unlink = () => Promise.resolve(true)
    const { rerender } = setup(
      { value: null, inherited: false },
      { variant: 'brand', onUnlink: unlink }
    )
    expect(
      screen.queryByRole('button', { name: UNLINK })
    ).not.toBeInTheDocument()
    rerender({ value: 'Eigen', inherited: false })
    expect(
      screen.queryByRole('button', { name: UNLINK })
    ).not.toBeInTheDocument()
    rerender({ value: 'Kasse', inherited: true }, { variant: 'standard' })
    expect(
      screen.queryByRole('button', { name: UNLINK })
    ).not.toBeInTheDocument()
  })

  it('lockedHint rendert keinen Button, nur den Hinweis', async () => {
    const { user, onSave } = setup(
      { value: null, inherited: false },
      { variant: 'brand', lockedHint: 'Gesperrt' }
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByTitle('Gesperrt')).toBeInTheDocument()
    await user.click(screen.getByTitle('Gesperrt'))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('readOnly zeigt bei geerbtem Brand-Text kein „Lösen“', () => {
    setup(
      { value: 'Kasse', inherited: true },
      {
        variant: 'brand',
        readOnly: true,
        onUnlink: () => Promise.resolve(true),
      }
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('Kasse')).toBeInTheDocument()
  })

  it('readOnly rendert kein textarea nach Klick und keine Buttons', async () => {
    const { user } = setup(
      { value: 'Exklusiv', inherited: false },
      { readOnly: true, variant: 'brand' }
    )
    await user.click(screen.getByText('Exklusiv'))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('Wert <b>x</b> {{count}} erscheint wörtlich im DOM (kein b-Element)', async () => {
    const raw = '<b>x</b> {{count}}'
    const { container, user } = setup({ value: raw, inherited: false })
    expect(screen.getByText(raw)).toBeInTheDocument()
    expect(container.querySelector('b')).toBeNull()
    await user.click(cellButton())
    expect(editor().value).toBe(raw)
    expect(container.querySelector('b')).toBeNull()
  })

  describe('KI-Vorschlag', () => {
    const suggestion =
      (value: string, placeholderMismatch = false) =>
      () =>
        Promise.resolve<Suggestion | null>({ value, placeholderMismatch })

    it('ohne onSuggest gibt es keinen Knopf', async () => {
      const { user } = setup({ value: null, inherited: false })
      await user.click(cellButton())
      expect(editor()).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: SUGGEST })
      ).not.toBeInTheDocument()
    })

    it('Knopf nur im offenen Editor; Vorschlag landet im Entwurf, Enter speichert ihn', async () => {
      const { user, onSave, onSuggest } = setup(
        { value: null, inherited: false },
        { onSuggest: suggestion('Checkout') }
      )
      // the closed table stays compact
      expect(
        screen.queryByRole('button', { name: SUGGEST })
      ).not.toBeInTheDocument()
      await user.click(cellButton())
      await user.click(screen.getByRole('button', { name: SUGGEST }))
      expect(onSuggest).toHaveBeenCalledTimes(1)
      expect(editor().value).toBe('Checkout')
      expect(editor()).toHaveFocus()
      expect(onSave).not.toHaveBeenCalled()
      expect(screen.queryByText(PLACEHOLDER_WARNING)).not.toBeInTheDocument()
      await user.keyboard('{Enter}')
      expect(onSave).toHaveBeenCalledTimes(1)
      expect(onSave).toHaveBeenCalledWith('Checkout')
    })

    it('placeholderMismatch zeigt die Warnzeile', async () => {
      const { user } = setup(
        { value: null, inherited: false },
        { onSuggest: suggestion('Hallo {{nme}}', true) }
      )
      await user.click(cellButton())
      await user.click(screen.getByRole('button', { name: SUGGEST }))
      expect(editor().value).toBe('Hallo {{nme}}')
      expect(screen.getByText(PLACEHOLDER_WARNING)).toBeInTheDocument()
    })

    it('die Warnzeile verschwindet, sobald der Nutzer den Entwurf ändert', async () => {
      const { user } = setup(
        { value: null, inherited: false },
        { onSuggest: suggestion('Hallo {{nme}}', true) }
      )
      await user.click(cellButton())
      await user.click(screen.getByRole('button', { name: SUGGEST }))
      expect(screen.getByText(PLACEHOLDER_WARNING)).toBeInTheDocument()
      await user.click(editor())
      await user.keyboard('{Backspace}')
      expect(editor()).toBeInTheDocument()
      expect(screen.queryByText(PLACEHOLDER_WARNING)).not.toBeInTheDocument()
    })

    it('tippt der Nutzer, bevor die Antwort kommt, bleibt sein Text', async () => {
      const pending = deferred<Suggestion | null>()
      const { user, onSave } = setup(
        { value: null, inherited: false },
        { onSuggest: () => pending.promise }
      )
      await user.click(cellButton())
      await user.click(screen.getByRole('button', { name: SUGGEST }))
      // loading: the button shows its progress, the editor stays usable
      expect(
        screen.getByRole('button', { name: 'Vorschlag wird erstellt …' })
      ).toBeInTheDocument()
      await user.keyboard('Eigen')
      await act(async () =>
        pending.resolve({ value: 'Vorschlag', placeholderMismatch: true })
      )
      expect(editor().value).toBe('Eigen')
      expect(screen.queryByText(PLACEHOLDER_WARNING)).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: SUGGEST })).toBeInTheDocument()
      await user.keyboard('{Enter}')
      expect(onSave).toHaveBeenCalledWith('Eigen')
    })

    it('onSuggest → null lässt den Entwurf unverändert', async () => {
      const { user, onSave } = setup(
        { value: null, inherited: false },
        { onSuggest: () => Promise.resolve(null) }
      )
      await user.click(cellButton())
      await user.click(screen.getByRole('button', { name: SUGGEST }))
      expect(editor().value).toBe('')
      expect(editor()).toHaveFocus()
      await user.keyboard('{Enter}')
      expect(onSave).not.toHaveBeenCalled()
    })

    it('Verlassen des Feldes speichert nicht, solange der Vorschlag lädt', async () => {
      const pending = deferred<Suggestion | null>()
      const { user, onSave } = setup(
        { value: null, inherited: false },
        { onSuggest: () => pending.promise }
      )
      await user.click(cellButton())
      await user.keyboard('x')
      await user.click(screen.getByRole('button', { name: SUGGEST }))
      await act(async () => editor().blur())
      expect(onSave).not.toHaveBeenCalled()
      expect(editor().value).toBe('x')
      await act(async () =>
        pending.resolve({ value: 'Vorschlag', placeholderMismatch: false })
      )
      // typed before the click: the requested suggestion replaces the draft
      expect(editor().value).toBe('Vorschlag')
      expect(onSave).not.toHaveBeenCalled()
    })

    it('ein gescheitertes Speichern während des Ladens: der Vorschlag überschreibt den Text nicht', async () => {
      const pending = deferred<Suggestion | null>()
      const { user, onSave } = setup(
        { value: null, inherited: false },
        {
          onSuggest: () => pending.promise,
          onSave: () => Promise.resolve(false),
        }
      )
      await user.click(cellButton())
      await user.keyboard('x')
      await user.click(screen.getByRole('button', { name: SUGGEST }))
      await user.keyboard('{Enter}')
      expect(onSave).toHaveBeenCalledWith('x')
      expect(editor()).toHaveAttribute('aria-invalid', 'true')
      await act(async () =>
        pending.resolve({ value: 'Vorschlag', placeholderMismatch: false })
      )
      expect(editor().value).toBe('x')
      expect(editor()).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByText('Nicht gespeichert')).toBeInTheDocument()
    })

    it.each([
      ['lehnt ab', () => Promise.reject(new Error('boom'))],
      ['liefert null', () => Promise.resolve(null)],
    ])(
      'onSuggest %s → danach speichert Verlassen des Feldes wieder',
      async (_, impl) => {
        const { user, onSave } = setup(
          { value: null, inherited: false },
          { onSuggest: impl as () => Promise<Suggestion | null> }
        )
        await user.click(cellButton())
        await user.click(screen.getByRole('button', { name: SUGGEST }))
        expect(
          screen.getByRole('button', { name: SUGGEST })
        ).toBeInTheDocument()
        await user.keyboard('Eigen')
        await act(async () => editor().blur())
        expect(onSave).toHaveBeenCalledWith('Eigen')
      }
    )

    it('Escape während des Ladens: das späte Ergebnis ändert nichts, die Zelle bleibt zu', async () => {
      const pending = deferred<Suggestion | null>()
      const { user, onSave } = setup(
        { value: null, inherited: false },
        { onSuggest: () => pending.promise }
      )
      await user.click(cellButton())
      await user.click(screen.getByRole('button', { name: SUGGEST }))
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      await act(async () =>
        pending.resolve({ value: 'Vorschlag', placeholderMismatch: false })
      )
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      expect(screen.getByText('fehlt')).toBeInTheDocument()
      expect(onSave).not.toHaveBeenCalled()
      // reopening starts empty, without the late suggestion
      await user.click(cellButton())
      expect(editor().value).toBe('')
    })

    it('Zelle mit eigenem Text hat keinen Knopf', async () => {
      const { user } = setup(
        { value: 'Kasse', inherited: false },
        { onSuggest: suggestion('Checkout') }
      )
      await user.click(cellButton())
      expect(
        screen.queryByRole('button', { name: SUGGEST })
      ).not.toBeInTheDocument()
    })

    it('geerbte Brand-Zelle bietet den Knopf an', async () => {
      const { user, onSave } = setup(
        { value: 'Kasse', inherited: true },
        { variant: 'brand', onSuggest: suggestion('Premium-Kasse') }
      )
      await user.click(cellButton())
      expect(editor().value).toBe('Kasse')
      await user.click(screen.getByRole('button', { name: SUGGEST }))
      expect(editor().value).toBe('Premium-Kasse')
      await user.keyboard('{Enter}')
      expect(onSave).toHaveBeenCalledWith('Premium-Kasse')
    })
  })

  describe('Editor wird entfernt', () => {
    it('Entfernen einer Zelle mit offenem, geändertem Editor ruft onSave nicht', async () => {
      const { user, onSave, unmount } = setup({
        value: 'Kasse',
        inherited: false,
      })
      await user.click(cellButton())
      await user.keyboard(' neu')
      expect(editor().value).toBe('Kasse neu')

      unmount()

      expect(onSave).not.toHaveBeenCalled()
    })

    it('ein verspätetes Blur oder Enter eines schon entfernten Editors speichert nicht', async () => {
      const { user, onSave, remove } = setup({
        value: 'Kasse',
        inherited: false,
      })
      await user.click(cellButton())
      await user.keyboard(' neu')
      const field = editor()
      expect(field).toHaveFocus()

      // React itself drops DOM events while it removes nodes, so the late
      // blur is delivered here by calling the editor's own handlers (taken
      // from React's props record on the node) after the removal.
      const propsKey = Object.keys(field).find((k) =>
        k.startsWith('__reactProps$')
      )
      const handlers = (
        field as unknown as Record<
          string,
          { onBlur(): void; onKeyDown(event: unknown): void }
        >
      )[propsKey ?? '']
      expect(handlers.onBlur).toBeTypeOf('function')

      remove()
      expect(field).not.toBeInTheDocument()
      await act(async () => {
        handlers.onBlur()
        handlers.onKeyDown({
          key: 'Enter',
          shiftKey: false,
          keyCode: 13,
          nativeEvent: { isComposing: false },
          preventDefault() {},
          stopPropagation() {},
        })
      })

      expect(onSave).not.toHaveBeenCalled()
    })
  })
})
