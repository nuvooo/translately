import { memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { TranslationCell } from './TranslationCell'
import { aiSourceLanguage, brandCell, EMPTY_CELL } from './translationsState'
import type { AiSuggestion, TableCell, TableRow } from './types'
import { cellKey } from './useTranslations'

interface Brand {
  id: string
  name: string
  languages: string[]
}

interface BrandRowsProps {
  /** DOM id prefix; each brand row gets `${id}-${brand.id}` (aria-controls). */
  id: string
  row: TableRow
  /** Columns of the table. */
  languages: string[]
  projectLanguages: string[]
  brands: Brand[]
  readOnly: boolean
  isBusy(cell: string): boolean
  onSave(
    row: TableRow,
    language: string,
    value: string,
    brandId: string
  ): Promise<boolean>
  onUnlink(row: TableRow, language: string, brandId: string): Promise<boolean>
  onRelink(row: TableRow, language: string, brandId: string): void
  /** Without it the editors offer no AI suggestion. */
  onSuggest?(
    row: TableRow,
    targetLanguage: string,
    sourceLanguage: string,
    brandId?: string | null
  ): Promise<AiSuggestion | null>
}

/** DOM id of one brand row of an expanded key row. */
export const brandRowId = (id: string, brandId: string) => `${id}-${brandId}`

/**
 * The `<tr>`s of all brands below an expanded key row: one slim row per
 * brand, its texts in the table's language columns (no extra columns).
 * Memoised: a save in another row does not re-render these.
 */
export const BrandRows = memo(function BrandRows({
  id,
  row,
  languages,
  projectLanguages,
  brands,
  readOnly,
  isBusy,
  onSave,
  onUnlink,
  onRelink,
  onSuggest,
}: BrandRowsProps) {
  const { t } = useTranslation()
  return (
    <>
      {brands.map((brand) => (
        <tr
          key={brand.id}
          id={brandRowId(id, brand.id)}
          className="border-b bg-muted/40 align-top last:border-b-0"
        >
          <th
            scope="row"
            className={cn(
              'sticky left-0 z-[1] bg-background py-1 pr-3 text-left text-xs font-medium before:pointer-events-none before:absolute before:inset-0 before:bg-muted/40',
              // Aligned with the key name: the row menu takes room when shown.
              readOnly ? 'pl-9' : 'pl-16'
            )}
          >
            <span className="relative mt-1.5 block truncate" title={brand.name}>
              {brand.name}
            </span>
          </th>
          {languages.map((language) => {
            const cell = brandCell(row, brand, language, projectLanguages)
            return (
              <td key={language} className="px-1 py-0.5">
                <BrandCell
                  row={row}
                  language={language}
                  brand={brand}
                  projectLanguages={projectLanguages}
                  cell={cell ?? EMPTY_CELL}
                  label={t('translations.cell.brand-label', {
                    key: row.key,
                    language,
                    brand: brand.name,
                  })}
                  lockedHint={
                    cell === null
                      ? t('translations.cell.unavailable')
                      : undefined
                  }
                  busy={isBusy(cellKey(row.keyId, language, brand.id))}
                  readOnly={readOnly}
                  onSave={onSave}
                  onUnlink={onUnlink}
                  onRelink={onRelink}
                  onSuggest={onSuggest}
                />
              </td>
            )
          })}
        </tr>
      ))}
    </>
  )
})

interface BrandCellProps {
  row: TableRow
  language: string
  brand: Brand
  projectLanguages: string[]
  cell: TableCell
  label: string
  lockedHint: string | undefined
  busy: boolean
  readOnly: boolean
  onSave: BrandRowsProps['onSave']
  onUnlink: BrandRowsProps['onUnlink']
  onRelink: BrandRowsProps['onRelink']
  onSuggest: BrandRowsProps['onSuggest']
}

/** Binds a brand cell to its row, language and brand; memoised. */
const BrandCell = memo(function BrandCell({
  row,
  language,
  brand,
  projectLanguages,
  onSave,
  onUnlink,
  onRelink,
  onSuggest,
  ...props
}: BrandCellProps) {
  const brandId = brand.id
  const save = useCallback(
    (value: string) => onSave(row, language, value, brandId),
    [onSave, row, language, brandId]
  )
  const unlink = useCallback(
    () => onUnlink(row, language, brandId),
    [onUnlink, row, language, brandId]
  )
  const relink = useCallback(
    () => onRelink(row, language, brandId),
    [onRelink, row, language, brandId]
  )
  const source = onSuggest
    ? aiSourceLanguage(row, language, projectLanguages, brand)
    : null
  const suggest = useMemo(
    () =>
      onSuggest && source
        ? () => onSuggest(row, language, source, brandId)
        : undefined,
    [onSuggest, row, language, source, brandId]
  )
  return (
    <TranslationCell
      {...props}
      variant="brand"
      onSave={save}
      onUnlink={unlink}
      onReset={relink}
      onSuggest={suggest}
    />
  )
})
