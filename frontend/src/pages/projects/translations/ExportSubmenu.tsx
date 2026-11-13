import { Download } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { handleForbidden } from '@/lib/permissions'
import { exportFile } from './api'
import { saveBlobAsFile } from './saveBlob'

/** Radio value of the standard texts. */
const STANDARD = '__standard__'

type Brand = { id: string; name: string; languages: string[] }

interface ExportOptions {
  projectId: string
  /** Brands of a MULTI project; empty = only the standard texts. */
  brands: Brand[]
  projectLanguages: string[]
  namespace: string
}

export interface ExportState {
  /** A download is running. */
  busy: boolean
  /** Chosen target; null = the standard texts. */
  brand: Brand | null
  chooseBrand(brandId: string | null): void
  /** Languages of the chosen target. */
  languages: string[]
  /** Neither the project nor any brand has a language. */
  unavailable: boolean
  download(language: string): Promise<void>
}

/**
 * State of the export. It lives outside the menu, which unmounts its content
 * when it closes: the running download and the chosen target survive that.
 */
export function useExport({
  projectId,
  brands,
  projectLanguages,
  namespace,
}: ExportOptions): ExportState {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [brandId, setBrandId] = useState<string | null>(null)
  // A brand that is gone (e.g. after a reload) falls back to the standard texts.
  const brand = brands.find((b) => b.id === brandId) ?? null
  const languages = brand ? brand.languages : projectLanguages
  const unavailable =
    projectLanguages.length === 0 &&
    brands.every((b) => b.languages.length === 0)

  const download = async (language: string) => {
    setBusy(true)
    try {
      const blob = await exportFile(projectId, {
        language,
        namespace,
        ...(brand ? { brandId: brand.id } : {}),
      })
      saveBlobAsFile(blob, `${namespace}.${language}.json`)
    } catch (error) {
      if (!handleForbidden(error, t))
        toast.error(t('translations.export.failed'))
    } finally {
      setBusy(false)
    }
  }

  return {
    busy,
    brand,
    chooseBrand: setBrandId,
    languages,
    unavailable,
    download,
  }
}

interface ExportSubmenuProps {
  state: ExportState
  brands: Brand[]
  /** Blocks the export, e.g. while the rows on screen belong to another namespace. */
  disabled?: boolean
}

/**
 * The export entry of the actions menu: downloads one language file as JSON.
 * With brands, the submenu first offers the target (standard texts or a
 * brand) and below it the target's languages; without brands it is a plain
 * entry for a single language and a submenu with one entry per language
 * otherwise.
 */
export function ExportSubmenu({
  state,
  brands,
  disabled = false,
}: ExportSubmenuProps) {
  const { t } = useTranslation()
  const { brand, languages } = state
  const blocked = disabled || state.busy
  const label = (
    <>
      <Download className="mr-2 h-4 w-4" aria-hidden />
      {t('translations.export.button')}
    </>
  )

  if (state.unavailable) {
    return (
      <DropdownMenuItem disabled className="flex-col items-start gap-0.5">
        <span className="flex items-center">{label}</span>
        <span className="pl-6 text-xs">
          {t('translations.export.unavailable')}
        </span>
      </DropdownMenuItem>
    )
  }

  if (brands.length === 0 && languages.length === 1) {
    return (
      <DropdownMenuItem
        disabled={blocked}
        onSelect={() => void state.download(languages[0])}
      >
        {label}
      </DropdownMenuItem>
    )
  }

  const targetLabel = t('translations.target.label')
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={blocked}>
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {brands.length > 0 && (
          <>
            <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
              {targetLabel}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              aria-label={targetLabel}
              value={brand?.id ?? STANDARD}
              onValueChange={(value) =>
                state.chooseBrand(value === STANDARD ? null : value)
              }
            >
              <DropdownMenuRadioItem
                value={STANDARD}
                // Choosing the target keeps the menu open for the language.
                onSelect={(event) => event.preventDefault()}
              >
                {t('translations.target.standard')}
              </DropdownMenuRadioItem>
              {brands.map((b) => (
                <DropdownMenuRadioItem
                  key={b.id}
                  value={b.id}
                  onSelect={(event) => event.preventDefault()}
                >
                  {b.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        )}
        {languages.length === 0 ? (
          <DropdownMenuItem disabled>
            {t('translations.export.unavailable')}
          </DropdownMenuItem>
        ) : (
          languages.map((language) => (
            <DropdownMenuItem
              key={language}
              onSelect={() => void state.download(language)}
            >
              {language}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
