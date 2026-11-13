import {
  ChevronLeft,
  ChevronRight,
  Link2,
  Lock,
  LockOpen,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react'
import { memo, useCallback, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { BrandRows, brandRowId } from './BrandRows'
import { TranslationCell } from './TranslationCell'
import {
  aiSourceLanguage,
  EMPTY_CELL,
  ownBrandCount,
} from './translationsState'
import type {
  AiSuggestion,
  TableCell,
  TableRow,
  TranslationTable,
} from './types'
import { cellKey } from './useTranslations'

type Brand = { id: string; name: string; languages: string[] }

interface TranslationsTableProps {
  table: TranslationTable
  /** Brands of a MULTI project; empty = no expanders, no legend. */
  brands: Brand[]
  projectLanguages: string[]
  readOnly: boolean
  isBusy(cell: string): boolean
  onSave(
    row: TableRow,
    language: string,
    value: string,
    brandId?: string | null
  ): Promise<boolean>
  onUnlink(row: TableRow, language: string, brandId: string): Promise<boolean>
  onRelink(row: TableRow, language: string, brandId: string): void
  onRename(row: TableRow): void
  onDelete(row: TableRow): void
  /** Locks or unlocks the key of the row (ADMIN, like deleting). */
  onLock(row: TableRow, locked: boolean): void
  onPage(page: number): void
  /** Row menu offers "Delete" and "Lock" (ADMIN); hidden by default. */
  canDelete?: boolean
  /** Without this prop there is no suggestion button. */
  onSuggest?(
    row: TableRow,
    targetLanguage: string,
    sourceLanguage: string,
    brandId?: string | null
  ): Promise<AiSuggestion | null>
}

/**
 * Width of the key column and minimum width of a language column (rem). The
 * key column also holds the row menu, so it stays reachable while the
 * languages scroll.
 */
const KEY_COLUMN_REM = 16
const LANGUAGE_COLUMN_REM = 14

/**
 * Keys as rows, languages as columns. Fixed layout: a long text never widens
 * its column; with many languages the table scrolls horizontally while the
 * key column stays in place. Each key row can be expanded to one slim row
 * per brand below it; brand rows add no columns.
 */
export function TranslationsTable({
  table,
  brands,
  projectLanguages,
  readOnly,
  isBusy,
  onSave,
  onUnlink,
  onRelink,
  onRename,
  onDelete,
  onLock,
  onPage,
  canDelete = false,
  onSuggest,
}: TranslationsTableProps) {
  const { t } = useTranslation()
  const { languages, rows, total, page, pageSize } = table
  // Expanded key rows; another page starts collapsed again (a namespace
  // switch remounts the table).
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [expandedPage, setExpandedPage] = useState(page)
  if (expandedPage !== page) {
    setExpandedPage(page)
    setExpanded(new Set())
  }
  const toggle = useCallback((keyId: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(keyId)) next.add(keyId)
      return next
    })
  }, [])
  const minWidth = KEY_COLUMN_REM + languages.length * LANGUAGE_COLUMN_REM
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  return (
    <div className="space-y-3">
      {brands.length > 0 && <LinkLegend />}
      {/* Positioned on purpose: absolutely placed descendants (sr-only texts in
          cells scrolled out of view) are then clipped here instead of
          widening the page and giving the window its own scrollbars. */}
      <div className="relative overflow-x-auto rounded-lg border">
        <table
          className="w-full table-fixed border-collapse text-sm"
          style={{ minWidth: `${minWidth}rem` }}
          aria-label={t('translations.title')}
        >
          <colgroup>
            <col style={{ width: `${KEY_COLUMN_REM}rem` }} />
            {languages.map((language) => (
              <col key={language} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b bg-muted text-left text-xs font-medium text-muted-foreground">
              <th
                scope="col"
                className="sticky left-0 z-10 bg-muted px-3 py-2 font-medium"
              >
                {t('translations.table.key')}
              </th>
              {languages.map((language) => (
                <th
                  key={language}
                  scope="col"
                  className="px-3 py-2 font-mono font-medium"
                >
                  {language}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Row
                key={row.keyId}
                row={row}
                languages={languages}
                projectLanguages={projectLanguages}
                brands={brands}
                expanded={expanded.has(row.keyId)}
                onToggle={toggle}
                readOnly={readOnly}
                canDelete={canDelete}
                isBusy={isBusy}
                onSave={onSave}
                onUnlink={onUnlink}
                onRelink={onRelink}
                onRename={onRename}
                onDelete={onDelete}
                onLock={onLock}
                onSuggest={onSuggest}
              />
            ))}
          </tbody>
        </table>
      </div>
      {total > pageSize && (
        <nav
          aria-label={t('translations.table.pagination')}
          className="flex items-center justify-end gap-2 text-sm"
        >
          <span className="tabular-nums text-muted-foreground">
            {t('translations.table.range', { from, to, total })}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label={t('translations.table.previous')}
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label={t('translations.table.next')}
            disabled={to >= total}
            onClick={() => onPage(page + 1)}
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </nav>
      )}
    </div>
  )
}

/** Legend of the brand rows: inherited vs. own text. */
function LinkLegend() {
  const { t } = useTranslation()
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <Link2 className="h-3.5 w-3.5" aria-hidden />
        <span>{t('translations.legend.inherited')}</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3.5 w-0.5 rounded-full bg-primary" aria-hidden />
        <span>{t('translations.legend.own')}</span>
      </span>
    </p>
  )
}

interface RowProps {
  row: TableRow
  languages: string[]
  projectLanguages: string[]
  brands: Brand[]
  expanded: boolean
  onToggle(keyId: string): void
  readOnly: boolean
  canDelete: boolean
  isBusy(cell: string): boolean
  onSave: TranslationsTableProps['onSave']
  onUnlink: TranslationsTableProps['onUnlink']
  onRelink: TranslationsTableProps['onRelink']
  onRename(row: TableRow): void
  onDelete(row: TableRow): void
  onLock(row: TableRow, locked: boolean): void
  onSuggest: TranslationsTableProps['onSuggest']
}

/** Memoised: a save in one row does not re-render the others. */
const Row = memo(function Row({
  row,
  languages,
  projectLanguages,
  brands,
  expanded,
  onToggle,
  readOnly,
  canDelete,
  isBusy,
  onSave,
  onUnlink,
  onRelink,
  onRename,
  onDelete,
  onLock,
  onSuggest,
}: RowProps) {
  const { t } = useTranslation()
  const brandRowsId = useId()
  const ownCount = ownBrandCount(row, brands)
  return (
    <>
      <tr className="border-b align-top last:border-b-0">
        <th
          scope="row"
          className="sticky left-0 z-[1] bg-background px-3 py-2 text-left font-normal"
        >
          <div className="flex items-start gap-1">
            {!readOnly && (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-my-1 -ml-1 h-6 w-6 shrink-0 text-muted-foreground"
                    aria-label={t('translations.table.actions', {
                      key: row.key,
                    })}
                  >
                    <MoreHorizontal className="h-4 w-4" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-w-64">
                  <DropdownMenuItem
                    disabled={row.locked}
                    onSelect={() => onRename(row)}
                  >
                    <Pencil className="mr-2 h-4 w-4" aria-hidden />
                    {t('translations.table.rename')}
                  </DropdownMenuItem>
                  {canDelete && (
                    <DropdownMenuItem onSelect={() => onLock(row, !row.locked)}>
                      {row.locked ? (
                        <LockOpen className="mr-2 h-4 w-4" aria-hidden />
                      ) : (
                        <Lock className="mr-2 h-4 w-4" aria-hidden />
                      )}
                      {t(
                        row.locked
                          ? 'translations.table.unlock'
                          : 'translations.table.lock'
                      )}
                    </DropdownMenuItem>
                  )}
                  {canDelete && (
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      disabled={row.locked}
                      onSelect={() => onDelete(row)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                      {t('common.delete')}
                    </DropdownMenuItem>
                  )}
                  {row.locked && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                        {t('translations.table.locked-hint')}
                      </DropdownMenuLabel>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {brands.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="-my-1 -ml-1 h-6 w-6 shrink-0 text-muted-foreground"
                aria-expanded={expanded}
                aria-controls={brands
                  .map((brand) => brandRowId(brandRowsId, brand.id))
                  .join(' ')}
                aria-label={t(
                  expanded
                    ? 'translations.row.collapse'
                    : 'translations.row.expand',
                  { key: row.key }
                )}
                onClick={() => onToggle(row.keyId)}
              >
                <ChevronRight
                  className={cn(
                    'h-4 w-4 transition-transform',
                    expanded && 'rotate-90'
                  )}
                  aria-hidden
                />
              </Button>
            )}
            <div className="min-w-0 flex-1">
              <span className="flex items-start gap-1">
                <code className="block min-w-0 break-all font-mono text-xs">
                  {row.key}
                </code>
                {row.locked && <LockedMark />}
              </span>
              {row.description && (
                <span
                  className="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground"
                  title={row.description}
                >
                  {row.description}
                </span>
              )}
              {ownCount > 0 && (
                <Badge
                  variant="outline"
                  className="mt-1 font-normal text-muted-foreground"
                >
                  {t('translations.row.own-count', { count: ownCount })}
                </Badge>
              )}
            </div>
          </div>
        </th>
        {languages.map((language) => (
          <td key={language} className="p-1">
            <StandardCell
              row={row}
              language={language}
              cell={row.values[language] ?? EMPTY_CELL}
              label={t('translations.cell.label', { key: row.key, language })}
              lockedHint={
                projectLanguages.includes(language)
                  ? undefined
                  : t('translations.cell.not-project-language')
              }
              projectLanguages={projectLanguages}
              busy={isBusy(cellKey(row.keyId, language))}
              readOnly={readOnly}
              onSave={onSave}
              onSuggest={onSuggest}
            />
          </td>
        ))}
      </tr>
      {expanded && brands.length > 0 && (
        <BrandRows
          id={brandRowsId}
          row={row}
          languages={languages}
          projectLanguages={projectLanguages}
          brands={brands}
          readOnly={readOnly}
          isBusy={isBusy}
          onSave={onSave}
          onUnlink={onUnlink}
          onRelink={onRelink}
          onSuggest={onSuggest}
        />
      )}
    </>
  )
})

/** Lock sign next to a key name; the hint explains what the lock prevents. */
function LockedMark() {
  const { t } = useTranslation()
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users must reach the hint
            tabIndex={0}
            role="img"
            aria-label={t('translations.table.locked')}
            className="mt-px shrink-0 rounded-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Lock className="h-3.5 w-3.5" aria-hidden />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">
          {t('translations.table.locked-hint')}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

interface StandardCellProps {
  row: TableRow
  language: string
  cell: TableCell
  label: string
  lockedHint: string | undefined
  projectLanguages: string[]
  busy: boolean
  readOnly: boolean
  onSave: TranslationsTableProps['onSave']
  onSuggest: TranslationsTableProps['onSuggest']
}

/** Binds a standard cell to its row and language; memoised on its own data. */
const StandardCell = memo(function StandardCell({
  row,
  language,
  projectLanguages,
  onSave,
  onSuggest,
  ...props
}: StandardCellProps) {
  const save = useCallback(
    (value: string) => onSave(row, language, value),
    [onSave, row, language]
  )
  const source = onSuggest
    ? aiSourceLanguage(row, language, projectLanguages)
    : null
  const suggest = useMemo(
    () =>
      onSuggest && source
        ? () => onSuggest(row, language, source, undefined)
        : undefined,
    [onSuggest, row, language, source]
  )
  return (
    <TranslationCell
      {...props}
      variant="standard"
      onSave={save}
      onSuggest={suggest}
    />
  )
})
