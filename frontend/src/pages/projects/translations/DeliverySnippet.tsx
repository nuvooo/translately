import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CodeBlock } from '@/components/webhooks/CodeBlock'
import { orgPath } from '@/lib/routes'
import { backendOrigin, deliveryLoadPath, i18nextSnippet } from './deliveryUrl'
import { TargetSelect } from './TargetSelect'

interface DeliverySnippetDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  projectKey: string
  /** Brands of a MULTI project; empty = only the standard texts. */
  brands: { id: string; key: string; name: string; languages: string[] }[]
  /** Languages of the standard texts; the first one is the fallback language. */
  projectLanguages: string[]
  /** Organization of the project, for the link to its API keys. */
  organizationId?: string
}

/**
 * Dialog with a ready-to-copy i18next configuration that loads the standard
 * texts, or those of the chosen brand, from the delivery endpoint. It is
 * opened from the actions menu and starts with the standard texts each time.
 */
export function DeliverySnippetDialog({
  open,
  onOpenChange,
  projectKey,
  brands,
  projectLanguages,
  organizationId,
}: DeliverySnippetDialogProps) {
  const { t } = useTranslation()
  const [brandId, setBrandId] = useState<string | null>(null)
  // Reset while rendering the opening frame (not in an effect), so a reopened
  // dialog never shows the brand chosen last time.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setBrandId(null)
  }
  const brand = brands.find((b) => b.id === brandId) ?? null

  const snippet = i18nextSnippet(
    deliveryLoadPath(backendOrigin(), projectKey, brand?.key),
    brand ? brand.languages : projectLanguages
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('translations.snippet.title')}</DialogTitle>
          <DialogDescription>
            {brand
              ? t('translations.snippet.scope-brand', { brand: brand.name })
              : t('translations.snippet.scope')}
          </DialogDescription>
        </DialogHeader>
        {brands.length > 0 && (
          <div>
            <TargetSelect
              brands={brands}
              value={brand?.id ?? null}
              onChange={setBrandId}
            />
          </div>
        )}
        <CodeBlock code={snippet} label={t('translations.snippet.label')} />
        <p className="text-sm text-muted-foreground">
          {t('translations.snippet.replace-note')}
        </p>
        <p className="text-sm text-muted-foreground">
          <Trans
            i18nKey="translations.snippet.api-key-note"
            components={{
              keys: organizationId ? (
                <Link
                  to={orgPath(organizationId, 'api-keys')}
                  className="font-medium text-foreground underline underline-offset-2"
                />
              ) : (
                <span className="font-medium text-foreground" />
              ),
            }}
          />
        </p>
      </DialogContent>
    </Dialog>
  )
}
