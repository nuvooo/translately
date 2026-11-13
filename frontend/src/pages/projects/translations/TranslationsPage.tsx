import { FileJson, FolderX, Languages, Plus, SearchX } from 'lucide-react'
import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { RoleUnavailableNotice } from '@/components/feedback/RoleUnavailableNotice'
import { PageHeader } from '@/components/page/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useProjectRole } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { TranslationsActionsMenu } from './TranslationsActionsMenu'
import {
  type AiTranslateDialogTarget,
  type ImportDialogTarget,
  TranslationsDialogs,
} from './TranslationsDialogs'
import { TranslationsTable } from './TranslationsTable'
import { TranslationsToolbar } from './TranslationsToolbar'
import { scopeOf } from './translationsState'
import type { TableRow } from './types'
import { useAiTranslation } from './useAiTranslation'
import { useTranslations } from './useTranslations'

/** Stable "no brands" for SINGLE projects (the table rows are memoised). */
const NO_BRANDS: {
  id: string
  key: string
  name: string
  languages: string[]
}[] = []

/**
 * Translations of a project: a compact toolbar (namespace, search, filter,
 * actions) and the table of keys × languages with in-place editing, where
 * each key expands to one row per brand. The page only orchestrates; table,
 * cell, toolbar and dialogs live in their own files.
 */
