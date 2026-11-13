import { Search } from 'lucide-react'
import { type ReactNode, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { TranslationsSelection } from './useTranslations'

interface TranslationsToolbarProps {
  /** Namespace selector only with more than one namespace. */
  namespaces: string[]
  selection: TranslationsSelection
  select(patch: Partial<TranslationsSelection>): void
  /** Slot for the actions menu (languages, import, snippet, export). */
  actions?: ReactNode
}

/**
 * One row above the table: namespace selector, search and the "missing
 * only" switch, the actions on the right. Every change goes through `select`.
 */
export function TranslationsToolbar({
  namespaces,
  selection,
  select,
  actions,
}: TranslationsToolbarProps) {
  const { t } = useTranslation()
  const missingId = useId()
  const namespaceLabel = t('translations.toolbar.namespace')

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {namespaces.length > 1 && (
        <Select
          value={selection.namespace}
          onValueChange={(namespace) => select({ namespace })}
        >
          <SelectTrigger
            aria-label={namespaceLabel}
            className="h-8 w-auto min-w-40 gap-2"
          >
            <span className="text-muted-foreground">{namespaceLabel}:</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {namespaces.map((namespace) => (
              <SelectItem key={namespace} value={namespace}>
                {namespace}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <div className="relative w-full sm:w-64">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={selection.search}
          onChange={(event) => select({ search: event.target.value })}
          placeholder={t('translations.toolbar.search-placeholder')}
          aria-label={t('translations.toolbar.search')}
          // The server rejects longer searches with 400 (table-query.dto.ts).
          maxLength={200}
          className="h-8 pl-8"
        />
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id={missingId}
          checked={selection.missingOnly}
          onCheckedChange={(missingOnly) => select({ missingOnly })}
        />
        <Label htmlFor={missingId} className="cursor-pointer font-normal">
          {t('translations.toolbar.missing-only')}
        </Label>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {actions}
        </div>
      )}
    </div>
  )
}
