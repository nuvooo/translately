import { Link2, Loader2, Sparkles, Unlink2 } from 'lucide-react'
import {
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { badgeVariants } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { TableCell } from './types'

interface TranslationCellProps {
  cell: TableCell
  /** Accessible name of the cell and its editor, e.g. "checkout.title – de". */
  label: string
  /** `brand`: a brand's text, which may inherit the standard text. */
  variant: 'standard' | 'brand'
  busy: boolean
  readOnly: boolean
  /** Resolves `false` when the save failed (the caller has reported it). */
  onSave(value: string): Promise<boolean>
  /** Brand, inherited text: make it the brand's own text (chain button). */
  onUnlink?(): Promise<boolean>
  /** Brand, own text: drop it and follow the standard again. */
  onReset?(): void
  /** Locked cell with this tooltip text; renders no editing. */
  lockedHint?: string
  /**
   * AI suggestion for a cell without its own text: offered inside the open
   * editor only. The result goes into the draft (never saved by itself);
   * null = no suggestion, the draft stays.
   */
  onSuggest?(): Promise<{ value: string; placeholderMismatch: boolean } | null>
}

const MIN_ROWS = 2
const MAX_ROWS = 10

const SIDE_BUTTON =
  'mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/**
 * One text of the table. Read mode shows the text as plain text; a click,
 * Enter or F2 opens a textarea. Enter or leaving the field saves (after a
 * failed save only Enter retries), Shift+Enter adds a line, Escape discards.
 * The draft lives here only and is never replaced by new props while the
 * editor is open.
 */
export function TranslationCell({
  cell,
  label,
  variant,
  busy,
  readOnly,
  onSave,
  onUnlink,
  onReset,
  lockedHint,
  onSuggest,
}: TranslationCellProps) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [placeholderWarning, setPlaceholderWarning] = useState(false)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const suggestRef = useRef<HTMLButtonElement>(null)
  const cellRef = useRef<HTMLButtonElement>(null)
  /** Bumped on every open/close: results of an older save are ignored. */
  const session = useRef(0)
  const editingRef = useRef(false)
  const savingRef = useRef(false)
  /** The user changed the draft (an inherited text retyped is saved). */
  const touched = useRef(false)
  const focusCellOnClose = useRef(false)
  /** A save of this editor failed: only Enter saves until one succeeds. */
  const blurSaveBlocked = useRef(false)
  /** An unlink of this cell is in flight (no second request). */
  const unlinking = useRef(false)
  /** The cell is being removed (or is gone): its editor must not save. */
  const removed = useRef(false)
  /** An AI suggestion is loading: leaving the field does not save. */
  const suggestingRef = useRef(false)
  /**
   * Counts the user's edits and started saves: a suggestion never replaces
   * newer typing or a draft the user chose to save.
   */
  const edits = useRef(0)
  const textId = useId()
  const hintId = useId()
  const errorId = useId()
  const warningId = useId()

  const missing = cell.value === null
  const own = cell.inherited ? null : cell.value
  const brand = variant === 'brand'
  const inherited = brand && cell.inherited && !missing
  const ownBrandText = brand && !cell.inherited && !missing
  const locked = lockedHint !== undefined
  const editable = !readOnly && !locked
  const showEditor = editing && editable

  const close = (restoreFocus: boolean) => {
    session.current++
    editingRef.current = false
    savingRef.current = false
    suggestingRef.current = false
    focusCellOnClose.current = restoreFocus
    setEditing(false)
    setSaving(false)
    setFailed(false)
    setSuggesting(false)
    setPlaceholderWarning(false)
  }

  const open = () => {
    if (!editable || editingRef.current) return
    session.current++
    editingRef.current = true
    touched.current = false
    blurSaveBlocked.current = false
    suggestingRef.current = false
    setDraft(own ?? (cell.inherited ? (cell.value ?? '') : ''))
    setFailed(false)
    setSaving(false)
    setSuggesting(false)
    setPlaceholderWarning(false)
    setEditing(true)
  }
  // `unlink` opens the editor after an await: it must use the open of the
  // props current by then (e.g. readOnly may have changed meanwhile).
  const openLatest = useRef(open)
  openLatest.current = open

  /** Chain button: make the inherited text the brand's own, then edit it. */
  const unlink = async () => {
    if (!onUnlink || unlinking.current || editingRef.current) return
    unlinking.current = true
    const id = session.current
    let ok = false
    try {
      ok = await onUnlink()
    } catch {
      ok = false
    }
    unlinking.current = false
    // Removed meanwhile, or the editor was opened in between: do nothing.
    if (!ok || removed.current || id !== session.current) return
    openLatest.current()
  }

  // Lost the write permission (or got locked) while editing: drop the editor
  // and its draft.
  useEffect(() => {
    if (editable || !editingRef.current) return
    session.current++
    editingRef.current = false
    savingRef.current = false
    suggestingRef.current = false
    setEditing(false)
    setSaving(false)
    setFailed(false)
    setSuggesting(false)
    setPlaceholderWarning(false)
  }, [editable])

  // The cleanup runs before the cell's DOM nodes are taken out: whatever the
  // removal triggers afterwards (a blur of the focused editor, a late key
  // event) cannot save into the view that follows, and the result of a save
  // still in flight is ignored.
  useLayoutEffect(() => {
    removed.current = false
    return () => {
      removed.current = true
      session.current++
    }
  }, [])

  useLayoutEffect(() => {
    if (!showEditor) return
    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    editor.setSelectionRange(editor.value.length, editor.value.length)
  }, [showEditor])

  useEffect(() => {
    if (showEditor || !focusCellOnClose.current) return
    focusCellOnClose.current = false
    cellRef.current?.focus()
  }, [showEditor])

  const commit = async (restoreFocus: boolean) => {
    if (removed.current || !editingRef.current || savingRef.current) return
    const value = draft
    const unchanged =
      own !== null ? value === own : !touched.current || value === ''
    if (unchanged) {
      close(restoreFocus)
      return
    }
    const id = session.current
    // A save counts as the user's choice: a pending suggestion must not
    // replace this draft afterwards, even when the save fails.
    edits.current++
    savingRef.current = true
    setSaving(true)
    setFailed(false)
    let ok = false
    try {
      ok = await onSave(value)
    } catch {
      ok = false
    }
    if (id !== session.current) return
    if (ok) {
      close(document.activeElement === editorRef.current)
    } else {
      savingRef.current = false
      blurSaveBlocked.current = true
      setSaving(false)
      setFailed(true)
    }
  }

  /**
   * Loads an AI suggestion into the draft; it then counts as the user's
   * change (Enter or leaving the field saves it). Typing meanwhile wins.
   */
  const suggest = async () => {
    if (
      !onSuggest ||
      !editingRef.current ||
      suggestingRef.current ||
      savingRef.current
    )
      return
    const id = session.current
    const editsBefore = edits.current
    suggestingRef.current = true
    setSuggesting(true)
    let result: Awaited<ReturnType<typeof onSuggest>> = null
    try {
      result = await onSuggest()
    } catch {
      result = null
    }
    // Closed, reopened or removed meanwhile: the result belongs to no editor.
    if (removed.current || id !== session.current) return
    suggestingRef.current = false
    setSuggesting(false)
    // Typed or saved since the click: the user's draft wins.
    if (!result || edits.current !== editsBefore) return
    touched.current = true
    setDraft(result.value)
    setFailed(false)
    setPlaceholderWarning(result.placeholderMismatch)
    // Asked by keyboard: continue in the editor (Enter saves from there).
    if (document.activeElement === suggestRef.current)
      editorRef.current?.focus()
  }

  const onEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    }
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      event.keyCode !== 229
    ) {
      event.preventDefault()
      void commit(true)
    }
  }

  const busyIndicator = busy && (
    <span
      role="status"
      className="mt-2 inline-flex shrink-0 text-muted-foreground"
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      <span className="sr-only">{t('translations.cell.saving')}</span>
    </span>
  )

  if (showEditor) {
    const lines = draft.split('\n').length
    // Only for a cell without its own text (missing or inherited).
    const canSuggest = Boolean(onSuggest) && own === null
    const describedBy = [
      failed && errorId,
      placeholderWarning && warningId,
      hintId,
    ]
      .filter(Boolean)
      .join(' ')
    const suggestLabel = t(
      suggesting ? 'translations.ai.suggesting' : 'translations.ai.suggest'
    )
    return (
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1 space-y-1">
          <textarea
            ref={editorRef}
            value={draft}
            readOnly={saving}
            rows={Math.min(Math.max(lines, MIN_ROWS), MAX_ROWS)}
            aria-label={label}
            aria-invalid={failed ? 'true' : undefined}
            aria-describedby={describedBy}
            onChange={(event) => {
              touched.current = true
              edits.current++
              setDraft(event.target.value)
              // An edited draft is just unsaved, no longer "failed".
              setFailed(false)
              // The warning was about the suggestion, not the user's edit.
              setPlaceholderWarning(false)
            }}
            onKeyDown={onEditorKeyDown}
            onBlur={(event) => {
              // Focus moving to the suggestion button stays in the editor.
              if (canSuggest && event.relatedTarget === suggestRef.current)
                return
              // After a failed save only Enter retries; leaving the field
              // keeps the draft (and the error mark) instead of re-sending.
              // While a suggestion loads nothing is saved either.
              if (!blurSaveBlocked.current && !suggestingRef.current)
                void commit(false)
            }}
            className={cn(
              'block max-h-60 min-h-16 w-full resize-none overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-input bg-background px-2 py-1.5 text-sm [field-sizing:content] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              saving && 'cursor-progress text-muted-foreground',
              failed && 'border-destructive focus-visible:ring-destructive'
            )}
          />
          {failed && (
            <p id={errorId} className="text-xs text-destructive">
              {t('translations.cell.not-saved')}
            </p>
          )}
          {placeholderWarning && (
            <p id={warningId} className="text-xs text-warning">
              {t('translations.ai.placeholder-warning')}
            </p>
          )}
          <span id={hintId} className="sr-only">
            {t('translations.cell.hint')}
          </span>
        </div>
        {busyIndicator}
        {canSuggest && (
          <button
            ref={suggestRef}
            type="button"
            aria-label={suggestLabel}
            title={suggestLabel}
            aria-busy={suggesting || undefined}
            // A click keeps the focus in the editor (no blur save).
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void suggest()}
            onBlur={(event) => {
              // Leaving the editor via the button saves like the field does.
              if (event.relatedTarget === editorRef.current) return
              if (!blurSaveBlocked.current && !suggestingRef.current)
                void commit(false)
            }}
            className={SIDE_BUTTON}
          >
            {suggesting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
            )}
          </button>
        )}
      </div>
    )
  }

  if (locked) {
    return (
      <div
        title={lockedHint}
        className={cn(
          'flex items-start px-2 text-sm text-muted-foreground',
          brand ? 'min-h-8 py-1' : 'min-h-9 py-1.5'
        )}
      >
        {missing ? (
          <span aria-hidden>–</span>
        ) : (
          <span className="line-clamp-3 whitespace-pre-wrap break-words">
            {cell.value}
          </span>
        )}
        <span className="sr-only">{lockedHint}</span>
      </div>
    )
  }

  const text = missing ? (
    <span className={cn(badgeVariants({ variant: 'warning' }), 'italic')}>
      {t('translations.missing')}
    </span>
  ) : (
    <span
      className={cn(
        'line-clamp-3 whitespace-pre-wrap break-words',
        inherited && 'text-muted-foreground',
        ownBrandText && 'font-medium'
      )}
      title={cell.value ?? undefined}
    >
      {cell.value}
    </span>
  )

  const body = (
    <span id={textId} className="flex min-w-0 items-start gap-1.5">
      {inherited && (
        <>
          <Link2
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="sr-only">{t('translations.cell.inherited')}</span>
        </>
      )}
      <span className="min-w-0 flex-1">{text}</span>
    </span>
  )

  const relinkLabel = t('translations.cell.relink', { label })
  const unlinkLabel = t('translations.cell.unlink', { label })

  return (
    <div
      className={cn(
        'flex items-start gap-1',
        brand ? 'min-h-8' : 'min-h-9',
        ownBrandText && 'border-l-2 border-primary pl-1'
      )}
    >
      {editable ? (
        <button
          ref={cellRef}
          type="button"
          aria-label={label}
          aria-describedby={textId}
          onClick={open}
          onKeyDown={(event) => {
            if (event.key === 'F2') {
              event.preventDefault()
              open()
            }
          }}
          className={cn(
            'min-w-0 flex-1 cursor-text rounded-md px-2 text-left text-sm transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            brand ? 'py-1' : 'py-1.5'
          )}
        >
          {body}
        </button>
      ) : (
        <div
          className={cn(
            'min-w-0 flex-1 px-2 text-sm',
            brand ? 'py-1' : 'py-1.5'
          )}
        >
          {body}
        </div>
      )}
      {busyIndicator}
      {editable && inherited && onUnlink && (
        <button
          type="button"
          onClick={() => void unlink()}
          aria-label={unlinkLabel}
          title={unlinkLabel}
          className={SIDE_BUTTON}
        >
          <Unlink2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
      {editable && ownBrandText && onReset && (
        <button
          type="button"
          onClick={onReset}
          aria-label={relinkLabel}
          title={relinkLabel}
          className={SIDE_BUTTON}
        >
          <Link2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  )
}
