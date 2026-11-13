import {
  Code2,
  FileJson,
  Languages,
  Loader2,
  MoreHorizontal,
  Sparkles,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DeliverySnippetDialog } from './DeliverySnippet'
import { ExportSubmenu, useExport } from './ExportSubmenu'

interface TranslationsActionsMenuProps {
  projectId: string
  projectKey: string
  /** Brands of a MULTI project; empty = only the standard texts. */
  brands: { id: string; key: string; name: string; languages: string[] }[]
  projectLanguages: string[]
  namespace: string
  /** Organization of the project, for the snippet's link to its API keys. */
  organizationId?: string
  /** Each of these entries is only offered with its handler. */
  onManageLanguages?(): void
  languagesDisabled?: boolean
  onImport?(): void
  importDisabled?: boolean
  onAiTranslate?(): void
  aiDisabled?: boolean
  /** Blocks the export, e.g. while the rows on screen belong to another namespace. */
  exportDisabled?: boolean
}

/**
 * The actions of the translations page in one menu: languages, import, AI
 * translation, the i18next snippet and the export. Snippet and export are
 * always offered; the others depend on the role.
 */
export function TranslationsActionsMenu({
  projectId,
  projectKey,
  brands,
  projectLanguages,
  namespace,
  organizationId,
  onManageLanguages,
  languagesDisabled = false,
  onImport,
  importDisabled = false,
  onAiTranslate,
  aiDisabled = false,
  exportDisabled = false,
}: TranslationsActionsMenuProps) {
  const { t } = useTranslation()
  const [snippetOpen, setSnippetOpen] = useState(false)
  const exportState = useExport({
    projectId,
    brands,
    projectLanguages,
    namespace,
  })
  const hasWriteActions = Boolean(
    onManageLanguages || onImport || onAiTranslate
  )

  return (
    <>
      {/* Not modal: the entries open dialogs that take the focus themselves. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            {exportState.busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <MoreHorizontal className="mr-2 h-4 w-4" aria-hidden />
            )}
            {t('translations.actions-menu')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onManageLanguages && (
            <DropdownMenuItem
              disabled={languagesDisabled}
              onSelect={onManageLanguages}
            >
              <Languages className="mr-2 h-4 w-4" aria-hidden />
              {t('translations.manage-languages')}
            </DropdownMenuItem>
          )}
          {onImport && (
            <DropdownMenuItem disabled={importDisabled} onSelect={onImport}>
              <FileJson className="mr-2 h-4 w-4" aria-hidden />
              {t('translations.import')}
            </DropdownMenuItem>
          )}
          {onAiTranslate && (
            <DropdownMenuItem disabled={aiDisabled} onSelect={onAiTranslate}>
              <Sparkles className="mr-2 h-4 w-4" aria-hidden />
              {t('translations.ai.translate')}
            </DropdownMenuItem>
          )}
          {hasWriteActions && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={() => setSnippetOpen(true)}>
            <Code2 className="mr-2 h-4 w-4" aria-hidden />
            {t('translations.snippet.button')}
          </DropdownMenuItem>
          <ExportSubmenu
            state={exportState}
            brands={brands}
            disabled={exportDisabled}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <DeliverySnippetDialog
        open={snippetOpen}
        onOpenChange={setSnippetOpen}
        projectKey={projectKey}
        brands={brands}
        projectLanguages={projectLanguages}
        organizationId={organizationId}
      />
    </>
  )
}