export default function TranslationsPage() {
  const { t } = useTranslation()
  const { projectId = '' } = useParams<{ projectId: string }>()
  const {
    project,
    brands,
    selection,
    select,
    table,
    tableScope,
    isLoading,
    error,
    isBusy,
    saveValue,
    unlink,
    relink,
    createKey,
    renameKey,
    deleteKey,
    setKeyLocked,
    reload,
  } = useTranslations(projectId || null)
  const { canEdit, canManage, roleUnavailable, organizationId } =
    useProjectRole(projectId)
  const readOnly = !canEdit
  const ai = useAiTranslation(projectId || null)
  // Without AI on this instance, or for a VIEWER, the feature leaves no trace.
  const onSuggest = ai.enabled && canEdit ? ai.suggest : undefined
  // Targets outlive the open state so the dialogs keep their content while closing.
  const [keyDialogOpen, setKeyDialogOpen] = useState(false)
  const [renaming, setRenaming] = useState<TableRow | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState<TableRow | null>(null)
  const [languagesOpen, setLanguagesOpen] = useState(false)
  /** Target of the languages dialog: null = the project's standard texts. */
  const [languagesTarget, setLanguagesTarget] = useState<string | null>(null)
  // After a save the stored list is stale until the reload has landed; the
  // dialog must not be reopened from it meanwhile.
  const [languagesReloading, setLanguagesReloading] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importTarget, setImportTarget] = useState<ImportDialogTarget | null>(
    null
  )
  const [aiOpen, setAiOpen] = useState(false)
  const [aiTarget, setAiTarget] = useState<AiTranslateDialogTarget | null>(null)

  // Brands only exist for MULTI projects. The reference stays stable: the
  // table hands it to memoised rows.
  const projectType = project?.type
  const tableBrands = useMemo(
    () => (projectType === 'MULTI' ? brands : NO_BRANDS),
    [projectType, brands]
  )

  const openCreate = useCallback(() => {
    setRenaming(null)
    setKeyDialogOpen(true)
  }, [])
  const openRename = useCallback((row: TableRow) => {
    setRenaming(row)
    setKeyDialogOpen(true)
  }, [])
  const openDelete = useCallback((row: TableRow) => {
    setDeleting(row)
    setDeleteOpen(true)
  }, [])
  const lockKey = useCallback(
    (row: TableRow, locked: boolean) => {
      void setKeyLocked(row, locked)
    },
    [setKeyLocked]
  )
  const changePage = useCallback((page: number) => select({ page }), [select])
  const resetFilters = () => select({ search: '', missingOnly: false, page: 1 })
  const firstPage = () => select({ page: 1 })
  /** Opens the languages dialog; it starts with the standard texts. */
  const manageLanguages = () => {
    setLanguagesTarget(null)
    setLanguagesOpen(true)
  }
  const reloadLanguages = async () => {
    setLanguagesReloading(true)
    try {
      await reload()
    } finally {
      setLanguagesReloading(false)
    }
  }
  const submitKey = (key: string, description: string) => {
    if (!renaming) return createKey(key, description)
    if (key === renaming.key) return Promise.resolve(true)
    return renameKey(renaming, key)
  }

  const addKeyButton = (
    <Button onClick={openCreate}>
      <Plus className="mr-2 h-4 w-4" aria-hidden />
      {t('translations.add-key')}
    </Button>
  )

  const projectLanguages = project?.languages ?? []
  // A brand that is gone after a reload falls back to the standard texts.
  const languagesBrand =
    tableBrands.find((b) => b.id === languagesTarget) ?? null
  const filtered = selection.search.trim() !== '' || selection.missingOnly

  /** The scope (the namespace) the selection asks for. */
  const selectionScope = scopeOf(selection)
  /**
   * The rows on screen were loaded for another scope (a switch is still
   * loading). The hook states the table's scope; nothing is inferred here.
   */
  const foreignTable = table !== null && tableScope !== selectionScope

  // Neither the project nor any brand has a language. The empty state
  // "no languages" carries the button itself.
  const noLanguages =
    table !== null &&
    projectLanguages.length === 0 &&
    tableBrands.every((b) => b.languages.length === 0)

  /** Imports into the namespace on screen; the dialog keeps this while open. */
  const openImport = () => {
    if (!project) return
    setImportTarget({
      projectId: project.id,
      brands: tableBrands,
      namespace: selection.namespace,
      languages: project.languages,
    })
    setImportOpen(true)
  }
  const importBlocked = table === null || foreignTable
  const importButton = (
    <Button variant="outline" onClick={openImport} disabled={importBlocked}>
      <FileJson className="mr-2 h-4 w-4" aria-hidden />
      {t('translations.import')}
    </Button>
  )
  // The empty state "no keys" carries the import button itself.
  let importInBody = false

  // Translating needs a source and a target language.
  const canTranslate = ai.enabled && canEdit && projectLanguages.length >= 2
  /** Translates the namespace on screen; the dialog keeps this while open. */
  const openAiTranslate = () => {
    if (!project) return
    setAiTarget({
      projectId: project.id,
      namespace: selection.namespace,
      projectLanguages: project.languages,
    })
    setAiOpen(true)
  }

  let headerActions: ReactNode
  let content: ReactNode
  if (error === 'not-found') {
    content = (
      <EmptyState
        icon={<FolderX className="h-5 w-5" />}
        title={t('translations.not-found-title')}
        description={t('translations.not-found-text')}
      />
    )
  } else if (error === 'failed') {
    content = (
      <ErrorState
        message={t('translations.load-error')}
        onRetry={() => {
          void reload()
        }}
      />
    )
  } else if (!project) {
    content = <TableSkeleton />
  } else {
    let body: ReactNode
    if (!table) {
      body = <TableSkeleton />
    } else if (noLanguages) {
      body = (
        <EmptyState
          icon={<Languages className="h-5 w-5" />}
          title={t('translations.no-languages-title')}
          description={
            canManage
              ? t('translations.no-languages-text')
              : t('translations.no-languages-text-readonly')
          }
          action={
            canManage ? (
              <Button
                variant="outline"
                onClick={manageLanguages}
                disabled={languagesReloading}
              >
                {t('translations.manage-languages')}
              </Button>
            ) : undefined
          }
        />
      )
    } else if (table.total === 0 && !filtered) {
      importInBody = true
      body = (
        <EmptyState
          icon={<Languages className="h-5 w-5" />}
          title={t('translations.empty-title')}
          description={
            canEdit
              ? t('translations.empty-text')
              : t('translations.empty-text-readonly')
          }
          action={
            canEdit ? (
              <div className="flex flex-wrap justify-center gap-2">
                {addKeyButton}
                {importButton}
              </div>
            ) : undefined
          }
        />
      )
    } else if (table.rows.length === 0) {
      if (canEdit) headerActions = addKeyButton
      // Without a filter, an empty page means keys were removed meanwhile.
      body = filtered ? (
        <EmptyState
          icon={<SearchX className="h-5 w-5" />}
          title={t('translations.no-matches')}
          description={t('translations.no-matches-text')}
          action={
            <Button variant="outline" onClick={resetFilters}>
              {t('translations.reset-filters')}
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={<SearchX className="h-5 w-5" />}
          title={t('translations.page-empty')}
          description={t('translations.page-empty-text')}
          action={
            <Button variant="outline" onClick={firstPage}>
              {t('translations.first-page')}
            </Button>
          }
        />
      )
    } else {
      if (canEdit) headerActions = addKeyButton
      body = (
        <>
          {readOnly && !roleUnavailable && (
            <p className="mb-2 text-xs text-muted-foreground">
              {t('translations.read-only')}
            </p>
          )}
          <TranslationsTable
            // A draft belongs to the scope it was typed in: a new namespace
            // remounts the rows and discards open editors. Search, filter
            // and page are not part of the key on purpose.
            key={selectionScope}
            table={table}
            brands={tableBrands}
            projectLanguages={project.languages}
            // Rows of another scope (switch still loading) are locked.
            readOnly={readOnly || foreignTable}
            isBusy={isBusy}
            onSave={saveValue}
            onUnlink={unlink}
            onRelink={relink}
            onRename={openRename}
            onDelete={openDelete}
            onLock={lockKey}
            onPage={changePage}
            canDelete={canManage}
            onSuggest={onSuggest}
          />
        </>
      )
    }

    const reloading = (isLoading || foreignTable) && table !== null
    content = (
      <div className="space-y-4">
        <TranslationsToolbar
          namespaces={project.namespaces}
          selection={selection}
          select={select}
          actions={
            <TranslationsActionsMenu
              projectId={project.id}
              projectKey={project.key}
              brands={tableBrands}
              projectLanguages={project.languages}
              namespace={selection.namespace}
              organizationId={organizationId}
              // The empty states "no languages" and "no keys" carry their
              // button themselves.
              onManageLanguages={
                canManage && !noLanguages ? manageLanguages : undefined
              }
              languagesDisabled={languagesReloading}
              onImport={
                canEdit && !noLanguages && !importInBody
                  ? openImport
                  : undefined
              }
              importDisabled={importBlocked}
              onAiTranslate={canTranslate ? openAiTranslate : undefined}
              aiDisabled={importBlocked}
              // Only export a namespace whose rows have arrived.
              exportDisabled={table === null || foreignTable}
            />
          }
        />
        <div
          data-testid="translations-body"
          aria-busy={isLoading || foreignTable || undefined}
          className={cn('transition-opacity', reloading && 'opacity-60')}
        >
          {body}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title={t('translations.title')}
        description={t('translations.description')}
        actions={headerActions}
      />
      <RoleUnavailableNotice show={roleUnavailable} />
      {content}

      <TranslationsDialogs
        languages={
          project && canManage
            ? {
                open: languagesOpen,
                onOpenChange: setLanguagesOpen,
                project,
                brand: languagesBrand,
                brands: tableBrands,
                onTargetChange: setLanguagesTarget,
                onSaved: () => void reloadLanguages(),
                onStale: reloadLanguages,
              }
            : null
        }
        keyDialog={{
          open: keyDialogOpen,
          onOpenChange: setKeyDialogOpen,
          row: renaming,
          onSubmit: submitKey,
        }}
        remove={{
          open: deleteOpen,
          onOpenChange: setDeleteOpen,
          row: deleting,
          onConfirm: deleteKey,
        }}
        importDialog={
          importTarget && canEdit
            ? {
                open: importOpen,
                onOpenChange: setImportOpen,
                target: importTarget,
                onImported: () => void reload(),
              }
            : null
        }
        aiTranslate={
          aiTarget && canEdit && ai.enabled
            ? {
                open: aiOpen,
                onOpenChange: setAiOpen,
                target: aiTarget,
                onApplied: () => void reload(),
              }
            : null
        }
      />
    </div>
  )
}

function TableSkeleton() {
  return (
    <div data-testid="translations-skeleton" className="space-y-2">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  )
}
