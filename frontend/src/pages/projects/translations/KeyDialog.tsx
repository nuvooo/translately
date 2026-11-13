import { Loader2 } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import type { TableRow } from './types'

export const MAX_KEY_LENGTH = 256
const MAX_DESCRIPTION_LENGTH = 500
const RESERVED_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true
  }
  return false
}

/**
 * Client-side mirror of the server's key rule; returns the locale key of the
 * message, or null for a valid key.
 */
export function keyError(key: string): string | null {
  if (key.length === 0) return 'translations.key-error.required'
  if (key.length > MAX_KEY_LENGTH) return 'translations.key-error.too-long'
  if (hasControlCharacter(key)) return 'translations.key-error.control'
  if (key.startsWith('.') || key.endsWith('.') || key.includes('..'))
    return 'translations.key-error.dots'
  if (key.split('.').some((segment) => RESERVED_SEGMENTS.has(segment)))
    return 'translations.key-error.reserved'
  return null
}

interface KeyDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  /** Key to rename; `null` creates a new key (with description). */
  row: TableRow | null
  /** Resolves `false` to keep the dialog open (the caller reported why). */
  onSubmit(key: string, description: string): Promise<boolean>
}

/** Create a key (key and description) or rename one (key only). */
export function KeyDialog({
  open,
  onOpenChange,
  row,
  onSubmit,
}: KeyDialogProps) {
  const { t } = useTranslation()
  const [key, setKey] = useState('')
  const [description, setDescription] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const keyId = useId()
  const errorId = useId()
  const descriptionId = useId()
  const renaming = row !== null

  // Reset while rendering the opening frame (not in an effect), so the first
  // frame never shows the previous values; closing keeps them for the exit.
  const [shownFor, setShownFor] = useState<{ row: TableRow | null } | null>(
    null
  )
  if (open && (shownFor === null || shownFor.row !== row)) {
    setShownFor({ row })
    setKey(row?.key ?? '')
    setDescription('')
    setSubmitted(false)
  } else if (!open && shownFor !== null) {
    setShownFor(null)
  }

  const error = keyError(key)
  const showError = submitted && error !== null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (error || busy) return
    setBusy(true)
    let ok = false
    try {
      ok = await onSubmit(key, description)
    } finally {
      setBusy(false)
    }
    if (ok) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {renaming
              ? t('translations.key-dialog.rename-title')
              : t('translations.key-dialog.create-title')}
          </DialogTitle>
          <DialogDescription>
            {t('translations.key-dialog.text')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={keyId}>{t('translations.key-dialog.key')}</Label>
            <Input
              id={keyId}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="checkout.title"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              aria-invalid={showError ? 'true' : undefined}
              aria-describedby={showError ? errorId : undefined}
              className="font-mono"
            />
            {showError && error && (
              <p id={errorId} className="text-xs text-destructive">
                {t(error, { max: MAX_KEY_LENGTH })}
              </p>
            )}
          </div>
          {!renaming && (
            <div className="space-y-2">
              <Label htmlFor={descriptionId}>
                {t('translations.key-dialog.description')}{' '}
                <span className="font-normal text-muted-foreground">
                  ({t('common.optional')})
                </span>
              </Label>
              <Input
                id={descriptionId}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t(
                  'translations.key-dialog.description-placeholder'
                )}
                maxLength={MAX_DESCRIPTION_LENGTH}
              />
            </div>
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
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {renaming
                ? t('common.save')
                : t('translations.key-dialog.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
