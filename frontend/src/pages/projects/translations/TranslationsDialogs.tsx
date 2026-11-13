import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { AiTranslateDialog } from './AiTranslateDialog'
import { ImportDialog } from './ImportDialog'
import { KeyDialog } from './KeyDialog'
import { LanguagesDialog } from './LanguagesDialog'
import type { TableRow } from './types'

/** What the AI dialog translates; captured by the page when it is opened. */
export interface AiTranslateDialogTarget {
  projectId: string
  namespace: string
  projectLanguages: string[]
}

/** What an import can go to; captured by the page when the dialog is opened. */
export interface ImportDialogTarget {
  projectId: string
  /** Brands of a MULTI project; the dialog offers them as targets. */
  brands: { id: string; name: string; languages: string[] }[]
  namespace: string
  /** Languages of the standard texts. */
  languages: string[]
}

interface TranslationsDialogsProps {
  /** Languages dialog, only for ADMIN and above (null hides it). */
  languages: {
    open: boolean
    onOpenChange(open: boolean): void
    project: { id: string; languages: string[] }
    /** The chosen target; null = the project's standard texts. */
    brand: { id: string; name: string; languages: string[] } | null
    /** Brands offered as targets (empty = no target selection). */
    brands: { id: string; name: string }[]
    onTargetChange(brandId: string | null): void
    onSaved(): void
    onStale(): Promise<void>
  } | null
  keyDialog: {
    open: boolean
    onOpenChange(open: boolean): void
    row: TableRow | null
    onSubmit(key: string, description: string): Promise<boolean>
  }
  remove: {
    open: boolean
    onOpenChange(open: boolean): void
    row: TableRow | null
    onConfirm(row: TableRow): Promise<unknown>
  }
  /** Import dialog, only for MEMBER and above once opened (null hides it). */
  importDialog: {
    open: boolean
    onOpenChange(open: boolean): void
    target: ImportDialogTarget
    onImported(): void
  } | null
  /** AI translation dialog, only for MEMBER and above with AI on (null hides it). */
  aiTranslate: {
    open: boolean
    onOpenChange(open: boolean): void
    target: AiTranslateDialogTarget
    onApplied(): void
  } | null
}

/** The dialogs of the translations page; it keeps their state. */
export function TranslationsDialogs({
  languages,
  keyDialog,
  remove,
  importDialog,
  aiTranslate,
}: TranslationsDialogsProps) {
  const { t } = useTranslation()
  return (
    <>
      {languages && (
        <LanguagesDialog
          open={languages.open}
          onOpenChange={languages.onOpenChange}
          scope={
            languages.brand
              ? {
                  kind: 'brand',
                  id: languages.brand.id,
                  name: languages.brand.name,
                  projectLanguages: languages.project.languages,
                }
              : { kind: 'project', id: languages.project.id }
          }
          languages={
            languages.brand
              ? languages.brand.languages
              : languages.project.languages
          }
          onSaved={languages.onSaved}
          onStale={languages.onStale}
          target={{
            brands: languages.brands,
            value: languages.brand?.id ?? null,
            onChange: languages.onTargetChange,
          }}
        />
      )}
      <KeyDialog
        open={keyDialog.open}
        onOpenChange={keyDialog.onOpenChange}
        row={keyDialog.row}
        onSubmit={keyDialog.onSubmit}
      />
      <ConfirmDialog
        open={remove.open}
        onOpenChange={remove.onOpenChange}
        title={t('translations.delete.title')}
        description={t('translations.delete.description', {
          key: remove.row?.key ?? '',
        })}
        confirmLabel={t('common.delete')}
        onConfirm={async () => {
          if (remove.row) await remove.onConfirm(remove.row)
        }}
      />
      {importDialog && (
        <ImportDialog
          open={importDialog.open}
          onOpenChange={importDialog.onOpenChange}
          {...importDialog.target}
          onImported={importDialog.onImported}
        />
      )}
      {aiTranslate && (
        <AiTranslateDialog
          open={aiTranslate.open}
          onOpenChange={aiTranslate.onOpenChange}
          {...aiTranslate.target}
          onApplied={aiTranslate.onApplied}
        />
      )}
    </>
  )
}
