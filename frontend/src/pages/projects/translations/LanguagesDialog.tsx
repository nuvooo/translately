import { Loader2, Plus, X } from 'lucide-react'
import { type JSX, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiMessage, getErrorStatus } from '@/lib/errors'
import { handleForbidden } from '@/lib/permissions'
import { setBrandLanguages, setProjectLanguages } from './api'
import { LanguageFlag } from './LanguageFlag'
import { languageName, searchCatalog } from './languageCatalog'
import { MAX_LANGUAGES, similarLanguage, validateLanguage } from './languages'
import { TargetSelect } from './TargetSelect'

type Scope =
  | { kind: 'project'; id: string }
  | { kind: 'brand'; id: string; name: string; projectLanguages: string[] }

/** What the dialog works against, captured when it opens. */
interface Snapshot {
  /** The stored list: `expected` of the save, base of "unchanged" and "removed". */
  baseline: string[]
  scope: Scope
}

const ERROR_KEYS = {
  invalid: 'translations.languages.error-invalid',
  duplicate: 'translations.languages.error-duplicate',
} as const

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, i) => value === b[i])

const scopeKey = (scope: Scope) => `${scope.kind}:${scope.id}`

/**
 * Edits the language list of the project or of one brand. Removing languages
 * deletes texts on the server, so saving such a list asks for confirmation
 * first; pure additions save directly.
 *
 * The stored list and the scope are captured when the dialog opens. Saving
 * sends that list as `expected`; if the server reports that it changed in
 * the meantime (409), `onStale` lets the parent reload, and the next
 * `languages` passed in becomes the new baseline while the draft is kept.
 *
 * Languages are picked from a catalog (name, flag and ISO code) that the
 * input filters; any other valid code can still be typed and added.
 *
 * With `target`, the header offers the choice between the project and its
 * brands; the parent turns the choice into `scope` and `languages`. The
 * choice is locked once the draft differs from the stored list.
 */
