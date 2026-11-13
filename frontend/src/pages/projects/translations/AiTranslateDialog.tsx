import { AlertTriangle, Loader2 } from 'lucide-react'
import { type JSX, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { handleForbidden } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { applyAiTranslations, previewMissingTranslations } from './api'
import type { AiPreviewLanguage } from './types'
import { aiErrorKey } from './useAiTranslation'

/**
 * Suggestions requested per language: one model chunk, so each request stays
 * well within the proxy timeout and every `apply` below the server's 200 values.
 */
const PREVIEW_LIMIT = 40

type Suggestion = AiPreviewLanguage['suggestions'][number]

/** What the dialog works on, captured when it opens. */
interface Snapshot {
  projectId: string
  namespace: string
  languages: string[]
}

/** One target language in step 2. */
interface Section {
  language: string
  status: 'waiting' | 'loading' | 'done' | 'failed'
  remaining: number
  suggestions: Suggestion[]
  /** Checked rows by key id. */
  checked: Record<string, boolean>
  error: string | null
}

/** An empty text is never offered for saving. */
const selectable = (s: Suggestion) => s.value.trim() !== ''

const chosenValues = (section: Section) =>
  section.status === 'done'
    ? section.suggestions
        .filter((s) => selectable(s) && section.checked[s.keyId])
        .map((s) => ({ keyId: s.keyId, value: s.value }))
    : []

/**
 * Translates the missing standard texts of a namespace with AI. Step 1
 * chooses source and target languages; step 2 asks for suggestions one
 * language after the other and shows them for review. Only "Übernehmen"
 * writes, and only the checked rows.
 *
 * Namespace and languages are captured when the dialog opens; closing it
 * discards every suggestion. It cannot be closed while a request runs.
 */
export function AiTranslateDialog(props: {
  open: boolean
  onOpenChange(open: boolean): void
  projectId: string
  namespace: string
  projectLanguages: string[]
  /** Nach erfolgreichem Übernehmen (mindestens ein Text geschrieben). */
  onApplied(): void
}): JSX.Element {
  const { open, onOpenChange, onApplied } = props
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [source, setSource] = useState('')
  /** Target languages the user unchecked; every other language is a target. */
  const [excluded, setExcluded] = useState<string[]>([])
  /** null = step 1; otherwise step 2 with one section per target language. */
  const [sections, setSections] = useState<Section[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Bumped on every open and close; late answers of an old session are dropped. */
  const [sessionId, setSessionId] = useState(0)
  const session = useRef(sessionId)
  const sourceId = useId()

  // Reset while rendering the opening frame (not in an effect), so a reopened
  // dialog never paints the previous suggestions.
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    setSnapshot({
      projectId: props.projectId,
      namespace: props.namespace,
      languages: props.projectLanguages,
    })
    setSource(props.projectLanguages[0] ?? '')
    setExcluded([])
    setSections(null)
    setBusy(false)
    setError(null)
    setSessionId((id) => id + 1)
  } else if (!open && wasOpen) {
    setWasOpen(false)
    setSections(null)
    setSessionId((id) => id + 1)
  }

  useEffect(() => {
    session.current = sessionId
  }, [sessionId])

  // After unmount no further request starts; a late answer is ignored.
  useEffect(
    () => () => {
      session.current = Number.NaN
    },
    []
  )

  const target = snapshot ?? {
    projectId: props.projectId,
    namespace: props.namespace,
    languages: props.projectLanguages,
  }
  const candidates = target.languages.filter((l) => l !== source)
  const targets = candidates.filter((l) => !excluded.includes(l))
  const count = (sections ?? []).reduce(
    (sum, section) => sum + chosenValues(section).length,
    0
  )

  /** The message for a failed request; a 403 is also reported as such. */
  const messageOf = (err: unknown, fallbackKey?: string) => {
    if (handleForbidden(err, t)) return t('permissions.forbidden')
    const key = aiErrorKey(err)
    return t(fallbackKey && key === 'translations.ai.error' ? fallbackKey : key)
  }

  const updateSection = (language: string, patch: Partial<Section>) =>
    setSections(
      (current) =>
        current?.map((s) =>
          s.language === language ? { ...s, ...patch } : s
        ) ?? null
    )

  const changeSource = (next: string) => {
    if (busy) return
    // The old source becomes a (checked) target again.
    setExcluded((current) => current.filter((l) => l !== source && l !== next))
    setSource(next)
    setError(null)
  }

  const toggleTarget = (language: string, checked: boolean) => {
    if (busy) return
    setExcluded((current) =>
      checked
        ? current.filter((l) => l !== language)
        : [...current.filter((l) => l !== language), language]
    )
    setError(null)
  }

  const toggleRow = (language: string, keyId: string, checked: boolean) =>
    setSections(
      (current) =>
        current?.map((s) =>
          s.language === language
            ? { ...s, checked: { ...s.checked, [keyId]: checked } }
            : s
        ) ?? null
    )

  /** One request per target language, one after the other. */
  const create = async () => {
    if (busy || !source || targets.length === 0) return
    const current = session.current
    const languages = targets
    setBusy(true)
    setError(null)
    setSections(
      languages.map((language) => ({
        language,
        status: 'waiting',
        remaining: 0,
        suggestions: [],
        checked: {},
        error: null,
      }))
    )
    let succeeded = 0
    let lastError: string | null = null
    for (const language of languages) {
      if (current !== session.current) return
      updateSection(language, { status: 'loading' })
      try {
        const result = await previewMissingTranslations(target.projectId, {
          namespace: target.namespace,
          sourceLanguage: source,
          targetLanguages: [language],
          limit: PREVIEW_LIMIT,
        })
        if (current !== session.current) return
        const entry = result.languages.find((l) => l.language === language)
        const suggestions = entry?.suggestions ?? []
        updateSection(language, {
          status: 'done',
          remaining: entry?.remaining ?? 0,
          suggestions,
          checked: Object.fromEntries(
            suggestions.map((s) => [
              s.keyId,
              selectable(s) && !s.placeholderMismatch,
            ])
          ),
        })
        succeeded += 1
      } catch (err) {
        if (current !== session.current) return
        lastError = messageOf(err)
        updateSection(language, { status: 'failed', error: lastError })
      }
    }
    if (current !== session.current) return
    setBusy(false)
    if (succeeded === 0) {
      setSections(null)
      setError(lastError)
    }
  }

  /** One `apply` per language with checked rows, one after the other. */
  const apply = async () => {
    if (busy || !sections || count === 0) return
    const current = session.current
    setBusy(true)
    setSections(
      sections.map((s) => (s.status === 'done' ? { ...s, error: null } : s))
    )
    let written = 0
    let skipped = 0
    let appliedLanguages = 0
    let failed = false
    for (const section of sections) {
      const values = chosenValues(section)
      if (values.length === 0) continue
      try {
        const result = await applyAiTranslations(target.projectId, {
          targetLanguage: section.language,
          values,
        })
        written += result.written
        skipped += result.skippedExisting
        appliedLanguages += 1
        if (current === session.current)
          setSections(
            (list) =>
              list?.filter((s) => s.language !== section.language) ?? null
          )
      } catch (err) {
        failed = true
        if (current === session.current)
          updateSection(section.language, {
            error: messageOf(err, 'translations.toast.save-failed'),
          })
        break
      }
    }
    if (appliedLanguages > 0)
      toast.success(
        t('translations.ai.dialog.toast-applied', { written, skipped })
      )
    if (written > 0) onApplied()
    if (current !== session.current) return
    setBusy(false)
    if (!failed) onOpenChange(false)
  }

  const back = () => {
    if (busy) return
    setSections(null)
    setError(null)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('translations.ai.dialog.title')}</DialogTitle>
          <DialogDescription>
            {t('translations.ai.dialog.intro', { namespace: target.namespace })}
          </DialogDescription>
        </DialogHeader>

        {sections ? (
          <>
            <div className="max-h-[60vh] space-y-4 overflow-y-auto">
              {sections.map((section) => (
                <LanguageSection
                  key={section.language}
                  section={section}
                  disabled={busy}
                  onToggle={(keyId, checked) =>
                    toggleRow(section.language, keyId, checked)
                  }
                />
              ))}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={back}
                disabled={busy}
              >
                {t('translations.import-dialog.back')}
              </Button>
              <Button
                type="button"
                onClick={() => void apply()}
                disabled={busy || count === 0}
              >
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('translations.ai.dialog.apply', { count })}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor={sourceId}>
                  {t('translations.ai.dialog.source')}
                </Label>
                <Select
                  value={source}
                  onValueChange={changeSource}
                  disabled={busy}
                >
                  <SelectTrigger id={sourceId} className="font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {target.languages.map((code) => (
                      <SelectItem key={code} value={code} className="font-mono">
                        {code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">
                  {t('translations.ai.dialog.targets')}
                </legend>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {candidates.map((code) => (
                    <TargetOption
                      key={code}
                      code={code}
                      checked={!excluded.includes(code)}
                      disabled={busy}
                      onChange={(checked) => toggleTarget(code, checked)}
                    />
                  ))}
                </div>
              </fieldset>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
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
                onClick={() => void create()}
                disabled={busy || !source || targets.length === 0}
              >
                {t('translations.ai.dialog.create')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function TargetOption({
  code,
  checked,
  disabled,
  onChange,
}: {
  code: string
  checked: boolean
  disabled: boolean
  onChange(checked: boolean): void
}) {
  const id = useId()
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(next === true)}
      />
      <Label htmlFor={id} className="cursor-pointer font-mono font-normal">
        {code}
      </Label>
    </div>
  )
}

/** The suggestions of one target language, or its state while they load. */
function LanguageSection({
  section,
  disabled,
  onToggle,
}: {
  section: Section
  /** A create or apply run is busy: the selection must not change. */
  disabled: boolean
  onToggle(keyId: string, checked: boolean): void
}) {
  const { t } = useTranslation()
  const headingId = useId()
  const pending = section.status === 'waiting' || section.status === 'loading'
  return (
    <section
      aria-labelledby={headingId}
      aria-busy={section.status === 'loading' || undefined}
      className="space-y-2"
    >
      <h3 id={headingId} className="font-mono text-sm font-semibold">
        {section.language}
      </h3>
      {pending && (
        <p
          className={cn(
            'flex items-center gap-1.5 text-sm text-muted-foreground',
            section.status === 'waiting' && 'opacity-60'
          )}
        >
          {section.status === 'loading' && (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          )}
          {t('translations.ai.dialog.creating')}
        </p>
      )}
      {section.error && (
        <Alert variant="destructive">
          <AlertDescription>{section.error}</AlertDescription>
        </Alert>
      )}
      {section.status === 'done' &&
        section.suggestions.length === 0 &&
        section.remaining === 0 && (
          <p className="text-sm text-muted-foreground">
            {t('translations.ai.dialog.nothing')}
          </p>
        )}
      {section.suggestions.length > 0 && (
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="w-1/4 py-1 pr-2 font-medium">
                {t('translations.ai.dialog.col-key')}
              </th>
              <th className="py-1 pr-2 font-medium">
                {t('translations.ai.dialog.col-source')}
              </th>
              <th className="py-1 font-medium">
                {t('translations.ai.dialog.col-suggestion')}
              </th>
            </tr>
          </thead>
          <tbody>
            {section.suggestions.map((s) => (
              <tr key={s.keyId} className="border-b align-top last:border-0">
                <td className="py-1.5 pr-2">
                  <span className="flex items-start gap-2">
                    <Checkbox
                      className="mt-0.5"
                      aria-label={s.key}
                      checked={
                        selectable(s) && section.checked[s.keyId] === true
                      }
                      disabled={disabled || !selectable(s)}
                      onCheckedChange={(next) =>
                        onToggle(s.keyId, next === true)
                      }
                    />
                    <span className="break-all font-mono text-xs" title={s.key}>
                      {s.key}
                    </span>
                  </span>
                </td>
                <td className="whitespace-pre-wrap break-words py-1.5 pr-2 text-muted-foreground">
                  {s.source}
                </td>
                <td className="whitespace-pre-wrap break-words py-1.5">
                  {s.value}
                  {s.placeholderMismatch && (
                    <span className="mt-1 flex items-start gap-1 text-xs text-warning">
                      <AlertTriangle
                        className="mt-0.5 h-3 w-3 shrink-0"
                        aria-hidden
                      />
                      {t('translations.ai.placeholder-warning')}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {section.remaining > 0 && (
        <p className="text-sm text-muted-foreground">
          {t('translations.ai.dialog.remaining', { count: section.remaining })}
        </p>
      )}
    </section>
  )
}
