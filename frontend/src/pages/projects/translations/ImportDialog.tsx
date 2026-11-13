import { FileJson, Loader2 } from 'lucide-react'
import {
  type DragEvent,
  type JSX,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
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
import { apiMessage, getErrorStatus } from '@/lib/errors'
import { handleForbidden } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { applyImport, previewImport } from './api'
import { readJsonFile } from './readJsonFile'
import { TargetSelect } from './TargetSelect'
import type { ImportPreview, ImportTarget, SkipReason } from './types'

/** Entries shown per list; the rest is summarised as "and n more". */
const LIST_LIMIT = 100

const FILE_ERROR_KEYS = {
  too_large: 'translations.import-dialog.error-too-large',
  not_json: 'translations.import-dialog.error-not-json',
  not_object: 'translations.import-dialog.error-not-object',
} as const

const REASON_KEYS: Record<SkipReason, string> = {
  not_string: 'translations.import-dialog.reason-not-string',
  empty: 'translations.import-dialog.reason-empty',
  invalid_key: 'translations.import-dialog.reason-invalid-key',
  too_long: 'translations.import-dialog.reason-too-long',
  conflict: 'translations.import-dialog.reason-conflict',
}

type Brand = { id: string; name: string; languages: string[] }

/** What the import can go to, captured when the dialog opens. */
interface Snapshot {
  projectId: string
  brands: Brand[]
  namespace: string
  /** Languages of the standard texts. */
  languages: string[]
}

interface ChosenFile {
  name: string
  content: Record<string, unknown>
}

/** A preview together with exactly what it was computed for. */
interface Previewed {
  fileName: string
  content: Record<string, unknown>
  language: string
  result: ImportPreview
}

/**
 * The language a file name names: `de.json` or `….de.json`. Region codes
 * contain `-`, so other separators are not guessed at.
 */
export function languageFromFileName(
  name: string,
  languages: string[]
): string | null {
  if (!name.toLowerCase().endsWith('.json')) return null
  const base = name.slice(0, -'.json'.length)
  if (languages.includes(base)) return base
  const suffix = base.slice(base.lastIndexOf('.') + 1)
  return base.includes('.') && languages.includes(suffix) ? suffix : null
}

/**
 * The locale text for a 413. Only the backend's JSON answer names its limits
 * (2 MB, or too many entries); a 413 from a proxy in front of it (an HTML page
 * from nginx, or no body) may come from a smaller limit, so its text promises
 * none. The server's own wording is never shown: it is not localised.
 */
function tooLargeKey(err: unknown): string {
  const data = (err as { response?: { data?: unknown } }).response?.data
  const message =
    data !== null && typeof data === 'object'
      ? (data as { message?: unknown }).message
      : undefined
  if (typeof message !== 'string' || !message) {
    return 'translations.import-dialog.too-large'
  }
  return /too many entries/i.test(message)
    ? 'translations.import-dialog.too-many-entries'
    : 'translations.import-dialog.error-too-large'
}

const targetOf = (
  snapshot: Snapshot,
  brand: Brand | null,
  language: string
): ImportTarget => ({
  language,
  namespace: snapshot.namespace,
  ...(brand ? { brandId: brand.id } : {}),
})

/**
 * Imports an i18next JSON file into one language of the standard texts or
 * of one brand. Step 1 chooses target, file and language, step 2 shows the
 * server's preview, and only "Importieren" there writes. Nothing is ever
 * deleted.
 *
 * Project, brands and namespace are captured when the dialog opens; preview
 * and import both go to the chosen target, with the very content the
 * preview was computed for.
 */
export function ImportDialog(props: {
  open: boolean
  onOpenChange(open: boolean): void
  projectId: string
  /** Brands of a MULTI project; empty = no target selection. */
  brands: Brand[]
  namespace: string
  /** Languages of the standard texts. */
  languages: string[]
  onImported(): void
}): JSX.Element {
  const { open, onOpenChange, onImported } = props
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  /** Chosen target: null = standard texts. */
  const [brandId, setBrandId] = useState<string | null>(null)
  const [file, setFile] = useState<ChosenFile | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileError, setFileError] = useState<
    keyof typeof FILE_ERROR_KEYS | null
  >(null)
  const [reading, setReading] = useState(false)
  const [language, setLanguage] = useState('')
  /** The language came from a file name, so the next file may replace it. */
  const [languageGuessed, setLanguageGuessed] = useState(false)
  const [previewed, setPreviewed] = useState<Previewed | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  /** Bumped on every open and close; late answers of an old session are dropped. */
  const [sessionId, setSessionId] = useState(0)
  const session = useRef(sessionId)
  /** Only the last chosen file may land. */
  const lastRead = useRef(0)
  const fileId = useId()
  const fileErrorId = useId()
  const fileHintId = useId()
  const languageId = useId()

  // Reset while rendering the opening frame (not in an effect), so a reopened
  // dialog never paints the previous file or preview.
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    setSnapshot({
      projectId: props.projectId,
      brands: props.brands,
      namespace: props.namespace,
      languages: props.languages,
    })
    setBrandId(null)
    setFile(null)
    setFileName(null)
    setFileError(null)
    setReading(false)
    setLanguage(props.languages.length === 1 ? props.languages[0] : '')
    setLanguageGuessed(false)
    setPreviewed(null)
    setBusy(false)
    setError(null)
    setSessionId((id) => id + 1)
    setDragging(false)
  } else if (!open && wasOpen) {
    setWasOpen(false)
    setSessionId((id) => id + 1)
  }

  useEffect(() => {
    session.current = sessionId
  }, [sessionId])

  const target = snapshot ?? {
    projectId: props.projectId,
    brands: props.brands,
    namespace: props.namespace,
    languages: props.languages,
  }
  const brand = target.brands.find((b) => b.id === brandId) ?? null
  const languages = brand ? brand.languages : target.languages

  /**
   * Another target discards an existing preview; a language the new target
   * lacks is dropped (guessed again from the file name where possible).
   */
  const changeTarget = (next: string | null) => {
    if (busy) return
    setBrandId(next)
    setPreviewed(null)
    setError(null)
    const nextBrand = target.brands.find((b) => b.id === next) ?? null
    const nextLanguages = nextBrand ? nextBrand.languages : target.languages
    if (language && nextLanguages.includes(language)) return
    const guessed = file ? languageFromFileName(file.name, nextLanguages) : null
    setLanguage(guessed ?? (nextLanguages.length === 1 ? nextLanguages[0] : ''))
    setLanguageGuessed(guessed !== null)
  }

  const chooseFile = async (chosen: File | undefined) => {
    if (!chosen || busy) return
    const id = ++lastRead.current
    const current = session.current
    setFileName(chosen.name)
    setFile(null)
    setFileError(null)
    setError(null)
    setReading(true)
    const result = await readJsonFile(chosen)
    if (id !== lastRead.current || current !== session.current) return
    setReading(false)
    if (!result.ok) {
      setFileError(result.error)
      return
    }
    setFile({ name: chosen.name, content: result.content })
    const guessed = languageFromFileName(chosen.name, languages)
    if (guessed) {
      setLanguage(guessed)
      setLanguageGuessed(true)
    } else if (languageGuessed && languages.length !== 1) {
      setLanguage('')
      setLanguageGuessed(false)
    }
  }

  /** Shows a failed request in the dialog; it stays open with its input. */
  const fail = (err: unknown) => {
    if (handleForbidden(err, t)) return
    const status = getErrorStatus(err)
    if (status === 413) {
      setError(t(tooLargeKey(err)))
    } else if (status === 400) {
      setError(apiMessage(err, t('translations.import-dialog.failed')))
    } else {
      setError(t('translations.import-dialog.failed'))
    }
  }

  const runPreview = async () => {
    if (busy || reading || !file || !language) return
    const current = session.current
    const content = file.content
    setBusy(true)
    setError(null)
    try {
      const result = await previewImport(
        target.projectId,
        targetOf(target, brand, language),
        content
      )
      if (current === session.current)
        setPreviewed({ fileName: file.name, content, language, result })
    } catch (err) {
      if (current === session.current) fail(err)
    } finally {
      if (current === session.current) setBusy(false)
    }
  }

  const runImport = async () => {
    if (busy || !previewed) return
    const { added, changed } = previewed.result
    if (added.length + changed.length === 0) return
    const current = session.current
    setBusy(true)
    setError(null)
    try {
      const result = await applyImport(
        target.projectId,
        targetOf(target, brand, previewed.language),
        previewed.content
      )
      toast.success(
        t('translations.import-dialog.done', {
          added: result.added.length,
          changed: result.changed.length,
          unchanged: result.unchanged.length,
          skipped: result.skipped.length,
        })
      )
      onOpenChange(false)
      onImported()
    } catch (err) {
      if (current === session.current) fail(err)
    } finally {
      if (current === session.current) setBusy(false)
    }
  }

  const back = () => {
    if (busy) return
    setPreviewed(null)
    setError(null)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    void chooseFile(event.dataTransfer?.files?.[0])
  }

  const errorAlert = error && (
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  )

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        {previewed ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {t('translations.import-dialog.preview-title')}
              </DialogTitle>
              <DialogDescription>
                {t('translations.import-dialog.preview-text', {
                  file: previewed.fileName,
                  language: previewed.language,
                })}
              </DialogDescription>
            </DialogHeader>
            <PreviewDetails
              result={previewed.result}
              brandTarget={brand !== null}
            />
            {errorAlert}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={back}
                disabled={busy}
                autoFocus
              >
                {t('translations.import-dialog.back')}
              </Button>
              <Button
                type="button"
                onClick={() => void runImport()}
                disabled={
                  busy ||
                  previewed.result.added.length +
                    previewed.result.changed.length ===
                    0
                }
              >
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('translations.import-dialog.submit')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('translations.import')}</DialogTitle>
              <DialogDescription>
                {t('translations.import-dialog.text')}
              </DialogDescription>
            </DialogHeader>

            <fieldset className="rounded-md border px-3 py-2">
              <legend className="px-1 text-xs font-medium text-muted-foreground">
                {t('translations.import-dialog.target')}
              </legend>
              {target.brands.length > 0 && (
                <div className="mb-2">
                  <TargetSelect
                    brands={target.brands}
                    value={brand?.id ?? null}
                    onChange={changeTarget}
                    disabled={busy}
                  />
                </div>
              )}
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">
                  {t('translations.toolbar.namespace')}
                </dt>
                <dd className="break-all font-mono">{target.namespace}</dd>
              </dl>
            </fieldset>

            {languages.length === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                {t('translations.import-dialog.no-languages')}
              </p>
            ) : (
              <div className="space-y-4">
                {/* biome-ignore lint/a11y/noStaticElementInteractions: dropping is a pointer-only shortcut; the file input inside is the accessible way */}
                <div
                  data-testid="import-drop-zone"
                  onDragOver={(event) => {
                    event.preventDefault()
                    setDragging(true)
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  className={cn(
                    'space-y-2 rounded-md border border-dashed p-3 transition-colors',
                    dragging && 'border-primary bg-accent'
                  )}
                >
                  <Label htmlFor={fileId}>
                    {t('translations.import-dialog.file')}
                  </Label>
                  <input
                    key={sessionId}
                    id={fileId}
                    type="file"
                    accept=".json,application/json"
                    onChange={(event) => {
                      void chooseFile(event.target.files?.[0])
                    }}
                    disabled={busy}
                    aria-invalid={fileError ? 'true' : undefined}
                    aria-describedby={fileError ? fileErrorId : fileHintId}
                    className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
                  />
                  {fileName && (
                    <p className="flex items-center gap-1.5 text-sm">
                      {reading ? (
                        <Loader2
                          className="h-4 w-4 shrink-0 animate-spin"
                          aria-hidden
                        />
                      ) : (
                        <FileJson className="h-4 w-4 shrink-0" aria-hidden />
                      )}
                      <span className="break-all font-mono">{fileName}</span>
                    </p>
                  )}
                  {fileError ? (
                    <p
                      id={fileErrorId}
                      role="alert"
                      className="text-xs text-destructive"
                    >
                      {t(FILE_ERROR_KEYS[fileError])}
                    </p>
                  ) : (
                    <p
                      id={fileHintId}
                      className="text-xs text-muted-foreground"
                    >
                      {t('translations.import-dialog.file-hint')}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor={languageId}>
                    {t('translations.import-dialog.language')}
                  </Label>
                  <Select
                    value={language}
                    onValueChange={(next) => {
                      setLanguage(next)
                      setLanguageGuessed(false)
                      setError(null)
                    }}
                    disabled={busy}
                  >
                    <SelectTrigger id={languageId} className="font-mono">
                      <SelectValue
                        placeholder={t(
                          'translations.import-dialog.language-placeholder'
                        )}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {languages.map((code) => (
                        <SelectItem
                          key={code}
                          value={code}
                          className="font-mono"
                        >
                          {code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {errorAlert}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                {t('common.cancel')}
              </Button>
              {languages.length > 0 && (
                <Button
                  type="button"
                  onClick={() => void runPreview()}
                  disabled={busy || reading || !file || !language}
                >
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t('translations.import-dialog.preview')}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Counts, expandable key lists and skipped entries of a preview. */
function PreviewDetails({
  result,
  brandTarget,
}: {
  result: ImportPreview
  brandTarget: boolean
}) {
  const { t } = useTranslation()
  const nothing = result.added.length + result.changed.length === 0
  return (
    <div className="max-h-[60vh] space-y-3 overflow-y-auto">
      <div className="space-y-1">
        <KeyList
          label={t('translations.import-dialog.added')}
          keys={result.added}
        />
        <KeyList
          label={t('translations.import-dialog.changed')}
          keys={result.changed}
        />
        <KeyList
          label={t('translations.import-dialog.unchanged')}
          keys={result.unchanged}
        />
        <KeyList
          label={t('translations.import-dialog.new-keys')}
          keys={result.newKeys}
        />
      </div>

      {result.skipped.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {t('translations.import-dialog.count', {
              label: t('translations.import-dialog.skipped'),
              count: result.skipped.length,
            })}
          </p>
          <ul
            aria-label={t('translations.import-dialog.skipped-list')}
            className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border px-3 py-2 text-xs"
          >
            {result.skipped.slice(0, LIST_LIMIT).map((entry, index) => (
              // Keys may repeat after truncation; the index keeps them apart.
              // biome-ignore lint/suspicious/noArrayIndexKey: the list never reorders
              <li key={index} className="break-all">
                <span className="font-mono" title={entry.key}>
                  {entry.key}
                </span>
                {' – '}
                <span className="text-muted-foreground">
                  {t(REASON_KEYS[entry.reason])}
                </span>
              </li>
            ))}
          </ul>
          <More total={result.skipped.length} />
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        {t('translations.import-dialog.no-delete')}
      </p>
      {brandTarget && (
        <p className="text-sm text-muted-foreground">
          {t('translations.import-dialog.brand-note')}
        </p>
      )}
      {nothing && (
        <p role="status" className="text-sm font-medium">
          {t('translations.import-dialog.nothing')}
        </p>
      )}
    </div>
  )
}

/** One category: a plain count when empty, an expandable list otherwise. */
function KeyList({ label, keys }: { label: string; keys: string[] }) {
  const { t } = useTranslation()
  const heading = t('translations.import-dialog.count', {
    label,
    count: keys.length,
  })
  if (keys.length === 0) return <p className="text-sm">{heading}</p>
  return (
    <details className="text-sm">
      <summary className="cursor-pointer">{heading}</summary>
      <ul
        aria-label={label}
        className="mt-1 max-h-48 space-y-0.5 overflow-y-auto rounded-md border px-3 py-2 font-mono text-xs"
      >
        {keys.slice(0, LIST_LIMIT).map((key) => (
          <li key={key} title={key} className="break-all">
            {key}
          </li>
        ))}
      </ul>
      <More total={keys.length} />
    </details>
  )
}

function More({ total }: { total: number }) {
  const { t } = useTranslation()
  if (total <= LIST_LIMIT) return null
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {t('translations.import-dialog.more', { count: total - LIST_LIMIT })}
    </p>
  )
}