export function LanguagesDialog(props: {
  open: boolean
  onOpenChange(open: boolean): void
  scope:
    | { kind: 'project'; id: string }
    | { kind: 'brand'; id: string; name: string; projectLanguages: string[] }
  languages: string[]
  onSaved(languages: string[]): void
  /** The stored list changed meanwhile (409); refresh `languages`. */
  onStale?(): void | Promise<void>
  /** Target selection in the header (no selection without brands). */
  target?: {
    brands: { id: string; name: string }[]
    /** null = the project's standard texts */
    value: string | null
    onChange(brandId: string | null): void
  }
}): JSX.Element {
  const { open, onOpenChange, scope, languages, onSaved, onStale, target } =
    props
  const { t, i18n } = useTranslation()
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [draft, setDraft] = useState<string[]>(languages)
  const [input, setInput] = useState('')
  const [error, setError] = useState<{
    kind: keyof typeof ERROR_KEYS
    code: string
  } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  /** The last save hit a changed list; shows the notice. */
  const [staleNotice, setStaleNotice] = useState(false)
  /** Waiting for the parent to pass the refreshed list. */
  const [awaitingFresh, setAwaitingFresh] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const errorId = useId()
  const hintId = useId()

  // Reset while rendering the opening frame (not in an effect), so a reopened
  // dialog never paints the discarded draft; closing keeps it for the exit.
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    setSnapshot({ baseline: languages, scope })
    setDraft(languages)
    setInput('')
    setError(null)
    setConfirming(false)
    setStaleNotice(false)
    setAwaitingFresh(false)
  } else if (!open && wasOpen) {
    setWasOpen(false)
  }

  // Only after a conflict does a new stored list become the baseline; the
  // draft stays as the user left it.
  if (
    open &&
    snapshot &&
    awaitingFresh &&
    !sameList(languages, snapshot.baseline)
  ) {
    setSnapshot({ ...snapshot, baseline: languages })
    setAwaitingFresh(false)
    setConfirming(false)
  }

  // Another scope while open (other brand, or brand → project). With an
  // untouched draft (e.g. the target was switched in the header) the dialog
  // simply starts over with the new scope's stored list.
  const currentScopeKey = scopeKey(scope)
  if (
    open &&
    snapshot &&
    scopeKey(snapshot.scope) !== currentScopeKey &&
    !busy &&
    !confirming &&
    sameList(draft, snapshot.baseline)
  ) {
    setSnapshot({ baseline: languages, scope })
    setDraft(languages)
    setInput('')
    setError(null)
    setStaleNotice(false)
    setAwaitingFresh(false)
  }

  // Otherwise the draft belongs to the old scope, so close and discard it.
  // Saving always uses the captured scope, never the current props.
  const openedScopeKey = snapshot ? scopeKey(snapshot.scope) : null
  useEffect(() => {
    if (open && openedScopeKey !== null && openedScopeKey !== currentScopeKey)
      onOpenChange(false)
  }, [open, openedScopeKey, currentScopeKey, onOpenChange])

  const baseline = snapshot?.baseline ?? languages
  const current = snapshot?.scope ?? scope
  const full = draft.length >= MAX_LANGUAGES
  const removed = baseline.filter((language) => !draft.includes(language))
  const similar = error ? null : similarLanguage(input, draft)
  const suggestions =
    current.kind === 'brand'
      ? current.projectLanguages.filter((language) => !draft.includes(language))
      : []

  /** Catalog languages matching the input that are not in the draft yet. */
  const matches = full ? [] : searchCatalog(input, draft, i18n.language)

  const focusInput = () => inputRef.current?.focus()

  const add = (code: string) => {
    if (busy || full) return
    let trimmed = code.trim()
    if (trimmed === '') return
    let problem = validateLanguage(trimmed, draft)
    // Not a code, but the start of a name ("Franz"): take that language.
    if (problem === 'invalid') {
      const typed = trimmed.toLowerCase()
      const named = matches.find((entry) =>
        entry.name.toLowerCase().startsWith(typed)
      )
      if (named) {
        trimmed = named.code
        problem = validateLanguage(trimmed, draft)
      }
    }
    if (problem) {
      setError({ kind: problem, code: trimmed })
      return
    }
    setDraft([...draft, trimmed])
    setInput('')
    setError(null)
  }

  const persist = async () => {
    setBusy(true)
    setStaleNotice(false)
    try {
      const result =
        current.kind === 'project'
          ? await setProjectLanguages(current.id, draft, baseline)
          : await setBrandLanguages(current.id, draft, baseline)
      toast.success(
        result.removedValues > 0
          ? t('translations.languages.saved-removed', {
              count: result.removedValues,
            })
          : t('translations.languages.saved')
      )
      onSaved(result.languages)
      onOpenChange(false)
    } catch (err) {
      setConfirming(false)
      if (getErrorStatus(err) === 409) {
        setStaleNotice(true)
        setAwaitingFresh(true)
        // Stay busy until the parent has refreshed the stored list.
        try {
          await onStale?.()
        } catch {
          // The notice stays; the next save checks against the server again.
        }
      } else if (!handleForbidden(err, t)) {
        toast.error(apiMessage(err, t('translations.languages.save-failed')))
      }
    } finally {
      setBusy(false)
    }
  }

  const save = () => {
    if (busy) return
    if (removed.length > 0) setConfirming(true)
    else void persist()
  }

  const backToList = () => {
    if (!busy) setConfirming(false)
  }

  const title =
    current.kind === 'project'
      ? t('translations.languages.title-project')
      : t('translations.languages.title-brand', { brand: current.name })
  const removedList = removed.join(', ')

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent
        className="sm:max-w-lg"
        // In the confirmation, Escape and a click outside return to the list
        // (keeping the draft) instead of closing the dialog.
        onEscapeKeyDown={(event) => {
          if (confirming) {
            event.preventDefault()
            backToList()
          }
        }}
        onInteractOutside={(event) => {
          if (confirming) {
            event.preventDefault()
            backToList()
          }
        }}
      >
        {confirming ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {t('translations.languages.confirm-title')}
              </DialogTitle>
              <DialogDescription>
                {current.kind === 'project'
                  ? t('translations.languages.confirm-project', {
                      languages: removedList,
                    })
                  : t('translations.languages.confirm-brand', {
                      languages: removedList,
                      brand: current.name,
                    })}
              </DialogDescription>
            </DialogHeader>
            {/* "Zurück" takes the slot of "Speichern", so a double click on
                "Speichern" never lands on the destructive button. */}
            <DialogFooter data-testid="languages-dialog-footer">
              <Button
                type="button"
                variant="destructive"
                onClick={() => void persist()}
                disabled={busy}
              >
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('translations.languages.confirm')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={backToList}
                disabled={busy}
                autoFocus
              >
                {t('translations.languages.back')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>
                {current.kind === 'project'
                  ? t('translations.languages.text-project')
                  : t('translations.languages.text-brand')}
              </DialogDescription>
              {target && target.brands.length > 0 && (
                <div className="flex pt-1">
                  <TargetSelect
                    brands={target.brands}
                    value={target.value}
                    onChange={target.onChange}
                    // Switching would discard the changes of the draft.
                    disabled={busy || !sameList(draft, baseline)}
                  />
                </div>
              )}
            </DialogHeader>

            {staleNotice && (
              <p
                role="status"
                className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground"
              >
                {t('translations.languages.stale')}
              </p>
            )}

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor={inputId}>
                  {t('translations.languages.code')}
                </Label>
                <div className="flex gap-2">
                  <Input
                    ref={inputRef}
                    id={inputId}
                    value={input}
                    onChange={(event) => {
                      setInput(event.target.value)
                      setError(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        add(input)
                      }
                    }}
                    placeholder={t('translations.languages.placeholder')}
                    autoComplete="off"
                    spellCheck={false}
                    autoFocus
                    disabled={busy || full}
                    aria-invalid={error ? 'true' : undefined}
                    aria-describedby={
                      error ? errorId : similar ? hintId : undefined
                    }
                    className="font-mono"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => add(input)}
                    disabled={busy || full || input.trim() === ''}
                  >
                    <Plus className="mr-1 h-4 w-4" aria-hidden />
                    {t('translations.languages.add')}
                  </Button>
                </div>
                {error && (
                  <p
                    id={errorId}
                    role="alert"
                    className="text-xs text-destructive"
                  >
                    {t(ERROR_KEYS[error.kind], { code: error.code })}
                  </p>
                )}
                {similar && (
                  <p id={hintId} className="text-xs text-muted-foreground">
                    {t('translations.languages.similar', { existing: similar })}
                  </p>
                )}
                {full && (
                  <p className="text-xs text-muted-foreground">
                    {t('translations.languages.max', { max: MAX_LANGUAGES })}
                  </p>
                )}
                {matches.length > 0 && (
                  // biome-ignore lint/a11y/useSemanticElements: a fieldset would need a visible legend; the label names the group
                  <div
                    role="group"
                    aria-label={t('translations.languages.catalog')}
                    className="max-h-44 overflow-y-auto rounded-md border p-1"
                  >
                    {matches.map((entry) => (
                      <button
                        key={entry.code}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50"
                        aria-label={t('translations.languages.suggest', {
                          language: `${entry.name} (${entry.code})`,
                        })}
                        onClick={() => {
                          add(entry.code)
                          focusInput()
                        }}
                        disabled={busy}
                      >
                        <LanguageFlag language={entry.code} />
                        <span className="min-w-0 flex-1 truncate">
                          {entry.name}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {entry.code}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {suggestions.length > 0 && (
                <fieldset>
                  <legend className="mb-2 text-xs font-medium text-muted-foreground">
                    {t('translations.languages.suggestions')}
                  </legend>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestions.map((language) => (
                      <Button
                        key={language}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 font-mono text-xs"
                        aria-label={t('translations.languages.suggest', {
                          language,
                        })}
                        onClick={() => {
                          add(language)
                          focusInput()
                        }}
                        disabled={busy || full}
                      >
                        <Plus className="mr-1 h-3 w-3" aria-hidden />
                        <LanguageFlag language={language} className="mr-1" />
                        {language}
                      </Button>
                    ))}
                  </div>
                </fieldset>
              )}

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('translations.languages.selected', {
                    count: draft.length,
                    max: MAX_LANGUAGES,
                  })}
                </p>
                {draft.length === 0 && (
                  <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                    {t('translations.languages.empty')}
                  </p>
                )}
                <ul
                  aria-label={t('translations.languages.list')}
                  className="flex max-h-60 flex-wrap gap-1.5 overflow-y-auto"
                >
                  {draft.map((language) => (
                    <li
                      key={language}
                      data-language={language}
                      title={languageName(language, i18n.language) ?? undefined}
                      className="inline-flex items-center gap-1 rounded-md border py-0.5 pl-2 pr-0.5 font-mono text-xs"
                    >
                      <LanguageFlag language={language} />
                      {language}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 text-muted-foreground hover:text-destructive"
                        aria-label={t('translations.languages.remove', {
                          language,
                        })}
                        onClick={() => {
                          setDraft(draft.filter((l) => l !== language))
                          focusInput()
                        }}
                        disabled={busy}
                      >
                        <X className="h-3 w-3" aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <DialogFooter data-testid="languages-dialog-footer">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                onClick={save}
                disabled={busy || sameList(draft, baseline)}
              >
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('common.save')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
